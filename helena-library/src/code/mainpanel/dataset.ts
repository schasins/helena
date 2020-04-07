import * as _ from "underscore";

import { HelenaConfig } from "../common/config/config";
import { MiscUtilities } from "../common/misc_utilities";
import { HelenaProgram } from "./lang/program";
import { DatasetSliceRequest } from "../common/messages";
import { HelenaServer, RunNewProgramResponse } from "./utils/server";

export class Dataset {
  public currentDatasetNodes: object[];
  public currentDatasetPositionLists: number[][][];
  public currentDatasetSliceLength: number;
  public fullDatasetLength: number;
  public name: string;
  public outstandingDataSaveRequests: number;
  public pass_start_time: number;
  public programId: string;
  public programRunId?: number;
  public programSubRunId?: number;

  constructor(program: HelenaProgram, programRunId?: number) {
    this.programRunId = programRunId;
  
    this.fullDatasetLength = 0;
    this.currentDatasetNodes = [];
    this.currentDatasetPositionLists = [];
    this.currentDatasetSliceLength = 0;
    this.outstandingDataSaveRequests = 0;
  
    this.name = program.name + "_" + currentDateString();
  
    this.pass_start_time = (new Date()).getTime();
    
    if (!program.id){
      throw new ReferenceError("Program lacks id (is it saved yet?)");
    } else {
      // we'll associate a program with a dataset even though the db-stored
      //   program version may not be the same one used the scrape the dataset
      this.programId = program.id;
      this.getProgramRunAndSubRun();
    }
  }

  public isReady(){
    return this.programRunId;
  }

  public getProgramRunAndSubRun() {
    // now let's actually make the new dataset on the server
    if (this.programRunId === undefined) {
      // this is a run we're about to start, not one that we've already started and are recovering or parallelizing or whatever
      this.requestNewProgramRunId();
    } else {
      // this dataset is for a run that we already started before, but we're about to begin again from the start
      this.requestNewProgramSubRunId();
    }
  }

  public requestNewProgramRunId(){
    const self = this;
    HelenaServer.runNewProgram(this, (resp: RunNewProgramResponse) => {
      self.handleDatasetId(resp)
    });
  }

  public requestNewProgramSubRunId() {
    const self = this;
    HelenaServer.subRunNewProgram(this.programRunId,
      (resp: RunNewProgramResponse) => {
        self.handleDatasetId(resp);
      }
    );
  }

  public handleDatasetId(resp: RunNewProgramResponse) {
    if (resp.run_id) {
      this.programRunId = resp.run_id;
    }
    this.programSubRunId = resp.sub_run_id;
  }

  public appendToName(str: string) {
    const self = this;
    this.name = this.name + str;
    if (this.programRunId){
      // ok, we can go ahead and send the update now
      this.updateRunNameOnServer();
    } else {
      // better wait a while until we actually have that id
      setTimeout(() => {
        self.updateRunNameOnServer();
      }, 1000);
    }
  }

  public updateRunNameOnServer(){
    HelenaServer.updateDatasetRunName(this);
  }


  // how we'll grab out the components in the server
  // nodes = JSON.parse(URI.decode(params[:nodes]))
  // positionLists = JSON.parse(params[:position_lists])

