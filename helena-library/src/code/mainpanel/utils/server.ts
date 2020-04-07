import { HelenaConfig } from "../../common/config/config";
import { HelenaConsole } from "../../common/utils/helena_console";
import { Dataset } from "../dataset";
import { DatasetSliceRequest, RelationMessage,
  Messages } from "../../common/messages";
import { ServerTransaction } from "../lang/statements/control_flow/skip_block";

export interface KnownRelationRequest {
  url: string;
}

export interface KnownRelationResponse {
  relations: ServerRelationMessage[];
}

interface ProgramIdResponse {
  program_id: string;
}

interface RetrieveRelationsRequest {
  pages: {
    frame_ids: number[];
    page_var_name: string;
    url: string;
    xpaths: string[];
  }[];
}

export interface ServerRelationMessage {
  selector_version: number;
  selector: string;
  name: string;
  exclude_first: number;
  id: number;
  columns: {
    xpath: string;
    suffix: string;
    name: string;
    id: number
  }[];
  num_rows_in_demonstration: number;
  next_type: number;
  next_button_selector?: string;
}

export interface RetrieveRelationsResponse {
  pages: {
    page_var_name: string;
    relations: {
      same_domain_best_relation: ServerRelationMessage | null;
      same_url_best_relation: ServerRelationMessage | null;
    }
  }[];
}

export interface RunNewProgramResponse {
  run_id?: number;
  sub_run_id: number;
}

interface SaveProgramRequest {
  associated_string?: string;
  id: string;
  name: string;
  relation_objects?: (string | RelationMessage)[];
  tool_id?: null;
}

interface SaveRelationRequest {
  relation: RelationMessage;
}

function keepSendingRequest(jQueryMethod: Function, url: string, msg: object,
    successHandler?: Function, showWaitingMsg = true, extraText = "") {
  let currentWait = 5000;
  console.log("waiting for request", url);

  let successHandlerWrapped = successHandler;
  let waitingForServerAlert: JQuery<HTMLElement>;
  if (showWaitingMsg) {
    waitingForServerAlert =
      $("<div class='waiting_for_server'>" +
          "<img style='margin-right:7px' src='../icons/ajax-loader2.gif' " +
            "height='10px'><span id='extra'></span>Waiting for the server" +
              extraText+"...</div>");
    $("body").append(waitingForServerAlert);
    successHandlerWrapped = (data: object) => {
      waitingForServerAlert.remove();
      if (successHandler) {
        successHandler(data);
      }
    }
  }
  const sendHelper = (msg: object) => {
    jQueryMethod(url, msg, successHandlerWrapped).fail((jqxhr: JQuery.jqXHR,
          status: string) => {
        console.log(jqxhr, status);
        // if we failed, need to be sure to send again...
        setTimeout(() => { sendHelper(msg); }, currentWait);
        // doing a little bit of backoff, but should probably do this in a
        //   cleaner way
        currentWait = currentWait * 2;
        if (showWaitingMsg) {
          // this was a failure, so say we're trying again
          waitingForServerAlert.find("#extra").html("Trying again. " + 
            "Is the server down?  Is your Internet connection slow?  ");
          var additional = $("<div>"+status+"</div>");
          waitingForServerAlert.append(additional);
          setTimeout(() => { additional.remove() }, 10000);
        }
      });
  };
  sendHelper(msg);
}

/**
 * Repeatedly issues a GET request to the Helena server.
 * @param url request URL
 * @param msg request data
 * @param successHandler callback for success
 * @param showWaitingMsg show/hide waiting status message div
 * @param extraText extra text to include in waiting message div
 */
function keepGetting(url: string, msg: object, successHandler?: Function,
  showWaitingMsg = true, extraText = "") {
    keepSendingRequest($.get, url, msg, successHandler, showWaitingMsg,
      extraText);
}

/**
 * Repeatedly issues a POST request to the Helena server.
 * @param url request URL
 * @param msg request data
 * @param successHandler callback for success
 * @param showWaitingMsg show/hide waiting status message div
 * @param extraText extra text to include in waiting message div
 */
