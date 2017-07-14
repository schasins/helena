'use strict'

var OutputHandler = (function _OutputHandler() {
  var pub = {};

  pub.Dataset = function _Dataset(program, program_run_id){

  	this.program_run_id = program_run_id;
    this.program_sub_run_id = null;

  	this.fullDatasetLength = 0;
  	this.currentDatasetNodes = [];
    this.currentDatasetPositionLists = [];
  	this.currentDatasetSliceLength = 0;
    this.outstandingDataSaveRequests = 0;

    this.name = program.name + "_" + MiscUtilities.currentDateString();

    this.pass_start_time = (new Date()).getTime();

  	var dataset = this;

    this.isReady = function _isReady(){
      return this.program_run_id;
    }

    this.getProgramRunAndSubRun = function _getProgramRunAndSubRun(){
      // now let's actually make the new dataset on the server
      if (dataset.program_run_id === undefined){
        // this is a run we're about to start, not one that we've already started and are recovering or parallelizing or whatever
        dataset.requestNewProgramRunId();
      }
      else{
        // this dataset is for a run that we already started before, but we're about to begin again from the start
        dataset.requestNewProgramSubRunId();
      }
    }

    this.setup = function _setup(){
      this.outstandingDataSaveRequests = 0;
      if (!program.id){
        if (program === ReplayScript.prog){
          RecorderUI.save(function(progId){
            // ok good, now we have a program id
            dataset.program_id = progId;
            dataset.getProgramRunAndSubRun();
          });
        }
        else{
          WALconsole.warn("Yo, this is going to fail to save a dataset, because we haven't put in a good way to save a prog (with it's name!) outside of recorderui yet.");
          // todo: actually do that.  fix that
        }
      }
      else{
        // awesome, we already know the associated program's id, don't need to save it now
        // although keep in mind this can mean that we'll associate a program with a dataset even though
        // the db-stored program version may not be the same one used the scrape the dataset
        dataset.program_id = program.id;
        dataset.getProgramRunAndSubRun();
      }
    };

  	this.requestNewProgramRunId = function _requestNewProgramRunId(){
      MiscUtilities.postAndRePostOnFailure('http://kaofang.cs.berkeley.edu:8080/newprogramrun', {name: dataset.name, program_id: dataset.program_id}, function(resp){dataset.handleDatasetId(resp);});
    };
    this.requestNewProgramSubRunId = function _requestNewProgramSubRunId(){
      MiscUtilities.postAndRePostOnFailure('http://kaofang.cs.berkeley.edu:8080/newprogramsubrun', {program_run_id: dataset.program_run_id}, function(resp){dataset.handleDatasetId(resp);});
    };
    this.handleDatasetId = function _handleDatasetId(resp){
      if (resp.run_id){
        this.program_run_id = resp.run_id;
      }
      this.program_sub_run_id = resp.sub_run_id;
    };

    this.appendToName = function _appendToName(str){
      this.name = this.name + str;
      if (this.program_run_id){
        // ok, we can go ahead and send the update now
        this.updateRunNameOnServer();
      }
      else{
        // better wait a while until we actually have that id
        setTimeout(function(){dataset.updateRunNameOnServer();}, 1000);
      }
    }

    this.updateRunNameOnServer = function _updateRunNameOnServer(){
      MiscUtilities.postAndRePostOnFailure('http://kaofang.cs.berkeley.edu:8080/updaterunname', {id: this.program_run_id, name: this.name, program_id: this.program_id});
    }


    // how we'll grab out the components in the server
    // nodes = JSON.parse(URI.decode(params[:nodes]))
    // positionLists = JSON.parse(params[:position_lists])

    this.addRow = function _addRow(row){
    	for (var i = 0; i < row.length; i++){
    		var cell_dict = row[i];
        var node_index = null;

        // let's just find if we've already seen this node before or not, so we can figure out what info to update
        // todo: is this fast enough.  we used to do a dict from text value to positionsList, but now we want to save more info
        // important to avoid eating up too much memory since it's easy for user to be grabbing items that have a ton of text...

        for (var j = 0; j < this.currentDatasetNodes.length; j++){
          var candidate_dict = this.currentDatasetNodes[j];
          if (_.isEqual(candidate_dict, cell_dict)){
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
        // let's store the current coords in the corresponding index for this.currentDatasetPositionLists
    		var coords = [this.fullDatasetLength, i];
        this.currentDatasetPositionLists[node_index].push(coords);
    	}
    	this.currentDatasetSliceLength += 1;
    	this.fullDatasetLength += 1;
    	if (this.currentDatasetSliceLength % 10 === 0){
        // note that the inclusion of this sendDatasetSlice call means that if we have a transaction with 10 output calls, we can actually save output without
        // committing.  this definitely undermines the current stated semantics of output in the presence of transactions/entityScope construct.
        // this will never happen in our auto-generated/synthesized scripts, so it's not something that affects semantics now, but as we allow more editing, it could
        // todo: fix this
        // however, also note that for cases where there are no entityScope constructs, this is the only time when we push the data to the server
        // also, this was introduced for a reason, to make sure we don't eat up too much memory on the client side and end up crashing the extension
    		this.sendDatasetSlice(); 
    	}
    };

    // note!  calling this doesn't just get the server representation of the current slice.  it also clears out the current cache

    this.datasetSlice = function _datasetSlice(){
      var msg = {run_id: this.program_run_id, sub_run_id: this.program_sub_run_id, pass_start_time: this.pass_start_time, position_lists: JSON.stringify(this.currentDatasetPositionLists), nodes: encodeURIComponent(JSON.stringify(this.currentDatasetNodes))};
      this.currentDatasetNodes = [];
      this.currentDatasetPositionLists = [];
      this.currentDatasetSliceLength = 0;
      return msg;
    }

    this.sendDatasetSlice = function _sendDatasetSlice(handler){
      if (handler === undefined){ handler = function(){}};
      var realHandler = function(){
        // console.log("moving dataset.outstandingDataSaveRequests from" + dataset.outstandingDataSaveRequests + " to " + (dataset.outstandingDataSaveRequests - 1)); 
        dataset.outstandingDataSaveRequests -= 1;
        // and now call the user's provided handler
        handler();
      };
      if (this.currentDatasetSliceLength === 0){
        handler();
        return; // no need to send/save rows if we have no rows
      }
      var msg = this.datasetSlice();
      this.outstandingDataSaveRequests += 1;
      MiscUtilities.postAndRePostOnFailure('http://kaofang.cs.berkeley.edu:8080/datasetslice', msg, realHandler);
    };

    this.closeDataset = function _closeDataset(){
    	this.sendDatasetSlice();
    };

    this.downloadUrl = function _downloadUrl(){
      return 'http://kaofang.cs.berkeley.edu:8080/datasets/run/'+this.program_run_id;
    };

    this.downloadDataset = function _downloadDataset(){
    	window.location = this.downloadUrl();
    };

    this.downloadFullDatasetUrl = function _downloadFullDatasetUrl(){
      return 'http://kaofang.cs.berkeley.edu:8080/datasets/'+program.id;
    };

    this.downloadFullDataset = function _downloadFullDataset(){
      window.location = this.downloadFullDatasetUrl();
    };

    this.getId = function _getId(){
      return this.program_run_id;
    };

    this.setup();
  };


  return pub;
}());