  public addRow(row: object[]) {
    for (let i = 0; i < row.length; i++){
      const cell_dict = row[i];
      let node_index = null;

      // let's just find if we've already seen this node before or not, so we
      //   can figure out what info to update
      // todo: is this fast enough.  we used to do a dict from text value to
      //   positionsList, but now we want to save more info
      // important to avoid eating up too much memory since it's easy for user
      //   to be grabbing items that have a ton of text...

      for (let j = 0; j < this.currentDatasetNodes.length; j++){
        const candidate_dict = this.currentDatasetNodes[j];
        if (_.isEqual(candidate_dict, cell_dict)) {
          node_index = j;
          break;
        }
      }
      if (node_index === null){
        // ok, we haven't seen this node before
        this.currentDatasetNodes.push(cell_dict);
        this.currentDatasetPositionLists.push([]);
        node_index = this.currentDatasetNodes.length - 1;
      }

      // ok, now the node is stored in this.currentDatasetNodes
      // let's store the current coords in the corresponding index for
      //   this.currentDatasetPositionLists
      const coords = [this.fullDatasetLength, i];
      this.currentDatasetPositionLists[node_index].push(coords);
    }

    this.currentDatasetSliceLength += 1;
    this.fullDatasetLength += 1;
    if (this.currentDatasetSliceLength %
        HelenaConfig.numRowsToSendInOneSlice === 0){
      // note that the inclusion of this sendDatasetSlice call means that if we
      //   have a transaction with 10 output calls, we can actually save output
      //   without committing.  this definitely undermines the current stated
      //   semantics of output in the presence of skip blocks.
      // this will never happen in our auto-generated/synthesized scripts, so
      //   it's not something that affects semantics now, but as we allow more
      //   editing, it could
      // todo: fix this
      // however, also note that for cases where there are no skip block
      //   constructs, this is the only time when we push the data to the server
      // also, this was introduced for a reason, to make sure we don't eat up
      //   too much memory on the client side and end up crashing the extension
      this.sendDatasetSlice(); 
    }
  };

  // note!  calling this doesn't just get the server representation of the
  //   current slice.  it also clears out the current cache
  public datasetSlice() {
    const msg: DatasetSliceRequest = {
      run_id: this.programRunId,
      sub_run_id: this.programSubRunId,
      pass_start_time: this.pass_start_time,
      position_lists: JSON.stringify(this.currentDatasetPositionLists),
      nodes: encodeURIComponent(JSON.stringify(this.currentDatasetNodes))
    };
    this.currentDatasetNodes = [];
    this.currentDatasetPositionLists = [];
    this.currentDatasetSliceLength = 0;
    return msg;
  }

  public sendDatasetSlice(handler = () => {}) {
    const self = this;

    if (this.currentDatasetSliceLength === 0) {
      handler();
      return; // no need to send/save rows if we have no rows
    }

    const slice = this.datasetSlice();
    this.outstandingDataSaveRequests += 1;
    HelenaServer.sendDatasetSlice(slice, () => {
      self.outstandingDataSaveRequests -= 1;
      handler();
    });
  }

  public closeDataset() {
    this.sendDatasetSlice();
  }

  // this is a variation on close dataset that won't return control until the
  //   server has gotten the associated data
  public closeDatasetWithCont(cont: Function) {
    const self = this;

    this.closeDataset();

    // ok, now keep in mind we're not truly finished until all our data is
    //   stored, which means the dataset must have no outstanding requests
    MiscUtilities.repeatUntil(
      () => {}, // repeatFunc is nothing.  just wait
      () => self.outstandingDataSaveRequests === 0, 
      cont, 1000, false);
  }

  public downloadUrl() {
    return `${HelenaConfig.helenaServerUrl}/datasets/run/${this.programRunId}`;
  }

  public downloadDataset() {
    window.location.href = this.downloadUrl();
  }

  public downloadFullDatasetUrl() {
    return `${HelenaConfig.helenaServerUrl}/datasets/${this.programId}`; 
  }

  public static downloadFullDatasetUrl(program: HelenaProgram) {
    return `${HelenaConfig.helenaServerUrl}/datasets/${program.id}`; 
  }

  public downloadFullDataset(){
    window.location.href = this.downloadFullDatasetUrl();
  }

  public getId() {
    return this.programRunId;
  }
}

function currentDateString() {
  return basicDateString(new Date());
}

function basicDateString(d: Date) {
  return d.getFullYear() + "-" + (d.getMonth()+1) + "-" + d.getDate() + "-" +
    d.getHours() + ":" + d.getMinutes();
}