function keepPosting(url: string, msg: object, successHandler?: Function,
    showWaitingMsg = true, extraText = "") {
  keepSendingRequest($.post, url, msg, successHandler, showWaitingMsg,
    extraText);
}


export namespace HelenaServer {
  export function checkSkipBlockTransaction(url: string, tx: ServerTransaction,
      handler: Function) {
    keepPosting(url, tx, handler, true,
      " to tell us if we should do this subtask");
  }

  export function getKnownRelations(
      req: KnownRelationRequest & Messages.MessageContentWithTab,
      handler: any) {
    $.post(HelenaConfig.helenaServerUrl + '/allpagerelations', req, handler);
  }

  export function loadSavedPrograms(handler: Function) {
    HelenaConsole.log("loading programs");
    const toolId = window.helenaMainpanel.toolId;
    console.log("toolId", toolId);
    keepGetting(HelenaConfig.helenaServerUrl + '/programs/',
      {
        tool_id: toolId
      }, (resp: object) => {
        handler(resp);
    }, true, " to retrieve saved programs");
  }

  export function loadSavedDataset(datasetId: number, handler: Function) {
    HelenaConsole.log("loading dataset: ", datasetId);
    keepGetting(`${HelenaConfig.helenaServerUrl}/programfordataset/${datasetId}`,
      {}, (resp: ProgramIdResponse) => {
        const progId = resp.program_id;
        handler(progId);
    }, true, " to load the saved dataset");
  }

  export function loadSavedProgram(progId: string, handler: Function) {
    HelenaConsole.log("loading program: ", progId);
    keepGetting(HelenaConfig.helenaServerUrl + '/programs/' + progId, {},
      (resp: object) => {
        HelenaConsole.log("received program: ", resp);
        handler(resp);
    }, true, " to load the saved program");
  }

  export function newSkipBlockTransaction(
      req: ServerTransaction & DatasetSliceRequest, handler: Function) {
    keepPosting(HelenaConfig.helenaServerUrl + '/newtransactionwithdata', req,
      handler, false);
  }

  export function retrieveRelations(req: RetrieveRelationsRequest,
      handler: Function) {
    keepPosting(HelenaConfig.helenaServerUrl + '/retrieverelations', req,
      handler, true, " to tell us about any relevant tables");
  }
  
  export function runNewProgram(dataset: Dataset, handler: Function) {
    keepPosting(HelenaConfig.helenaServerUrl + '/newprogramrun',
      {
        name: dataset.name,
        program_id: dataset.programId
      }, (resp: RunNewProgramResponse) => {
        handler(resp);
      }, true, " to tell us it's ready to save scraped data");
  }

  export function saveRelation(req: SaveRelationRequest, handler: Function) {
    keepPosting(HelenaConfig.helenaServerUrl + '/saverelation', req, handler,
      false);
  }

  export function saveProgram(req: SaveProgramRequest, handler: Function,
      showWaitingStatus = true, extraText = "") {
    keepPosting(HelenaConfig.helenaServerUrl + '/saveprogram', req, handler,
      showWaitingStatus, extraText);
  }

  export function sendDatasetSlice(slice: DatasetSliceRequest,
      handler: Function) {
    keepPosting(HelenaConfig.helenaServerUrl + '/datasetslice', slice, handler,
      false);
  }

  export function subRunNewProgram(programRunId: number | undefined,
      handler: Function) {
    keepPosting(HelenaConfig.helenaServerUrl + '/newprogramsubrun',
      {
        program_run_id: programRunId
      }, (resp: RunNewProgramResponse) => {
        handler(resp);
      }, true, " to tell us it's ready to save scraped data");
  }

  export function updateDatasetRunName(dataset: Dataset) {
    keepPosting(HelenaConfig.helenaServerUrl + '/updaterunname',
      {
        id: dataset.programRunId,
        name: dataset.name,
        program_id: dataset.programId
      }
    );
  }
}


