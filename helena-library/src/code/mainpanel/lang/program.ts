import * as Blockly from "blockly";
import * as _ from "underscore";

import { ServerSaveResponse, RelationResponse,
  Messages} from "../../common/messages";
import { HelenaConsole } from "../../common/utils/helena_console";

import { SkipBlock, HashBasedParallel } from "./statements/control_flow/skip_block";
import { Relation } from "../relation/relation";

import { LoadStatement } from "./statements/browser/load";
import { LoopStatement } from "./statements/control_flow/loop";
import { ClickStatement } from "./statements/page_action/click";
import { PulldownInteractionStatement } from "./statements/page_action/pulldown_interaction";
import { ScrapeStatement } from "./statements/page_action/scrape";
import { TypeStatement } from "./statements/page_action/type";

import { OutputRowStatement } from "./statements/output_row";

import { NodeSources, NodeVariable } from "../variables/node_variable";
import { HelenaLangObject } from "./helena_lang";
import { PageVariable } from "../variables/page_variable";
import { GenericRelation } from "../relation/generic";
import { PageActionStatement } from "./statements/page_action/page_action";
import { StatementContainer } from "./statements/container";
import { BackStatement } from "./statements/browser/back";
import { ClosePageStatement } from "./statements/browser/close_page";
import { Revival } from "../revival";
import { RelationSelector } from "../../content/selector/relation_selector";
import { Traces, Trace, DisplayTraceEvent } from "../../common/utils/trace";
import { HelenaConfig } from "../../common/config/config";
import { MiscUtilities } from "../../common/misc_utilities";
import { Dataset } from "../dataset";
import { HelenaServer, RetrieveRelationsResponse } from "../utils/server";
import { StatementTypes } from "./statements/statement_types";
import { Environment } from "../environment";
import { RingerEvents } from "../../ringer-record-replay/common/event";
import { Replay } from "../../ringer-record-replay/mainpanel/replay";
import { ParameterizedTrace } from "../parameterized_trace";
import { NextButtonTypes, IColumnSelector } from "../../content/selector/interfaces";
import { RingerStatement, OutputPageVarStatement } from "./types";
import { HelenaBlocks } from "../ui/blocks";


// TODO: move these somewhere safer
let scrapingRunsCompleted = 0;
let datasetsScraped = [];

interface LoopItem {
  loopStatement: LoopStatement;
  nodeVariables: NodeVariable[];
  displayData: string[][];
}

export enum TraceContributions {
  NONE = 0,
  FOCUS
}

export interface RunObject {
  dataset: Dataset;
  environment: Environment.Frame;
  program: HelenaProgram;

  resumeContinuation?: Function;
  tab: string;
  userPaused?: boolean;
  userStopped?: boolean;
  window?: number;
}

export interface RunOptions {
  [key: string]: any;

  breakAfterXDuplicatesInARow?: number;
  breakMode?: boolean;
  dataset_id?: number;
  hashBasedParallel?: HashBasedParallel;
  ignoreEntityScope?: boolean;
  nameAddition?: string;
  parallel?: boolean;
  simulateError?: number[];
  skipCommitInThisIteration?: boolean;
  skipMode?: boolean;
}

interface Parameters {
  [key: string]: any;
}

// wonder if these shouldn't be moved to runObject instead of options.
//   should do that.
const internalOptions = ["skipMode", "breakMode", "skipCommitInThisIteration"];
const recognizedOptions = ["dataset_id", "ignoreEntityScope",
  "breakAfterXDuplicatesInARow", "nameAddition", "simulateError", "parallel",
  "hashBasedParallel", "restartOnFinish"];

/**
 * A Helena program.
 * @param statements 
 * @param addOutputStatement 
 */
export class HelenaProgram extends StatementContainer {
  public static wrapperNodeCounter = 0;

  public altRootBodyStatements?: HelenaLangObject[][];
  public associatedString?: string;   // save to server some string metadata
  public automaticLoopInsertionForbidden?: boolean;
  public defaultParamVals: Parameters;
  public id: string;
  public mostRecentRow?: string[];
  public name: string;
  public nextButtonAttemptsThreshold?: number;
  public pagesProcessed: {
    [key: string]: boolean;
  } = {};
  public pagesToFrames: {
    [key: string]: number[];
  } = {};
  public pagesToFrameUrls: {
    [key: string]: string[];
  } = {};
  public pagesToNodes: {
    [key: string]: string[];
  } = {};
  public pagesToUrls: {
    [key: string]: string;
  } = {};
  public pageVars: PageVariable[];
  public parameterNames?: string[];
  public relationFindingTimeoutThreshold?: number;
  public relations: GenericRelation[];
  public restartOnFinish?: boolean;
  public statements: HelenaLangObject[];
  public windowHeight?: number;
  public windowWidth?: number;

  constructor(statements: HelenaLangObject[], addOutputStatement = true) {
    super();

    Revival.addRevivalLabel(this);

    // cjbaik: added this because it doesn't seem to be initialized anywhere
    this.defaultParamVals = {};
    this.relations = [];

    this.statements = statements;
    this.pageVars =
      statements.filter((s) => (s instanceof PageActionStatement ||
                                s instanceof LoopStatement) && s.pageVar)
                .map((s: PageActionStatement) => <PageVariable> s.pageVar)                                                                                                                                                                           
    this.pageVars = [...new Set(this.pageVars)];
    this.bodyStatements = statements;  
    this.name = "";

    // add an output statement to the end if there are any scrape statements in
    //   the program.  should have a list of all scrape statements, treat them
    //   as cells in one row
    const scrapeStatements = <ScrapeStatement[]> this.statements.filter(
      (s) => s instanceof ScrapeStatement
    );
    if (addOutputStatement && scrapeStatements.length > 0) {
      this.statements.push(new OutputRowStatement(scrapeStatements));
    }
  }

  public static createDummy() {
    return new HelenaProgram([]);
  }

  public clone() {
    const replacer = (key: string, value: any) => {
      // filtering out the blockly block, which we can recreate from the rest of
      //   the state
      if (key === "block") {
        return undefined;
      }
      return value;
    }
    // deepcopy
    const programAttributes = window.JSOG.parse(
      window.JSOG.stringify(this, replacer));
    // copy all those fields back into a proper Program object
    const program = Revival.revive(programAttributes);
    return program;
  }

  public static fromRingerTrace(trace: Trace, windowId?: number,
      addOutputStatement?: boolean) {
    let dispTrace = <DisplayTraceEvent[]> trace.filter((event) =>
      // filter out stopped events
      // cjbaik: I don't think this attribute actually exists
      // event.state !== "stopped" &&

      // strip out events that weren't performed in the recording window
      (event.type === "manualload" || 
       (event.data && event.data.windowId === windowId) ||
       (event.frame && event.frame.windowId === windowId))
    ).map((event) =>
      Traces.prepareForDisplay(event)
    );
    dispTrace = markUnnecessaryLoads(dispTrace);
    dispTrace = associateNecessaryLoadsWithIDsAndParameterizePages(dispTrace);
    dispTrace = addCausalLinks(dispTrace);
    dispTrace = removeEventsBeforeFirstVisibleLoad(dispTrace);

    const segmentedTrace = segment(dispTrace);
    const prog = segmentedTraceToProgram(segmentedTrace, addOutputStatement);
    return prog;
  }

  public static fromJSON(json: string) {
    const programAttributes = window.JSOG.parse(json);

    // copy all those fields back into a proper Program object
    return <HelenaProgram> Revival.revive(programAttributes);
  }

  /**
   * Could not name this `toJSON` because JSOG treats objects with `toJSON`
   *   methods in a special way.
   */
  public convertToJSON() {
    return window.JSOG.stringify(this.clone());
  }

  public setName(str: string) {
    this.name = str;
  }

  public getName() {
    return this.name;
  }

  public setAssociatedString(str: string) {
    this.associatedString = str;
  }

  public getAssociatedString() {
    return this.associatedString;
  }

  public setId(id: string) {
    this.id = id;
    window.helenaMainpanel.UIObject.programIdUpdated(this);
  }

  public toString() {
    let statementLs = this.bodyStatements;
    if (this.bodyStatements.length === 0) {
      statementLs = this.statements;
    }
  
    let scriptString = "";
    for (const statement of statementLs) {
      const strLines = statement.toStringLines();
      if (strLines.length > 0) {
        scriptString += strLines.join("<br>") + "<br>";
      }
    }
    return scriptString;
  }

  public currentStatementLs() {
    let statementLs = this.bodyStatements;
    if (this.bodyStatements.length === 0) {
      statementLs = this.statements;
    }
    return statementLs;
  }

  public displayBlockly(workspace: Blockly.WorkspaceSvg) {
    const statementLs = this.currentStatementLs();

    // let's start with the real program, go through that
    let coords = null;
    if (statementLs[0].block) {
      coords = statementLs[0].block.getRelativeToSurfaceXY();

      // get rid of old version (discarding any unsaved blockly changes!)
      statementLs[0].block.dispose(false);
    }
    
    // now that we removed the real program, let's take this moment to grab all
    //   the alternative roots
    // we'll use these later
    const rootBlocklyBlocks = workspace.getTopBlocks(false);

    // add new version
    const rt = HelenaBlocks.helenaSeqToBlocklySeq(statementLs, workspace);
    if (coords) {
      rt.moveBy(coords.x, coords.y); // make it show up in same spot as before
    }

    // now let's go through all the other stuff the user might have lying around
    //   the workspace

    // clear out the current list of other roots that we associate with the
    //   program
    this.altRootBodyStatements = [];
    for (const block of rootBlocklyBlocks) {
      const rootHelena = window.helenaMainpanel.getHelenaStatement(block);
      if (!rootHelena) {
        // no helena associated with this one. guess we'll just throw it out
        continue;
      }
      const helenaSeq = window.helenaMainpanel.blocklySeqToHelenaSeq(block);
      this.altRootBodyStatements.push(helenaSeq);

      // delete the old version from the workspace
      const coords = block.getRelativeToSurfaceXY();
      block.dispose(false);
      // now display the new version
      const r = HelenaBlocks.helenaSeqToBlocklySeq(helenaSeq, workspace);
      if (coords) {
        r.moveBy(coords.x, coords.y); // make it show up in same spot as before
      }
    }  

    // now go through and actually display all those nodes
    // this will traverse all relevant nodes of this.bodyStatements and
    //   this.allRootbodyStatements
    this.traverse((stmt: HelenaLangObject) => {
      if (stmt.block) {
        const svgBlock = <Blockly.BlockSvg> stmt.block;
        svgBlock.initSvg();
        svgBlock.render();
      }
    }, () => {});
  }

  /**
   * Saves a HelenaProgram to the server.
   * @param afterId a callback handler that runs as soon as we have the
   *   necessary program id, and let the saving continue in the background
   *   because it takes a long time
   * @param saveStarted a callback handler when the save begins
   * @param saveDone a callback handler when the save completes
   */
  public saveToServer(afterId: Function, saveStarted: Function,
      saveDone: Function) {
    const self = this;
    const req = {
      id: this.id,
      name: this.name,
      tool_id: window.helenaMainpanel.toolId,
      associated_string: this.associatedString
    };
  
    HelenaConsole.log("about to post", (new Date().getTime()/1000));
    // this first request is just to get us the right program id to associate
    //   any later stuff with.  it won't actually save the program saving the
    //   program takes a long time, so we don't want other stuff to wait on it,
    //   will do it in background
    HelenaServer.saveProgram(req, (resp: ServerSaveResponse) => {
      HelenaConsole.log("server responded to program save");
      const progId = resp.program.id;
      self.setId(progId);
      // ok, now that we know the right program id (in cases where there wasn't
      //   one to begin with) we can save the actual program but it can take a
      //   long time for programs to arrive at server, so don't make other stuff
      //   wait on it.  just send it in the background
      setTimeout(() => {
        // todo: in future, don't filter.  actually save textrelations too
        const relationObjsSerialized =
          self.relations.filter((rel) => rel instanceof Relation)
                        .map((rel) => rel.convertToJSON());
        const serializedProg = self.convertToJSON();
        // sometimes serializedProg becomes null because of errors. in those
        //   cases, we don't want to overwrite the old, good program with the
        //   bad one. so let's prevent us from saving null in place of existing
        //   thing so that user can shut it off, load the saved program, start
        //   over
        if (serializedProg) {
          const req = {
            id: progId,
            serialized_program: serializedProg,
            relation_objects: relationObjsSerialized,
            name: self.name,
            associated_string: self.associatedString
          };
          HelenaServer.saveProgram(req, () => {
            // we've finished the save thing, so tell the user
            saveDone();
          }, true, " to save the program");
        }
      }, 0);

      // ok, we've set it up to do the actual program saving, but we already
      //   have the id, so do the postIdRetrievalContinuation
      if (afterId && typeof afterId === 'function') {
        afterId(progId);
      }
    });
    
    // we've sent the save thing, so tell the user
    saveStarted();
  }

  // a convenient way to traverse the statements of a program
  // todo: currently no way to halt traversal, may ultimately want fn arg to
  //   return boolean to do that
  public traverse(fn: Function, fn2: Function) {
    if (this.bodyStatements.length < 1) {
      HelenaConsole.warn("Calling traverse on a program even though " +
        "bodyStatements is empty.");
    }

    // go through our actual programs
    for (const stmt of this.bodyStatements) {
      stmt.traverse(fn, fn2);
    }

    // go through the other roots that are also available to us (usually because
    //   of blockly)
    if (this.altRootBodyStatements) {
      for (const statements of this.altRootBodyStatements) {
        for (const stmt of statements) {
          stmt.traverse(fn, fn2);
        }
      }
    }
  }

  public containsStatement(stmt: HelenaLangObject) {
    return firstTrueStatementTraverse(this.bodyStatements,
      (s: HelenaLangObject) => s === stmt
    );
  }

  public loadsUrl() {
    return firstTrueStatementTraverse(this.bodyStatements,
      (s: HelenaLangObject) => s instanceof LoadStatement
    );
  }

  public insertAfter(stmtToInsert: HelenaLangObject,
      stmtToInsertAfter: HelenaLangObject) {
    const possibleNewbodyStatements = insertAfterHelper(this.bodyStatements,
      stmtToInsert, stmtToInsertAfter);
    if (!possibleNewbodyStatements) {
      HelenaConsole.warn("Woah, tried to insert after a particular " +
        "WALStatement, but that statement wasn't in our prog.");
    } else {
      this.bodyStatements = possibleNewbodyStatements;
    }
  }

  // go through the program, look for the movedStatement and any
  //   statements/blocks that the Blockly UI would attach to it then remove those from the program
  /*
  public statementRemovedByUI(movedStatement, oldPriorStatement) {
    //console.log("statementRemovedByUI", movedStatement, oldPriorStatement);
    var seq = removeStatementAndFollowing(this.bodyStatements, movedStatement);
    //console.log("removed the seq:". removedSeq);
    if (!seq) {
      HelenaConsole.warn("Woah, tried to remove a particular WALStatement, but that statement wasn't in our prog.");
    }

    // now, if we end up pulling this same seq back in...better know about the seq
    movedStatement.associatedStatementSequence = seq;
    return seq;
  };

  this.statementAddedByUI = function(movedStatement, precedingStatement, inputName) {
    // a quick precaution.  it's not ok for statements to appear in the same program twice.  so make sure it's not already in there...
    // (this comes up when we're programmatically producing the blockly rep for an existing program)
    if (this.containsStatement(movedStatement)) {
      return;
    }

    // ok, we know which block is coming in, but don't necessarily know whether there's a sequence of blocks that should come with it
    // if there's one associated with the block, we'll use that.  otherwise we'll assume it's just the block itself
    // (as when the user has dragged in a brand new block, or even when we're programmatically buidling up the displayed program)
    var addedSeq = movedStatement.seq;
    if (!addedSeq) {
      addedSeq = [movedStatement];
    }

    var added = addSeq(this.bodyStatements, addedSeq, precedingStatement, inputName);
    if (!added) {
      HelenaConsole.warn("Woah, tried to insert after a particular WALStatement, but that statement wasn't in our prog.");
    }
    return added;
  }

  this.inputRemovedByUI = function() {

  }
  this.inputAddedByUI = function() {

  }*/

  public getDuplicateDetectionData() {
    const loopData: LoopItem[] = [];
    this.traverse((stmt: HelenaLangObject) => {
      if (stmt instanceof LoopStatement) {
        const newLoopItem: LoopItem = {
          loopStatement: stmt,   // the data we're building up
          nodeVariables: stmt.relationNodeVariables(),
          displayData: [[], []]
        };
        // let nodeVars = stmt.relationNodeVariables();
        const childStatements = stmt.getChildren();
        const scrapeChildren = [];
        for (const childStmt of childStatements) {
          if (childStmt instanceof ScrapeStatement &&
              !childStmt.scrapingRelationItem()) {
            scrapeChildren.push(childStmt);
          } else if (childStmt instanceof LoopStatement) {
            // convention right now, since duplicate detection is for avoiding
            //   repeat of unnecessary work, is that we make the judgment based
            //   on variables available before any nested loops
            break;
          }
        }
        const scrapeChildrenNodeVars = scrapeChildren.map(
          (scrapeS) => scrapeS.currentNode
        );

        // ok, newLoopItem.nodeVariables now has all our nodes
        newLoopItem.nodeVariables =
          newLoopItem.nodeVariables.concat(scrapeChildrenNodeVars);

        // in addition to just sending along the nodeVar objects, we also want
        //   to make the table of values
        for (const nv of newLoopItem.nodeVariables) {
          newLoopItem.displayData[0].push(nv.getName() + " text");
          newLoopItem.displayData[1].push(<string> nv.recordTimeText());
          newLoopItem.displayData[0].push(nv.getName() + " link");
          newLoopItem.displayData[1].push(<string> nv.recordTimeLink());
        }
        loopData.push(newLoopItem);
      }
    }, () => {});
    return loopData;
  }

  public getNodesFoundWithSimilarity() {
    const nodeData: NodeVariable[] = [];
    this.traverse((stmt: HelenaLangObject) => {
      if (stmt instanceof PageActionStatement &&
          stmt.currentNode.getSource() === NodeSources.RINGER) {
        //var statementData = {name: statement.currentNode}
        nodeData.push(stmt.currentNode);
      }
    }, () => {});
    return nodeData;
  }

  // just for replaying the straight-line recording, primarily for debugging
  public replayOriginal() {
    let trace: Trace = [];
    for (const stmt of this.statements) {
      if (stmt instanceof PageActionStatement) {
        trace = trace.concat(stmt.cleanTrace);
      }
    }
    for (const ev of trace) {
      Traces.clearDisplayInfo(<DisplayTraceEvent> ev);
    }

    window.ringerMainpanel.replayScript(trace, null, () => {
      HelenaConsole.log("Done replaying.");
    });
  }

/*
  function updatePageVars(recordTimeTrace, replayTimeTrace) {
    // we should see corresponding 'completed' events in the traces
    var recCompleted = _.filter(recordTimeTrace, function(ev) {return ev.type === "completed" && ev.data.type === "main_frame";}); // now only doing this for top-level completed events.  will see if this is sufficient
    var repCompleted = _.filter(replayTimeTrace, function(ev) {return ev.type === "completed" && ev.data.type === "main_frame";});
    HelenaConsole.log(recCompleted, repCompleted);
    // should have same number of top-level load events.  if not, might be trouble
    if (recCompleted.length !== repCompleted.length) {
      HelenaConsole.log("Different numbers of completed events in record and replay: ", recCompleted, repCompleted);
    }
    // todo: for now aligning solely based on point at which the events appear in the trace.  if we get traces with many events, may need to do something more intelligent
    var smallerLength = recCompleted.length;
    if (repCompleted.length < smallerLength) { smallerLength = repCompleted.length;}
    for (var i = 0; i < smallerLength; i++) {
      var pageVar = Trace.getLoadOutputPageVar(recCompleted[i]);
      if (pageVar === undefined) {
        continue;
      }
      pageVar.setCurrentTabId(repCompleted[i].data.tabId);
    }
  }
  */

  private doTheReplay(runnableTrace: Trace, config: object,
      basicBlockStmts: RingerStatement[], runObject: RunObject,
      bodyStatements: HelenaLangObject[], nextBlockStartIndex: number,
      callback: Function, options: RunOptions) {
    const self = this;
    // first let's throw out any wait time on the first event, since no need to
    //   wait for that
    if (runnableTrace.length > 0) {
      runnableTrace[0].timing.waitTime = 0;
    }
    window.ringerMainpanel.replayScript(runnableTrace, config,
        (replayObject: Replay) => {
      // use what we've observed in the replay to update page variables
      HelenaConsole.namedLog("rbb", "replayObject", replayObject);

      // based on the replay object, we need to update any pagevars involved in
      //   the trace
      let trace: Trace = [];
      for (const stmt of basicBlockStmts) {
        // want the trace with display data, not the clean trace
        trace = trace.concat(stmt.trace);
      }
      
      //updatePageVars(trace, replayObject.record.events);
      // ok, it's time to update the pageVars, but remember that's going to
      //   involve checking whether we got a reasonable page
      const allPageVarsOk = () => {
        // statements may need to do something based on this trace, so go ahead
        //   and do any extra processing
        for (let i = 0; i < basicBlockStmts.length; i++) {
          HelenaConsole.namedLog("rbb", "calling postReplayProcessing on",
            basicBlockStmts[i]);
          basicBlockStmts[i].postReplayProcessing(runObject,
            replayObject.record.events, i);
        }

        // once we're done replaying, have to replay the remainder of the script
        self.runBasicBlock(runObject, bodyStatements.slice(nextBlockStartIndex,
          bodyStatements.length), callback, options);
      };
      updatePageVars(trace, replayObject.record.events, allPageVarsOk);
    },
      // ok, we also want some error handling functions
    {
      findNodeWithoutRequiredFeatures: (replayObject: Replay,
         ringerContinuation: Function | null) => {
        // todo: note that continuation doesn't actually have a continuation yet
        //   because of Ringer-level implementation if you decide to start using
        //   it, you'll have to go back and fix that.
        //   see record-replay/mainpanel_main.js

        // for now, if we fail to find a node where the user has insisted it has
        //   a certain set of features, we want to just skip the row.
        // essentially want the continue action, so we want the callback that's
        //   supposed to happen at the end of running the rest of the script for
        //   this iteration
        // so we'll skip doing
        //   program.runBasicBlock(bodyStatements.slice(nextBlockStartIndex,
        //     bodyStatements.length), callback) (as above)
        // instead we'll just do the callback
        HelenaConsole.warn("rbb: couldn't find a node based on " +
          "user-required features.  skipping the rest of this row.");

        // even though couldn't complete the whole trace, still need to do
        //   updatePageVars because that's how we figure out which tab is
        //   associated with which pagevar, so that we can go ahead and do tab
        //   closing and back button pressing at the end
        
        // this is partly the same as the other allPageVarsOk
        const allPageVarsOk = () => {
          // in the continuation, we'll do the actual move onto the next 
          //   statement
          options.skipMode = true;

          // for now we'll assume that this means we'd want to try again in
          //   future in case something new is added
          //options.skipCommitInThisIteration = true;

          // once we're done replaying, have to replay the remainder of the
          //   script want to skip the rest of the loop body, so go straight to
          //   callback
          callback();
        };

        let trace: Trace = [];
        for (const stmt of basicBlockStmts) {
          // want the trace with display data, not the clean trace
          trace = trace.concat(stmt.trace);
        }
        updatePageVars(trace, replayObject.record.events, allPageVarsOk);
      },
      portFailure: (replayObject: Replay,
          ringerContinuation: Function | null) => {
        // for now I haven't seen enough of these failures in person to know a
        //   good way to fix them
        // for now just treat them like a node finding failure and continue

        HelenaConsole.warn("rbb: port failure.  ugh.");

        // even though couldn't complete the whole trace, still need to do
        //   updatePageVars because that's how we figure out which tab is
        //   associated with which pagevar, so that we can go ahead and do tab
        //   closing and back button pressing at the end
        
        // this is partly the same as the other allPageVarsOk
        const allPageVarsOk = () => {
          // in the continuation, we'll do the actual move onto the next
          //   statement
          options.skipMode = true;

          // for now we'll assume that this means we'd want to try again in
          //   future in case something new is added
          //options.skipCommitInThisIteration = true;

          // once we're done replaying, have to replay the remainder of the
          //   script
          // want to skip the rest of the loop body, so go straight to callback
          callback();
        };

        let trace: Trace = [];
        for (const stmt of basicBlockStmts) {
          // want the trace with display data, not the clean trace
          trace = trace.concat(stmt.trace);
        }
        updatePageVars(trace, replayObject.record.events, allPageVarsOk);
      }
    });
  }

  private runBasicBlockWithRinger(bodyStmts: HelenaLangObject[],
      options: RunOptions, runObject: RunObject, callback: Function) {
    const self = this;
    const nextBlockStartIndex = determineNextBlockStartIndex(bodyStmts); 
    let basicBlockStmts = selectBasicBlockStatements(bodyStmts,
      nextBlockStartIndex);
    basicBlockStmts = markNonTraceContributingStatements(basicBlockStmts);

    const haveAllNecessaryRelationNodes =
      doWeHaveRealRelationNodesWhereNecessary(basicBlockStmts,
        runObject.environment);
    if (!haveAllNecessaryRelationNodes) {
      // ok, we're going to have to skip this iteration, because we're supposed
      //   to open a page and we just won't know how to
      HelenaConsole.warn("Had to skip an iteration because of lacking " +
        "the node we'd need to open a new page");
      // todo: should probably also warn the contents of the various relation
      //   variables at this iteration that we're skipping

      // we're essentially done 'replaying', have to replay the remainder of the
      //   script and we're doing continue, so set the continue flag to true
      options.skipMode = true;
      self.runBasicBlock(runObject, bodyStmts.slice(nextBlockStartIndex,
        bodyStmts.length), callback, options);
      return;
    }

    // make the trace we'll replay
    const trace = makeTraceFromStatements(basicBlockStmts);
    if (trace.length < 1) {
      // ok, no point actually running Ringer here...  let's skip straight to
      //   the 'callback!'
      // statements may need to do something as post-processing, even without a
      //   replay so go ahead and do any extra processing
      for (let i = 0; i < basicBlockStmts.length; i++) {
        HelenaConsole.namedLog("rbb", "calling postReplayProcessing on",
          basicBlockStmts[i]);
        basicBlockStmts[i].postReplayProcessing(runObject, [], i);
      }
      // once we're done replaying, have to replay the remainder of the script
      self.runBasicBlock(runObject, bodyStmts.slice(nextBlockStartIndex,
        bodyStmts.length), callback, options);
      return;
    }

    // ok, passArguments below is going to clone the trace, and the trace is
    //   huge so currently thinking this may often be the place where we get
    //   close to running out of memory so let's check and make sure we have
    //   enough memory
    // and if we don't, let's make sure the user really wants to continue

    let continueWithScriptExecuted = false;

    const continueWithScript = () => {
      continueWithScriptExecuted = true;

      // first call the run methods for any statements that have run methods in
      //   case it's needed for making the arguments
      // todo: note that this should actually happen interspersed with the
      //   ringer replay.  do that evenutally
      for (const stmt of basicBlockStmts) {
        if (stmt.run) {
          stmt.run(runObject, () => {}, options);
        }
      }

      // now that we have the trace, let's figure out how to parameterize it
      // note that this should only be run once the current___ variables in the
      //   statements have been updated!  otherwise won't know what needs to be
      //   parameterized, will assume nothing
      // should see in future whether this is a reasonable way to do it
      HelenaConsole.namedLog("rbb", "trace", trace);
      const parameterizedTrace = pbv(trace, basicBlockStmts);
      
      // now that we've run parameterization-by-value, have a function, let's
      //   put in the arguments we need for the current run
      HelenaConsole.namedLog("rbb", "parameterizedTrace",
        parameterizedTrace);
      const runnableTrace = passArguments(parameterizedTrace, basicBlockStmts,
        runObject.environment);
      const config = parameterizedTrace.getConfig();
      config.targetWindowId = runObject.window;
      HelenaConsole.namedLog("rbb", "runnableTrace", runnableTrace, config);

      // the above works because we've already put in VariableUses for statement
      //   arguments that use relation items, for all statements within a loop,
      //   so currNode for those statements will be a variableuse that uses the
      //   relation
      // however, because we're only running these basic blocks, any uses of
      //   relation items (in invisible events) that happen before the for loop
      //   will not get parameterized, since their statement arguments won't be
      //   changed, and they won't be part of the trace that does have statement
      //   arguments changed (and thus get the whole trace parameterized for
      //   that)
      // I don't see right now how this could cause issues, but it's worth
      //   thinking about
      
      self.doTheReplay(runnableTrace, config, basicBlockStmts, runObject,
        bodyStmts, nextBlockStartIndex, callback, options);
    }

    /*
    splitOnEnoughMemoryToCloneTrace(trace,
      function() { // if enough memory
        // plenty of memory.  carry on.
        continueWithScript();
      },
      function() { // if not enough memory
        // yikes, there's a pretty small amount of memory available at this point.  are you sure you want to go on?
    console.log("decided we don't have enough memory.  pause.");
        var text = "Looks like we're pretty close to running out of memory.  If we keep going, the extension might crash.  Continue anyway?";
        var buttonText = "Continue";
        var dialogDiv = UIObject.continueAfterDialogue(text, buttonText, continueWithScript);

        // we might like to check now and then to see if more memory has been freed up, so that we could start again
        MiscUtilities.repeatUntil(
          function() {
      console.log("do we have enough memory?");
            splitOnEnoughMemoryToCloneTrace(trace,
              function() { // enough memory now, so we actually want to continue
    console.log("changed our minds.  decided we do have enough memory.");
                dialogDiv.remove(); // get rid of that dialog, so user doesn't see it
                continueWithScript();
              },
              function() {}); // if there's not enough memory, just don't do anything, keep waiting for user
          }, // repeat this
          function() {return continueWithScriptExecuted;}, // until this
          function() {}, // don't have any functions to run after the condition is reached
          60000, false); // just check every minute
      });
      */
      continueWithScript();
  }

  public runBasicBlock(runObject: RunObject, bodyStmts: HelenaLangObject[],
      callback: Function, options: RunOptions = {}) {
    const self = this;
    HelenaConsole.namedLog("rbb", bodyStmts.length, bodyStmts);

    // first check if we're supposed to pause, stop execution if yes
    HelenaConsole.namedLog("rbb", "runObject.userPaused",
      runObject.userPaused);
    if (runObject.userPaused) {
      const repWindowId = window.helenaMainpanel.currentReplayWindowId;
      window.helenaMainpanel.currentReplayWindowId = null;
      runObject.resumeContinuation = () => {
        window.helenaMainpanel.currentReplayWindowId = repWindowId;
        self.runBasicBlock(runObject, bodyStmts, callback, options);
      };
      HelenaConsole.log("paused");
      return;
    }
    HelenaConsole.log("runObject.userStopped", runObject.userStopped);
    if (runObject.userStopped) {
      HelenaConsole.log("run stopped");
      
      // set it back so that if the user goes to run again, everything will work
      runObject.userStopped = false;
      return;
    }

    if (bodyStmts.length < 1) {
      HelenaConsole.namedLog("rbb", "rbb: empty loopystatments.");
      callback(options);
      return;
    } else if (bodyStmts[0] instanceof LoopStatement) {
      const loopStmt = <LoopStatement> bodyStmts[0];
      const relation = <Relation> loopStmt.relation;

      // for now LoopStatement gets special processing
      if (options.skipMode) {
        // in this case, when we're basically 'continue'ing, it's as if this
        //   loop is empty, so skip straight to that
        self.runBasicBlock(runObject, bodyStmts.slice(1, bodyStmts.length),
          callback, options);
        return;
      }
      HelenaConsole.namedLog("rbb", "rbb: loop.");

      const cleanupAfterLoopEnd = (continuation: Function) => {
        loopStmt.rowsSoFar = 0;

        if (loopStmt.pageVar) {
          const prinfo = relation.getPrinfo(loopStmt.pageVar);
          HelenaConsole.namedLog("prinfo", "change prinfo, finding for cleanup");
          HelenaConsole.namedLog("prinfo", shortPrintString(prinfo));
          HelenaConsole.log("prinfo in cleanup", prinfo);
          // have to get rid of this prinfo in case (as when a pulldown menu is
          //   dynamically adjusted by another, and so we want to come back and
          //   get it again later) we'll want to scrape the same relation fresh
          //   from the same page later
          delete loopStmt.pageVar.pageRelations[relation.name+"_"+relation.id];
          HelenaConsole.namedLog("prinfo", "cleared a page relation entry"); 
        }
        
        // time to run end-of-loop-cleanup on the various bodyStatements
        loopStmt.traverse((stmt: HelenaLangObject) => {
          // cjbaik: not sure if SkipBlocks actually pass thru here but safer to
          //   assume so
          if (stmt instanceof LoopStatement || stmt instanceof SkipBlock) {
            stmt.endOfLoopCleanup(continuation);
          }
        }, () => {});
      }

      // are we actually breaking out of the loop?
      if (options.breakMode) {
        HelenaConsole.warn("breaking out of the loop");
        // if we were in break mode, we're done w/loop, so turn off break mode
        options.breakMode = false;
        const continuation = () => {
          // once we're done with the loop, have to replay the remainder of the
          //   script
          self.runBasicBlock(runObject, bodyStmts.slice(1, bodyStmts.length),
            callback, options);   
        }
        cleanupAfterLoopEnd(continuation);
        return;
      }

      // have we hit the maximum number of iterations we want to do?
      if (loopStmt.maxRows !== null && loopStmt.rowsSoFar >= loopStmt.maxRows) {
        // hey, we're done!
        HelenaConsole.namedLog("rbb", "hit the row limit");
        const continuation = () => {
          // once we're done with the loop, have to replay the remainder of the
          //   script
          self.runBasicBlock(runObject, bodyStmts.slice(1, bodyStmts.length),
            callback, options);
        }
        cleanupAfterLoopEnd(continuation);
        return;
      }

      // if we're going to simulate an error at any point, is this the point?
      if (options.simulateError) {
        const targetIterations = options.simulateError;
        // gets the iterations of this loop and any ancestor loops
        const currentIterations = loopStmt.getLoopIterationCounters();
        // first make sure we're actually on the right loop.  no need to check
        //   if we're still on the outermost loop but breaking in the innermost
        if (currentIterations.length >= targetIterations.length) {
          // ok, that last loop is the one we're about to run, including upping
          //   the rowsSoFar counter, so up that now.  no need to fetch row if
          //   we're supposed to error now
          currentIterations[currentIterations.length - 1] =
            currentIterations[currentIterations.length - 1] + 1;
          // now that we know we're at the right loop or deeper, let's check...
          let timeToError = true;
          for (let i = 0; i < targetIterations.length; i++) {
            if (currentIterations[i] > targetIterations[i]) {
              // ok, it's time.  need this case if we never hit the iteration on
              //   an inner loop, so we do the error at the start of the next
              //   loop
              timeToError = true;
              break;
            }
            if (currentIterations[i] < targetIterations[i]) {
              timeToError = false; // ok, we're not there yet
              break;
            }
            // if it's equal, check the next nested loop
          }
          // at this point, only if all loops were greater than or equal to the
          //   target number of iterations will timeToError be true
          if (timeToError) {
            // remember, when we rerun, don't error anymore!  don't want an
            //   infinite loop.
            options.simulateError = undefined;
            // first close the old dataset object in order to flush all its data
            //   to the server
            runObject.dataset.closeDataset();
            // now restart
            // all other options should be the same, except that we shouldn't
            //   simulate the error anymore and must make sure to use the same
            //   dataset
            options.dataset_id = runObject.dataset.getId();
            runObject.program.runProgram(options); 

            // don't run any of the callbacks for this old run! we're done w/it!
            return;
          }
        }
      }

      loopStmt.relation.getNextRow(runObject, loopStmt.pageVar,
          (moreRows: boolean) => {
        if (!moreRows) {
          // hey, we're done!
          HelenaConsole.namedLog("rbb", "no more rows");
          const continuation = () => {
            // once we're done with the loop, have to replay the remainder of
            //   the script
            self.runBasicBlock(runObject, bodyStmts.slice(1, bodyStmts.length),
              callback, options);
          }
          cleanupAfterLoopEnd(continuation);
          return;
        }
        HelenaConsole.namedLog("rbb", "we have a row!  let's run");
        // otherwise, should actually run the body
        loopStmt.rowsSoFar += 1;
        // block scope.  let's add a new frame
        runObject.environment = runObject.environment.envExtend();
        HelenaConsole.namedLog("rbb", "envExtend done");
        // and let's give us access to all the loop variables
        // note that for now loopVarsMap includes all columns of the relation.
        //   may some day want to limit it to only the ones used...
        loopStmt.updateRelationNodeVariables(runObject.environment);
        HelenaConsole.namedLog("rbb", "bodyStatements", bodyStmts);

        // running extra iterations of the for loop is the only time we change
        //   the callback
        self.runBasicBlock(runObject, loopStmt.bodyStatements, () => {
          // and once we've run the body, we should do the next iteration of the
          //   loop but first let's get rid of that last environment frame
          HelenaConsole.namedLog("rbb", "rbb: preparing for next loop " +
            "iteration, popping frame off environment.");
          if (runObject.environment.parent) {
            runObject.environment = runObject.environment.parent;
          }
          // for the next iteration, we'll be back out of skipMode if we were in
          //   skipMode and let's run loop cleanup, since we actually ran the
          //   body statements
          // we don't skip things in the cleanup, so time to swap those off
          options.skipMode = false;
          options.skipCommitInThisIteration = false;

          // the main way we clean up is by running the cleanupStatements
          self.runBasicBlock(runObject, loopStmt.cleanupStatements, () => {
            // and once we've done that loop body cleanup, then let's finally
            //   go ahead and go back to do the loop again!
            HelenaConsole.namedLog("rbb", "Post-cleanupstatements.")
            self.runBasicBlock(runObject, bodyStmts, callback, options); 
          }, options);
        }, options);
      });
      return;
    } else if (!bodyStmts[0].isRingerBased()) {
      // also need special processing for back statements, if statements,
      //   continue statements, whatever isn't ringer-based
      HelenaConsole.namedLog("rbb", "rbb: non-Ringer-based statement.");

      if (options.skipMode || options.breakMode) {
        // in this case, when we're basically 'continue'ing, we should do
        //   nothing
        self.runBasicBlock(runObject, bodyStmts.slice(1, bodyStmts.length),
          callback, options);
        return;
      }

      // normal execution, either because we're not in skipMode, or because we
      //   are but it's a back or a close
      const continuation = (rbboptions: RunOptions) => { 
        // remember that rbbcontinuations passed to run methods must always
        //   handle rbboptions
        // rbboptions includes skipMode to indicate whether we're continuing
        // once we're done with this statement running, have to replay the
        //   remainder of the script
        self.runBasicBlock(runObject, bodyStmts.slice(1, bodyStmts.length),
          callback, rbboptions);
      };
      bodyStmts[0].run(runObject, continuation, options);
      return;
    } else {
      HelenaConsole.namedLog("rbb", "rbb: r+r.");
      // the fun stuff!  we get to run a basic block with the r+r layer

      if (options.skipMode || options.breakMode) {
        // in this case, when we're basically 'continue'ing, we should do
        //   nothing, so just go on to the next statement without doing anything
        //   else
        self.runBasicBlock(runObject, bodyStmts.slice(1, bodyStmts.length),
          callback, options);
        return;
      }

      self.runBasicBlockWithRinger(bodyStmts, options, runObject, callback);
    }
  }

  public turnOffDescentIntoLockedSkipBlocks() {
    this.traverse(function(stmt: HelenaLangObject) {
      if (stmt instanceof SkipBlock) {
        stmt.descendIntoLocks = false;
      }
    }, () => {});
  }

  /**
   * 
   * @param options 
   * @param continuation 
   * @param parameters 
   * @param requireDataset should only be false if we're sure users shouldn't be
   *  putting in output rows...
   */
  public runProgram(options: RunOptions = {}, continuation?: Function,
      parameters: Parameters = {}, requireDataset = true) {
    const self = this;
    console.log("program run");
    console.log("options", options);
    console.log("continuation", continuation);
    console.log("parameters", parameters);

    HelenaConsole.log("parameters", parameters);
    for (const prop in options) {
      if (!recognizedOptions.includes(prop)) {
        // woah, bad, someone thinks they're providing an option that will
        //   affect us, but we don't know what to do with it
        // don't let them think everything's ok, especially since they probably
        //   just mispelled
        HelenaConsole.warn("Woah, woah, woah.  Tried to provide option " +
          prop + " to program run, but we don't know what to do with it.");
        if (internalOptions.includes(prop)) {
          // ok, well an internal prop sneaking in is ok, so we'll just provide a warning.  otherwise we're actually going to stop
          HelenaConsole.warn("Ok, we're allowing it because it's an " +
            "internal option, but we're not happy about it and we're setting " +
            "it to false.");
          options[prop] = false;
        } else {
          return;
        }
      }
    }

    // in case we left the last run in a bad state, let's go ahead and make sure
    //   we'll parallelize at top level
    this.turnOffDescentIntoLockedSkipBlocks();

    // before we start running, let's check if we need to update the
    //   continuation in order to make it loop on this script forever
    // (if it's one of those programs where we're supposed to go back and run
    //   again as soon as we finish)
    let fullContinuation = continuation;
    if (this.restartOnFinish || options.restartOnFinish === true) {
      // yep, we want to repeat.  time to make a new continuation that, once it
      //   finishes the original continuation
      // will make a new dataset and start over. the loop forever option/start
      //   again when done option
      fullContinuation = (dataset: Dataset, timeScraped: number,
          tabId: number) => {
        if (continuation) {
          continuation(dataset, timeScraped, options);
        }
        // TODO: cjbaik: not sure what the tabId is doing here, is !! correct?
        self.runProgram(options, continuation, parameters, !!tabId);
      }
    }

    if (options.dataset_id) {
      // no need to make a new dataset
      const dataset = new Dataset(self, options.dataset_id);
      runInternals(this, parameters, dataset, options, fullContinuation);
    } else {
      // ok, have to make a new dataset
      const dataset = new Dataset(self);
      // it's really annoying to go on without having an id, so let's wait till
      //   we have one
      const continueWork = () => {
        adjustDatasetNameForOptions(dataset, options);
        runInternals(self, parameters, dataset, options, fullContinuation);       
      }

      if (requireDataset) {
        MiscUtilities.repeatUntil(
          () => {}, 
          () => dataset.isReady(),
          () => { continueWork(); },
          1000, true);
      } else {
        continueWork();
      }
    }
  }

  public restartFromBeginning(runObjectOld: RunObject, continuation: Function) {
    // basically same as above, but store to the same dataset (for now, dataset
    //   id also controls which saved annotations we're looking at)
    runObjectOld.program.runProgram({
      dataset_id: runObjectOld.dataset.getId()
    }, continuation);
  }

  public stopRunning(runObject: RunObject) {
    if (!runObject.userPaused) {
      // don't need to stop continuation chain unless it's currently going; if
      //   paused, isn't going, stopping flag won't get turned off and will
      //   prevent us from replaying later
      runObject.userStopped = true; // this will stop the continuation chain
    }
    // should we even bother saving the data?
    runObject.dataset.closeDataset();
    this.clearRunningState();

    // todo: is current (new) stopReplay enough to make sure that when we try to
    //   run the script again, it will start up correctly?
    window.ringerMainpanel.stopReplay();
  }

  public clearRunningState() {
    for (const relation of this.relations) {
      relation.clearRunningState();
    }
    for (const pageVar of this.pageVars) {
      pageVar.clearRunningState();
    }
    this.traverse((stmt: HelenaLangObject) => {
      stmt.clearRunningState();
    }, () => {});
  }

  public setParameterNames(paramNamesLs: string[]) {
    console.log("setParameterNames", paramNamesLs);
    this.parameterNames = paramNamesLs;
    // when you make parameters, they might be referred to by NodeVariableUse
    //   expressions so you need to make node variables for them (even though of
    //   course they aren't nodes)
    // todo: do we want to restructure this in some way?
    for (const paramName of paramNamesLs) {
      var nodeVar = window.helenaMainpanel.getNodeVariableByName(paramName);
      if (!nodeVar) {
        new NodeVariable(paramName, { text: "" }, { text: "" }, null,
          NodeSources.PARAMETER);
      }
    }
  }

  public getParameterNames() {
    return this.parameterNames;
  }

  public setParameterDefaultValue(paramName: string, paramVal: any) {
    this.defaultParamVals[paramName] = paramVal;
  }

  public getParameterDefaultValues() {
    return this.defaultParamVals;
  }

  public getAllVariableNames() {
    // start with the parameters to the program
    let variableNames: string[] = [];
    let paramNames = this.getParameterNames();
    if (paramNames) {
      variableNames = paramNames.slice();
    }
    this.traverse((stmt: HelenaLangObject) => {
      if (stmt instanceof LoopStatement) {
        variableNames = variableNames.concat(stmt.relation.columnNames());
      } else if (stmt instanceof ScrapeStatement &&
                 !stmt.scrapingRelationItem()) {
        variableNames.push(stmt.currentNode.getName());
      }
    }, () => {});
    // cjbaik: could replace this with different function, but need to make sure
    //   our replacement for _.uniq preserves ordering
    return _.uniq(variableNames);
  }

  public makeVariableNamesDropdown() {
    const varNames = this.getAllVariableNames();
    const varNamesDropDown = [];
    for (const varName of varNames) {
      varNamesDropDown.push([varName, varName]);
    }
    return varNamesDropDown;
  }

  public prepareToRun() {
    this.traverse((stmt: HelenaLangObject) => {
      stmt.prepareToRun();
    }, () => {});
  }

  public relevantRelations() {
    const self = this;
    // ok, at this point we know the urls we've used and the xpaths we've used
    //   on them. we should ask the server for relations that might help us out
    // when the server gets back to us, we should try those relations on the
    //   current page. we'll compare those against the best we can create on the
    //   page right now, pick the winner

    // get the xpaths used on the urls
    // todo: right now we're doing this on a page by page basis, splitting into
    //   assuming it's one first row per page (tab)...
    // but it should really probably be per-frame, not per tab
    for (const stmt of this.statements) {
      if (stmt instanceof ScrapeStatement ||
          stmt instanceof ClickStatement ||
          stmt instanceof PulldownInteractionStatement) {
        // todo: in future, should get the whole node info, not just the xpath,
        //   but this is sufficient for now
        const xpath = stmt.node;
        // pagevar is better than url for helping us figure out what was on a
        //   given logical page
        const pageVarName = stmt.pageVar?.name;
        const url = stmt.pageVar?.recordTimeUrl;
        const frameUrl = stmt.trace[0].frame.URL;
        const frameId = stmt.trace[0].frame.iframeIndex;

        if (pageVarName) {
          if (!(pageVarName in this.pagesToNodes)) {
            this.pagesToNodes[pageVarName] = [];
          }
          if (xpath && !this.pagesToNodes[pageVarName].includes(xpath)) {
            this.pagesToNodes[pageVarName].push(xpath);
          }

          if (!(pageVarName in this.pagesToFrameUrls)) {
            this.pagesToFrameUrls[pageVarName] = [];
          }
          this.pagesToFrameUrls[pageVarName].push(frameUrl);

          if (!(pageVarName in this.pagesToFrames)) {
            this.pagesToFrames[pageVarName] = [];
          }
          this.pagesToFrames[pageVarName].push(frameId);

          if (url) {
            this.pagesToUrls[pageVarName] = url;
          }
        } else {
          console.warn("No valid pageVarName set.");
        }
      }
    }
    // ask the server for relations
    // sample: $($.post('http://localhost:3000/retrieverelations', { pages: [{xpaths: ["a[1]/div[2]"], url: "www.test2.com/test-test"}] }, function(resp) { HelenaConsole.log(resp);} ));
    const reqList = [];
    for (const pageVarName in this.pagesToNodes) {
      reqList.push({
        url: this.pagesToUrls[pageVarName],
        xpaths: this.pagesToNodes[pageVarName],
        page_var_name: pageVarName,
        frame_ids: this.pagesToFrames[pageVarName]
      });
    }
    HelenaServer.retrieveRelations({ pages: reqList },
      (resp: RetrieveRelationsResponse) => {
        self.processServerRelations(resp);
      }
    );
  }

  public processServerRelations(resp: RetrieveRelationsResponse,
      currentStartIndex = 0, tabsToCloseAfter: number[] = [], tabMapping = {},
      windowId?: number, pageCount = 0) {
    const self = this;
    
    // we're ready to try these relations on the current pages
    // to do this, we'll have to actually replay the script
    const startIndex = currentStartIndex;

    const runRelationFindingInNewWindow = (windowId: number) => {
      // let's find all the statements that should open new pages (where we'll
      //   need to try relations)
      for (let i = currentStartIndex; i < self.statements.length; i++) {
        const curStmt = self.statements[i];
        if (curStmt.hasOutputPageVars()) {
          pageCount += 1;
          if (window.helenaMainpanel.UIObject.handleRelationFindingPageUpdate) {
            window.helenaMainpanel.UIObject.handleRelationFindingPageUpdate(
              pageCount);
          }

          // todo: for now this code assumes there's exactly one outputPageVar.
          //   this may not always be true!  but dealing with it now is a bad
          //   use of time
          const outputPVStmt = (<OutputPageVarStatement> curStmt);
          const outputPageVars = <PageVariable[]> outputPVStmt.outputPageVars;
          const targetPageVar = outputPageVars[0];
          HelenaConsole.log("processServerrelations going for index:", i,
            targetPageVar);

          // this is one of the points to which we'll have to replay
          const statementSlice = self.statements.slice(startIndex, i + 1);
          let trace: Trace = [];
          for (const stmt of statementSlice) {
            trace = trace.concat((<OutputPageVarStatement> stmt).cleanTrace);
          }
          // strip the display info back out from the event objects
          //_.each(trace, function(ev) {Trace.clearDisplayInfo(ev);});

          HelenaConsole.log("processServerrelations program: ", self);
          HelenaConsole.log("processServerrelations trace indexes: ",
            startIndex, i);
          HelenaConsole.log("processServerrelations trace:", trace.length);

          const nextIndex = i + 1;

          // ok, we have a slice of the statements that should produce one of
          //   our pages. let's replay
          // todo, if we fail to find it with this approach, start running
          //   additional statements (seomtimes the relation is only displayed
          //   after user clicks on an element, that kind of thing)
          window.ringerMainpanel.replayScript(trace, {
            tabMapping: tabMapping,
            targetWindowId: windowId
          }, (replayObj: Replay) => {
            // continuation
            HelenaConsole.log("replayobj", replayObj);

            // what's the tab that now has the target page?
            const replayTrace = replayObj.record.events;
            const lastCompletedEvent = Traces.lastTopLevelCompletedEvent(
              replayTrace);
            let lastCompletedEventTabId = Traces.tabId(lastCompletedEvent);
            // what tabs did we make in the interaction in general?
            tabsToCloseAfter = tabsToCloseAfter.concat(
              Traces.tabsInTrace(replayTrace));
            // also sometimes it's important that we bring this tab (on which
            //   we're about to do relation finding)
            // to be focused, so that it will get loaded and we'll be able to
            //   find the relation
            chrome.tabs.update(lastCompletedEventTabId, { active: true },
              (tab) => { });
            // I know I know, I should really have all the rest of this inside
            //   the callback for the tab update
            // but we didn't even do this in the past and it's pretty fast...

            // let's do some trace alignment to figure out a tab mapping
            const newMapping = tabMappingFromTraces(trace, replayTrace);
            tabMapping = _.extend(tabMapping, newMapping);
            HelenaConsole.log(newMapping, tabMapping);

            // and what are the server-suggested relations we want to send?
            const resps = resp.pages;
            let suggestedRelations: (RelationSelector | null)[] | null = null;
            for (const resp of resps) {
              const pageVarName = resp.page_var_name;
              if (pageVarName === targetPageVar.name) {
                suggestedRelations = [];

                const sameDomainRelSel = resp.relations.same_domain_best_relation;
                if (sameDomainRelSel !== null) {
                  suggestedRelations.push(
                    RelationSelector.fromJSON(sameDomainRelSel));
                } else {
                  suggestedRelations.push(sameDomainRelSel);
                }

                const sameUrlRelSel = resp.relations.same_url_best_relation;
                if (sameUrlRelSel !== null) {
                  suggestedRelations.push(
                    RelationSelector.fromJSON(sameUrlRelSel));
                } else {
                  suggestedRelations.push(sameUrlRelSel);
                }

                /*
                suggestedRelations = [
                  resp.relations.same_domain_best_relation,
                  resp.relations.same_url_best_relation
                ];
                for (let j = 0; j < suggestedRelations.length; j++) {
                  if (suggestedRelations[j] === null) {
                    continue;
                  }
                  // is this the best place to deal with going between our
                  //   object attributes and the server strings?
                  suggestedRelations[j] = RelationSelector.fromJSON(
                    suggestedRelations[j]);
                }*/
              }
            }

            if (suggestedRelations === null) {
              HelenaConsole.log("Panic!  We found a page in our " +
                "outputPageVars that wasn't in our request to the server for " +
                "relations that might be relevant on that page.");
            }

            let framesHandled: {
              [key: string]: RelationResponse;
            } = {};

            // we'll do a bunch of stuff to pick a relation, then we'll call
            //   this function
            const handleSelectedRelation = (data: RelationResponse) => {
              // handle the actual data the page sent us, if we're still
              //   interested in adding loops

              // if we're in this but the user has told us to stop trying to
              //   automatically add relations, let's stop
              if (self.automaticLoopInsertionForbidden) {
                // don't even go running more ringer stuff if we're not
                //   interested in seeing more loops inserted
                return;
              }

              // ok, normal processing.  we want to add a loop for this relation
              if (data) {
                self.processLikelyRelation(data);
              }
              // update the control panel display
              // true because we're still unearthing interesting relations, so
              //   should indicate we're in progress
              window.helenaMainpanel.UIObject.updateDisplayedRelations(true);
              // now let's go through this process all over again for the next
              //   page, if there is one
              HelenaConsole.log("going to processServerRelations with " +
                "nextIndex: ", nextIndex);
              self.processServerRelations(resp, nextIndex, tabsToCloseAfter,
                tabMapping, windowId, pageCount);
            };

            if (window.helenaMainpanel.UIObject.
                handleFunctionForSkippingToNextPageOfRelationFinding) {
              window.helenaMainpanel.UIObject.
                handleFunctionForSkippingToNextPageOfRelationFinding(
                  handleSelectedRelation);
            }

            // this function will select the correct relation from amongst a
            //   bunch of frames' suggested relatoins
            let processedTheLikeliestRelation = false;
            const pickLikelyRelation = () => {
              if (processedTheLikeliestRelation) {
                return; // already did this.  don't repeat
              }

              for (const key in framesHandled) {
                if (!framesHandled[key]) {
                  // nope, not ready yet.  wait till all the frames have given
                  //   answers
                  return;
                }
              }
              // todo: this is just debugging
              HelenaConsole.log("framesHandled", framesHandled);

              let dataObjs = Object.keys(framesHandled).map(
                (key) => framesHandled[key]
              );
              HelenaConsole.log("dataObjs", dataObjs);
              // todo: should probably do a fancy similarity thing here, but for
              //   now we'll be casual
              // we'll sort by number of cells, then return the first one that
              //   shares a url with our spec nodes, or the first one if none
              //   share that url
              dataObjs = dataObjs.filter(
                (obj) => obj !== null && obj !== undefined
              );
              let sortedDataObjs = _.sortBy(dataObjs, (data) => {
                if (!data || !data.first_page_relation ||
                    !data.first_page_relation[0]) {
                  return -1;
                } else {
                  return data.first_page_relation.length *
                    data.first_page_relation[0].length;
                }
              }); // ascending
              sortedDataObjs = sortedDataObjs.reverse();
              HelenaConsole.log("sortedDataObjs", sortedDataObjs);
              const frameUrls = self.pagesToFrameUrls[targetPageVar.name];
              HelenaConsole.log("frameUrls", frameUrls,
                self.pagesToFrameUrls, targetPageVar.name);
              
              // a silly one-liner for getting the most freq
              const mostFrequentFrameUrl = _.first(_.chain(frameUrls).countBy()
                .pairs().max(_.last).value());
            
              for (const data of sortedDataObjs) {
                if (data.url === mostFrequentFrameUrl) {
                  // ok, this is the one
                  // now that we've picked a particular relation, from a
                  //   particular frame, actually process it
                  processedTheLikeliestRelation = true;
                  handleSelectedRelation(data);
                  return;
                }
              }
              // drat, none of them had the exact same url. ok, let's just pick
              //   the first
              if (sortedDataObjs.length < 1) {
                HelenaConsole.log("Aaaaaaaaaaah there aren't any frames " +
                  "that offer good relations!  Why???");
                return;
              }
              processedTheLikeliestRelation = true;
              handleSelectedRelation(sortedDataObjs[0]);
            };

            const sendMessageForFrames = (frames: number[]) => {
              framesHandled = {};
              for (const frame of frames) {
                // keep track of which frames need to respond before we'll be
                //   read to advance
                HelenaConsole.log("frameId", frame);
                delete framesHandled[frame];
              }
              for (const frame of frames) {
                // for each frame in the target tab, we want to see if the frame
                //   suggests a good relation.  once they've all made their
                //   suggestions
                // we'll pick the one we like best
                // todo: is there a better way? after all, we do know the frame
                //   in which the user interacted with the first page at
                //   original record-time
                
                // here's the function for sending the message once
                var getLikelyRelationFunc = () => {
                  Messages.sendFrameSpecificMessage("mainpanel",
                    "content", "likelyRelation", {
                      xpaths: self.pagesToNodes[targetPageVar.name],
                      pageVarName: targetPageVar.name,
                      serverSuggestedRelations: suggestedRelations
                    }, lastCompletedEventTabId, frame,
                    (resp: RelationResponse) => {
                      // question: is it ok to insist that every single frame
                      //   returns a non-null one?  maybe have a timeout?
                      //   maybe accept once we have at least one good response
                      //   from one of the frames?
                      if (resp) {
                        resp.frame = frame;
                        framesHandled[frame] = resp;
                        
                        // when get response, call pickLikelyRelation (defined
                        //   above) to pick from the frames' answers
                        pickLikelyRelation();
                      }
                    }
                  );
                };

                // here's the function for sending the message until we get the
                //   answer
                const getLikelyRelationFuncUntilAnswer = () => {
                  // cool, already got the answer, stop asking
                  if (framesHandled[frame]) { return; }
                  getLikelyRelationFunc(); // send that message

                  // come back and send again if necessary
                  setTimeout(getLikelyRelationFuncUntilAnswer, 5000);
                };

                // actually call it
                getLikelyRelationFuncUntilAnswer();
              }
            }

            let allFrames = self.pagesToFrames[targetPageVar.name];
            allFrames = [...new Set(allFrames)];
            if (allFrames.length === 1 && allFrames[0] === -1) {
              // cool, it's just the top-level frame
              // just do the top-level iframe, and that will be faster
              
              // assumption: 0 is the id for the top-level frame
              sendMessageForFrames([0]);
            } else {
              // ok, we'll have to ask the tab what frames are in it
              // let's get some info from the pages, and when we get that info
              //   back we can come back and deal with more script segments
              const checkFramesFunc = () => {
                if (!lastCompletedEventTabId) {
                  return;
                }
                chrome.webNavigation.getAllFrames({
                  tabId: lastCompletedEventTabId
                }, (details) => {
                  console.log("about to send to frames, tabId",
                    lastCompletedEventTabId);
                  if (details) {
                    const frames = details.map((d) => d.frameId);
                    sendMessageForFrames(frames);
                  }
                });
              };
              // for pages that take a long time to actually load the right page
              //   (redirects), can increase this; todo: fix it a real way by
              //   trying over and over until we get a reasonable answer
              setTimeout(checkFramesFunc, 0);
            }
          });
          // all later indexes will be handled by the recursion instead of the
          //   rest of the loop
          return;
        }
      }
      // ok we hit the end of the loop without returning after finding a new
      //   page to work on.  time to close tabs
      tabsToCloseAfter = [...new Set(tabsToCloseAfter)]; 
      console.log("tabsToCloseAfter", tabsToCloseAfter);     
      // commenting out the actual tab closing for debugging purposes
      /*
      for (var i = 0; i < tabsToCloseAfter.length; i++) {
        console.log("processServerRelations removing tab", tabsToCloseAfter[i]);
        chrome.tabs.remove(tabsToCloseAfter[i], function() {
          // do we need to do anything?
        }); 
      }
      */
      /*
      chrome.windows.remove(windowId);
      */
      // let's also update the ui to indicate that we're no longer looking
      window.helenaMainpanel.UIObject.updateDisplayedRelations(false);
    }

    // if this is our first time calling this function, we'll need to make a new
    //   window for our exploration of pages so we don't just choose a random
    //   one but if we've already started, no need, can juse use the windowId we
    //   already know
    if (!windowId) {
      if (self.windowWidth) {
        var width = self.windowWidth;
        var height = self.windowHeight;
        MiscUtilities.makeNewRecordReplayWindow(
          runRelationFindingInNewWindow, undefined, width, height);
      } else {
        MiscUtilities.makeNewRecordReplayWindow(
          runRelationFindingInNewWindow);
      }
    } else {
      runRelationFindingInNewWindow(windowId);
    }
  }

  public forbidAutomaticLoopInsertion() {
    this.automaticLoopInsertionForbidden = true;
  }

  public processLikelyRelation(data: RelationResponse) {
    HelenaConsole.log(data);

    if (this.pagesProcessed[data.page_var_name]) {
      // we already have an answer for this page.  must have gotten sent
      //   multiple times even though that shouldn't happen
      HelenaConsole.log("Alarming.  We received another likely relation " +
        "for a given pageVar, even though content script should prevent this.");
      return this.relations;
    }

    this.pagesProcessed[data.page_var_name] = true;

    if (data.num_rows_in_demonstration < 2 &&
        data.next_type === NextButtonTypes.NONE) {
      // what's the point of showing a relation with only one row?
    } else {
      // if we have a normal selector, let's add that to our set of relations
      if (data.selector) {
        const rel = new Relation(data.relation_id, data.name, data.selector,
          data.selector_version, data.exclude_first, data.columns,
          data.first_page_relation, data.num_rows_in_demonstration,
          data.page_var_name, data.url, data.next_type,
          data.next_button_selector, data.frame);
        if (!this.relations.includes(rel)) {
          this.relations.push(rel);
        }
      }
      
      // if we also have pulldown menu selectors, let's add those too
      if (data.pulldown_relations) {
        for (const pulldownRel of data.pulldown_relations) {
          var rel = new Relation(pulldownRel.relation_id, pulldownRel.name,
            pulldownRel.selector, pulldownRel.selector_version,
            pulldownRel.exclude_first, pulldownRel.columns,
            pulldownRel.first_page_relation,
            pulldownRel.num_rows_in_demonstration,
            pulldownRel.page_var_name, pulldownRel.url, pulldownRel.next_type,
            pulldownRel.next_button_selector, pulldownRel.frame);
          if (!this.relations.includes(rel)) {
            this.relations.push(rel);
          }
        }
      }
    }

    HelenaConsole.log(this.pagesToNodes);

    if (!this.automaticLoopInsertionForbidden) {
      this.insertLoops(true);
    }

    // give the text relations back to the UI-handling component so we can display to user
    return this.relations;
  }

  public insertLoops(updateProgPreview: boolean) {
    // indexes into the statements mapped to the relations used by those
    //   statements
    const indexesToRelations: {
      [key: number]: GenericRelation
    } = {};
    for (const relation of this.relations) {
      for (let j = 0; j < this.statements.length; j++) {
        const statement = this.statements[j];
        if (statement.usesRelation(relation)) {
          let loopStartIndex = j;
          // let's do something a little different in cases where there's a
          //   keydown right before the loop, since the keyups will definitely
          //   happen within
          // todo: may even need to look farther back for keydowns whose keyups
          //   happen within the loop body
          const prevStmt = this.statements[j-1];
          if (prevStmt instanceof TypeStatement && prevStmt.onlyKeydowns) {
            loopStartIndex = j - 1;
          }
          indexesToRelations[loopStartIndex] = relation;
          break;
        }
      }
    }

    this.updateChildStatements(this.statements);

    // start at end, work towards beginning
    const indexes = Object.keys(indexesToRelations).map(Number)
                          .sort((a, b) => b - a);
    for (const index of indexes) {
      // let's grab all the statements from the loop's start index to the end,
      //   put those in the loop body
      const bodyStatementLs = this.bodyStatements.slice(index,
        this.bodyStatements.length);
      // pageVar comes from first item because that's the one using the
      //   relation, since it's the one that made us decide to insert a new loop
      //   starting with that 
      const pageVar = (<PageActionStatement> bodyStatementLs[0]).pageVar;

      if (!pageVar) {
        throw new ReferenceError("Page variable not set.");
      }

      // let's use bodyStatementLs as our body,
      //   indexesToRelations[index] as our relation 
      const loopStatement = loopStatementFromBodyAndRelation(bodyStatementLs,
        indexesToRelations[index], pageVar);
      
      const newChildStatements = this.bodyStatements.slice(0, index);
      newChildStatements.push(loopStatement);
      this.updateChildStatements(newChildStatements);
    }

    if (updateProgPreview) {
      window.helenaMainpanel.UIObject.updateDisplayedScript();
      // now that we know which columns are being scraped, we may also need to
      //   update how the relations are displayed
      window.helenaMainpanel.UIObject.updateDisplayedRelations();
    }
  }

  public tryAddingRelation(relation: GenericRelation) {
    tryAddingRelationHelper(relation, this.bodyStatements, this);
    // for now we'll add it whether or not it actually get used, but this may
    //   not be the best way...
    this.relations.push(relation);
  }

  public removeRelation(relationObj: GenericRelation) {
    this.relations = this.relations.filter((rel) => rel !== relationObj);

    // now let's actually remove any loops that were trying to use this relation
    var newChildStatements = removeLoopsForRelation(this.bodyStatements,
      relationObj);
    this.updateChildStatements(newChildStatements);
    
    // if the removed relation was using the same cell as another potential
    //   relation, that one may now be relevant
    this.insertLoops(false);

    window.helenaMainpanel.UIObject.updateDisplayedScript();
    window.helenaMainpanel.UIObject.updateDisplayedRelations();
  };

  // by default, we'll wait up to 15 seconds for the target node to appear
  //   (see ringer/common/common_params.js)
  // for static pages, this is silly
  // user may want to provide a custom timeout
  // this particular function resets the wait for all events in the program,
  //   which is easy but not always a good idea
  public setCustomTargetTimeout(timeoutSeconds: number) {
    this.traverse((stmt: HelenaLangObject) => {
      if (stmt.isRingerBased()) {
        const ringerStmt = <RingerStatement> stmt;
        for (var i = 0; i < ringerStmt.cleanTrace.length; i++) {
          ringerStmt.cleanTrace[i].targetTimeout = timeoutSeconds;
        }
      }
    }, () => {});
  };
}

// statement traverse because we're not going through expressions, not going
//   through all nodes, just hitting things in the bodyStatements lists
function firstTrueStatementTraverse(statementLs: HelenaLangObject[],
    fn: Function): HelenaLangObject | null {
  for (const stmt of statementLs) {
    if (fn(stmt)) {
      return stmt;
    } else {
      // ok, this statement didn't do the trick, but maybe the children?
      if (stmt instanceof StatementContainer) {
        const ans = firstTrueStatementTraverse(stmt.bodyStatements, fn);
        if (ans) {
          return ans;
        }
      }
    }
  }
  return null;
}


function insertAfterHelper(statements: HelenaLangObject[],
    stmtToInsert: HelenaLangObject, stmtToInsertAfter: HelenaLangObject) {
  for (let i = 0; i < statements.length; i++) {
    const curStmt = statements[i];
    if (curStmt === stmtToInsertAfter) {
      // remember, overwrites the original array bc splice
      statements.splice(i + 1, 0, stmtToInsert);
      return statements;
    } else {
      // ok, haven't found it yet.  mayhaps it belongs in the body statements of
      //   this very statement?
      if (curStmt instanceof StatementContainer) {
        // ok, this one has bodyStatements to check
        const possibleNewLs = insertAfterHelper(curStmt.bodyStatements,
          stmtToInsert, stmtToInsertAfter);
        if (possibleNewLs) {
          // awesome, we're done
          curStmt.bodyStatements = possibleNewLs;
          return statements;
        }
      }
    }
  }
  return null;
}

function removeStatementAndFollowing(stmts: HelenaLangObject[],
    stmt: HelenaLangObject): HelenaLangObject[] | null {
  for (let i = 0; i < stmts.length; i++) {
    const curStmt = stmts[i];
    if (curStmt === stmt) {
      // remember, overwrites the original array bc splice
      const removedSeq = stmts.splice(i);
      return removedSeq;
    } else {
      // ok, haven't found it yet.  mayhaps it belongs in the body statements of
      //   this very statement?
      if (curStmt instanceof StatementContainer) {
        // ok, this one has bodyStatements to check
        const removedSeq = removeStatementAndFollowing(curStmt.bodyStatements,
          stmt);
        if (removedSeq) {
          // awesome, we're done
          return removedSeq;
        }
      }
    }
  }
  return null;
}

function alignCompletedEvents(recordTrace: Trace,
    replayTrace: Trace) {
  // we should see corresponding 'completed' events in the traces
  // todo: should we remove http?
  // now only doing this for top-level completed events.  will see if this is
  //   sufficient
  const recCompleted = recordTrace.filter((ev) =>
    RingerEvents.isComplete(ev) &&
    !ev.data.url.includes(HelenaConfig.helenaServerUrl)
  );

  // have to check for kaofang presence, because otherwise user can screw it up
  //   by downloading data in the middle or something like that
  const repCompleted = replayTrace.filter((ev) =>
    RingerEvents.isComplete(ev) &&
    !ev.data.url.includes(HelenaConfig.helenaServerUrl)
  );

  HelenaConsole.log(recCompleted, repCompleted);
  // should have same number of top-level load events.  if not, might be trouble
  if (recCompleted.length !== repCompleted.length) {
    HelenaConsole.log("Different numbers of completed events in record " +
      "and replay: ", recCompleted, repCompleted);
  }
  // todo: for now aligning solely based on point at which the events appear in
  //   the trace.  if we get traces with many events, may need to do something
  //   more intelligent
  let smallerLength = recCompleted.length;
  if (repCompleted.length < smallerLength) {
    smallerLength = repCompleted.length;
  }
  return [
    recCompleted.slice(0, smallerLength),
    repCompleted.slice(0, smallerLength)
  ];
}

function updatePageVars(recordTrace: Trace,
    replayTrace: Trace, continuation: Function) {
  // HelenaConsole.log("updatePageVars", recordTimeTrace, replayTimeTrace);
  const alignedTraces = alignCompletedEvents(recordTrace, replayTrace);
  const alignedRecord = alignedTraces[0];
  const alignedReplay = alignedTraces[1];
  // HelenaConsole.log("recEvents:", recEvents, "repEvents", repEvents);
  updatePageVarsHelper(alignedRecord, alignedReplay, 0, continuation);
}

function updatePageVarsHelper(recordTrace: Trace,
    replayTrace: Trace, index: number, continuation: Function) {
  if (index >= recordTrace.length) {
    continuation();
  } else {
    const pageVar = Traces.getLoadOutputPageVar(
      <DisplayTraceEvent> recordTrace[index]);
    if (pageVar === undefined) {
      updatePageVarsHelper(recordTrace, replayTrace, index + 1, continuation);
      return;
    }
    // HelenaConsole.log("Setting pagevar current tab id to:", repEvents[i].data.tabId);
    pageVar.setCurrentTabId(replayTrace[index].data.tabId, () =>
      updatePageVarsHelper(recordTrace, replayTrace, index + 1, continuation)
    );
  }
}

function tabMappingFromTraces(recordTrace: Trace,
    replayTrace: Trace) {
  const alignedTraces = alignCompletedEvents(recordTrace, replayTrace);
  const alignedRecord = alignedTraces[0];
  const alignedReplay = alignedTraces[1];
  const tabIdMapping: {
    [key: number]: number
  } = {};
  for (let i = 0; i < alignedRecord.length; i++) {
    const recTabId = alignedRecord[i].data.tabId;
    const repTabId = alignedReplay[i].data.tabId;
    tabIdMapping[recTabId] = repTabId;
  }
  return tabIdMapping;
}


function ringerBasedAndNotIgnorable(stmt: HelenaLangObject) {
  return (
    // ringer based and not a scrape statement, so we have to replay for sure
    (stmt.isRingerBased() && !(stmt instanceof ScrapeStatement)) ||
    
    // a scrape statement and it's not scraping a relation, so we have to run it
    //   to find the node
    (stmt instanceof ScrapeStatement && !stmt.scrapingRelationItem()));
}

function determineNextBlockStartIndex(bodyStmts: HelenaLangObject[]) {
  let nextBlockStartIndex = bodyStmts.length;
  for (let i = 0; i < bodyStmts.length; i++) {
    // todo: is this the right condition?
    if (!bodyStmts[i].isRingerBased()) {
      nextBlockStartIndex = i;
      break;
    }
  }

  if (nextBlockStartIndex === 0) {
    throw new ReferenceError("nextBlockStartIndex should not be 0.");
  }
  return nextBlockStartIndex;
}

function selectBasicBlockStatements(bodyStmts: HelenaLangObject[],
    nextBlockStartIndex: number) {
  const basicBlockStatements = [];
  for (let i = 0; i < nextBlockStartIndex; i++) {
    basicBlockStatements.push(bodyStmts[i]);
  }

  return <RingerStatement[]> basicBlockStatements;
}

function makeTraceFromStatements(stmts: RingerStatement[]) {
  let trace: Trace = [];
  
  // label each trace item with the basicBlock statement being used
  let withinScrapeSection = false;
  for (let i = 0; i < stmts.length; i++) {
    const curStmt = stmts[i];
    var cleanTrace = curStmt.cleanTrace;

    // first let's figure out whether we're even doing anything with this
    //   statement
    if (curStmt.contributesTrace === TraceContributions.NONE) {
      continue; // don't need this one.  just skip
    } else if (curStmt.contributesTrace === TraceContributions.FOCUS) {
      // let's just change the cleanTrace so that it only grabs the focus events
      console.warn("We're including a focus event, which might cause " +
        "problems. If you see weird behavior, check this first.");
      cleanTrace = cleanTrace.filter((ev) => ev.data.type === "focus");
    } else if (curStmt instanceof ScrapeStatement) {
      // remember, scrape statements shouldn't change stuff!  so it should be
      //   safe to throw away events
      // we just need to be sure to have one event that actually finds the node
      //   and grabs its contets
      const nodeUsingEvent = Traces.firstScrapedContentEventInTrace(cleanTrace);
      if (nodeUsingEvent) {
        cleanTrace = [ nodeUsingEvent ];
      }
    }

    for (const ev of cleanTrace) {
      Traces.setTemporaryStatementIdentifier(ev, i);
    }

    // ok, now let's deal with speeding up the trace based on knowing that
    //   scraping shouldn't change stuff, so we don't need to wait after it
    if (withinScrapeSection) {
      // don't need to wait after scraping.  scraping doesn't change stuff.
      if (cleanTrace.length > 0) {
        cleanTrace[0].timing.ignoreWait = true;
      }
    }
    if (curStmt instanceof ScrapeStatement) {
      withinScrapeSection = true;
      // the first event may need to wait after whatever came before
      for (let j = 1; j < cleanTrace.length; j++) {
        cleanTrace[j].timing.ignoreWait = true;
      }
    } else {
      withinScrapeSection = false;
    }

    // let's see if we can adapt mac-recorded traces to linux if necessary...
    // todo: clean this up, make it work for different transitions...
    const osString = window.navigator.platform;
    if (osString.includes("Linux")) {
      if (curStmt.hasOutputPageVars()) {
        for (const ev of cleanTrace) {
          // hey, digging into the ev data here is gross.  todo: fix that
          if (ev.data.metaKey) {
            ev.data.ctrlKeyOnLinux = true;
          }
          Traces.setTemporaryStatementIdentifier(ev, i);
        }
      }
    } else if (osString.indexOf("Mac") > -1) {
      // and same deal with mac -> linux?  not sure this is safe in general.
      //   but it is convenient for the moment...
      if (curStmt.hasOutputPageVars()) {
        for (const ev of cleanTrace) {
          // hey, digging into the ev data here is gross.  todo: fix that
          if (ev.data.ctrlKey) {
            ev.data.metaKeyOnMac = true;
          }
          Traces.setTemporaryStatementIdentifier(ev, i);
        }
      }
    }

    trace = trace.concat(cleanTrace);
  }
  return trace;
}

function shortPrintString(obj: object) {
  if (!obj) {
    return JSON.stringify(obj);
  }
  else{
    return JSON.stringify(obj).substring(0,20);
  }
}

function runInternals(program: HelenaProgram, parameters: Parameters,
    dataset: Dataset, options: RunOptions, continuation?: Function) {
  // first let's make the runObject that we'll use for all the rest
  // for now the below is commented out to save memory, since only running one
  //   per instance

  // must clone so that run-specific state can be saved with relations and so
  //   on
  //var programCopy = Clone.cloneProgram(program);

  const runObject: RunObject = {
    program: program,
    dataset: dataset,
    environment: Environment.envRoot(),
    tab: ""
  };

  // the mainpanel tab in which we'll preview stuff
  runObject.tab = window.helenaMainpanel.UIObject.newRunTab(runObject);
  window.helenaMainpanel.currentRunObjects.push(runObject);

  // let's figure out params first.  parameters may be passed in (e.g., from
  //   command line or from tool running on top of Helena language)
  //   but we also have some default vals associated with the program object
  //   itself.
  // we want to start with the default vals associated with the program, but
  //   then we're willing to overwrite them with the user-supplied vals
  // so first assign default values, then assign from passed-in parameters arg
  for (const key in program.defaultParamVals) {
    if (!(key in parameters)) {
      runObject.environment.envBind(key, program.defaultParamVals[key]);
    }
  }

  // let's add the intput parameters to our environment.  todo: in future,
  //   should probably make sure we only use params that are associated with
  //   prog (store param names with prog...)
  for (const key in parameters) {
    runObject.environment.envBind(key, parameters[key]);
  }

  runObject.program.clearRunningState();
  runObject.program.prepareToRun();

  const usesTheWeb = runObject.program.loadsUrl();
  HelenaConsole.log("usesTheWeb", usesTheWeb);

  const runProgFunc = (windowId?: number) => {
    // now let's actually run
    if (windowId) {
      window.helenaMainpanel.recordingWindowIds.push(windowId);
      runObject.window = windowId;
      window.helenaMainpanel.currentReplayWindowId = windowId;
    }
    datasetsScraped.push(runObject.dataset.getId());
    runObject.program.runBasicBlock(runObject,
      runObject.program.bodyStatements, () => {

      // ok, we're done.  unless!  are we in parallel mode?  if we're in
      //   parallel mode, let's go back and help any workers that are
      //   stragglers

      // before we start running, let's check if we need to update the
      //   continuation in order to make it loop on this script forever
      // (if it's one of those programs where we're supposed to go back and
      //   run again as soon as we finish)
      // or if we need to loop again to descend into locked skip blocks
      if (options.parallel) {
        // ok, we're ready to do our descent into parallelizing at lower skip
        //   blocks
        // todo: this should really grab all the skip blocks at a given level
        // this code will work as long as all skip blocks are nested one
        //   inside one, as when our pbd system writes them
        const normalModeSkipBlock = (stmt: HelenaLangObject) => {
          return stmt instanceof SkipBlock &&
                 stmt.descendIntoLocks === false;
        }

        const nextSkipBlockToSwitch = <SkipBlock> firstTrueStatementTraverse(
          program.bodyStatements, normalModeSkipBlock);
        if (nextSkipBlockToSwitch) {
          nextSkipBlockToSwitch.descendIntoLocks = true;
        }
        const nextSkipBlockToSwitchHasParallelizableSubcomponents =
          firstTrueStatementTraverse(program.bodyStatements,
            normalModeSkipBlock);

        if (nextSkipBlockToSwitch &&
          nextSkipBlockToSwitchHasParallelizableSubcomponents) {
          // we only want to do another run if there are actually
          //   parallelizable subcomponents of the thing we just switched
          // otherwise it's useless to send more workers after the skip blocks
          //   that have already been locked by other workers
          // but here we have both, so let's actually run again
          // todo: do we need to do anything to clean up here?
          //   is program state ok?
          runInternals(program, parameters, dataset, options, continuation);
          // now return so we don't do the normal whatToDoWhenWereDone stuff
          //   that we'll do when we've really finished
          return;
        } else {
          // ok, we wanted to find a next skip block, but we ran out. let's set
          //   them all back to false
          program.turnOffDescentIntoLockedSkipBlocks();
          // next we'll fall through out of this if statement and do the normal
          //   processing for being done, actually close the dataset and all
        }
      }

      const whatToDoWhenWereDone = () => {
        scrapingRunsCompleted += 1;
        console.log("scrapingRunsCompleted", scrapingRunsCompleted);
        window.helenaMainpanel.currentRunObjects = window.helenaMainpanel.currentRunObjects.filter(
          (runObj) => runObj !== runObject
        );
        HelenaConsole.log("Done with script execution.");
        const timeScraped = (new Date()).getTime() -
          parseInt(dataset.pass_start_time.toString());
        console.log(runObject.dataset.getId(), timeScraped);

        if (windowId) {
          // take that window back out of the allowable recording set
          window.helenaMainpanel.recordingWindowIds = window.helenaMainpanel.recordingWindowIds.filter(
            (window) => window !== windowId);
        }
        // go ahead and actually close the window so we don't have chrome memory
        //   leaking all over the place.
        // todo: put this back in!
        //chrome.windows.remove(windowId);

        // if there was a continuation provided for when we're done, do it
        if (continuation) {
          continuation(runObject.dataset, timeScraped, runObject.tab);
        }
      }

      runObject.dataset.closeDatasetWithCont(whatToDoWhenWereDone);

    }, options);
  };

  // now actually call the function for running the program
  // ok let's do this in a fresh window
  if (usesTheWeb) {
    if (runObject.program.windowWidth) {
      const width = runObject.program.windowWidth;
      const height = runObject.program.windowHeight;
      MiscUtilities.makeNewRecordReplayWindow(runProgFunc, undefined,
        width, height);
    } else {
      MiscUtilities.makeNewRecordReplayWindow(runProgFunc);
    }
  } else {
    // no need to make a new window (there are no load statements in the
    //   program), so don't
    runProgFunc();
  }
}

function adjustDatasetNameForOptions(dataset: Dataset, options: RunOptions) {
  if (options.ignoreEntityScope) {
    dataset.appendToName("_ignoreEntityScope");
  }
  if (options.nameAddition) {
    // just for scripts that want more control of how it's saved
    dataset.appendToName(options.nameAddition);
  }
}

function paramName(stmtIndex: number, paramType: string) {
  // assumes we can't have more than one of a single paramtype from a single
  //   statement.  should be true
  return `s${stmtIndex}_${paramType}`;
}


/**
 * Parameterize by value. TODO: what does that mean?
 * @param trace 
 * @param stmts 
 */
function pbv(trace: Trace, stmts: RingerStatement[]) {
  const pTrace = new ParameterizedTrace(trace);

  for (let i = 0; i < stmts.length; i++) {
    const stmt = stmts[i];
    const pbvs = stmt.pbvs();
    HelenaConsole.log("pbvs", pbvs);
    for (const curPbv of pbvs) {
      var pname = paramName(i, curPbv.type);
      if (curPbv.type === "url") {
        pTrace.parameterizeUrl(pname, curPbv.value);
      } else if (curPbv.type === "node") {
        pTrace.parameterizeXpath(pname, curPbv.value);
      } else if (curPbv.type === "typedString") {
        pTrace.parameterizeTypedString(pname, curPbv.value);
      } else if (curPbv.type === "tab") {
        pTrace.parameterizeTab(pname, curPbv.value);
      } else if (curPbv.type === "frame") {
        // pTrace.parameterizeFrame(pname, curPbv.value);
      } else if (curPbv.type === "property") {
        pTrace.parameterizeProperty(pname, curPbv.value);
      } else {
        HelenaConsole.log("Tried to do pbv on a type we don't know.");
      }
    }
  }
  return pTrace;
}



function parameterizeWrapperNodes(pTrace: ParameterizedTrace, origXpath: string,
    newXpath: string) {
  // todo: should we do something to exempt xpaths that are already being
  //   parameterized based on other relation elements?
  // for now this is irrelevant because we'll come to the same conclusion
  //   because of using fixed suffixes, but could imagine different approach
  const origSegs = origXpath.split("/");
  const newSegs = newXpath.split("/");
  if (origSegs.length !== newSegs.length) {
    HelenaConsole.log("origSegs and newSegs different length!", origXpath,
      newXpath);
  }
  
  // assumption: origSegs and newSegs have same length; we'll see
  for (let i = 0; i < origSegs.length; i++) {
    if (origSegs[origSegs.length - 1 - i] === newSegs[newSegs.length - 1 - i]) {
      // still match
      // we do need the last segment ot match, but the one that goes all the way
      //   to the last segment is the one that inspired this
      // so we don't need to param the last one again, but we do need to param
      //   the one prior, even if it doesn't match
      // (the first one that doesn't match should still be parameterized)
      // a1/b1/c1/a1/a1/a1 -> d1/e1/f1/a2/a1/a1 original already done;
      // should do a1/b1/c1/a1/a1 -> d1/e1/f1/a2/a1, a1/b1/c1/a1 -> d1/e1/f1/a2
      const origXpathPrefix = origSegs.slice(0,origSegs.length - 1 - i).join("/");
      const newXpathPrefix = newSegs.slice(0,newSegs.length - 1 - i).join("/");
      const pname = `wrappernode_${HelenaProgram.wrapperNodeCounter}`;
      HelenaProgram.wrapperNodeCounter += 1;
      pTrace.parameterizeXpath(pname, origXpathPrefix);
      pTrace.useXpath(pname, newXpathPrefix);
      HelenaConsole.log("Wrapper node correction:");
      HelenaConsole.log(origXpathPrefix);
      HelenaConsole.log(newXpathPrefix);
    } else {
      // this one is now diff, so shouldn't do replacement for the one further
      // (shouldn't do a1/b1/c1 -> d1/e1/f1 from example above)
      // I mean, maybe we actually should do this, but not currently a reason to
      //   think it will be useful.  worth considering though
      break;
    }
  }
}

/**
 * TODO
 * @param pTrace 
 * @param stmts 
 * @param environment 
 */
function passArguments(pTrace: ParameterizedTrace, stmts: RingerStatement[],
    environment: Environment.Frame) {
  for (let i = 0; i < stmts.length; i++) {
    const stmt = stmts[i];
    const args = stmt.args(environment);
    for (const curArg of args) {
      const pname = paramName(i, curArg.type);
      if (curArg.type === "url") {
        pTrace.useUrl(pname, curArg.value);
      } else if (curArg.type === "node") {
        pTrace.useXpath(pname, curArg.value);
        // below is kind of gross and I don't know if this is really where it
        //   should happen, but we definitely want to parameterize wrapper nodes
        // todo: maybe find a cleaner, nice place to put this or write this.
        //   for now this should do the trick
        const node = <string> (<PageActionStatement> stmt).node;
        parameterizeWrapperNodes(pTrace, node, curArg.value);
      } else if (curArg.type === "typedString") {
        pTrace.useTypedString(pname, curArg.value);
      } else if (curArg.type === "tab") {
        pTrace.useTab(pname, curArg.value);
      } else if (curArg.type === "frame") {
        // pTrace.useFrame(pname, curArg.value);
      } else if (curArg.type === "property") {
        pTrace.useProperty(pname, curArg.value);
      } else {
        HelenaConsole.log("Tried to do pbv on type we don't know. " +
          "(Arg provision.)");
      }
    }
  }

  return pTrace.getStandardTrace();
}

/*
function longestCommonPrefix(strings) {
  if (strings.length < 1) {
    return "";
  }
  if (strings.length == 1) {
    return strings[0];
  }

  var sorted = strings.slice(0).sort(); // copy
  var string1 = sorted[0];
  var string2 = sorted[sorted.length - 1];
  var i = 0;
  var l = Math.min(string1.length, string2.length);

  while (i < l && string1[i] === string2[i]) {
    i++;
  }

  return string1.slice(0, i);
}*/


function isScrapingSet(keyCodes: number[]) {
  const charsDict = {SHIFT: 16, CTRL: 17, ALT: 18, CMD: 91};
  keyCodes.sort();
  const acceptableSets = [
    [charsDict.ALT], // mac scraping
    [charsDict.CTRL, charsDict.ALT], // unix scraping
    [charsDict.ALT, charsDict.SHIFT], // mac link scraping
    [charsDict.CTRL, charsDict.ALT, charsDict.SHIFT] // unix link scraping
  ];
  for (const acceptableSet of acceptableSets) {
    acceptableSet.sort();
    if (_.isEqual(keyCodes, acceptableSet)) {
      return true;
    }
  }
  // nope, none of them are the right set
  return false;
}

function sameNodeIsNextUsed(stmt: PageActionStatement,
    stmts: PageActionStatement[]) {
  HelenaConsole.log("sameNodeIsNextUsed", stmt, stmts);

  if (!stmt.origNode) { // there's no node associated with the first arg
    console.log("Warning!  No node associated with the statement, which may " +
      "mean there was an earlier statement that we should have called on.");
    return false;
  }
  
  for (const curStmt of stmts) {
    if (curStmt.origNode === stmt.origNode) {
      return true;
    }
    if (curStmt instanceof ClickStatement) { // || statements[i] instanceof ScrapeStatement) {
      // ok, we found another statement that focuses a node, but it's a
      //   different node
      // todo: is this the right condition?  certainly TypeStatements don't
      //   always have the same origNode as the focus event that came
      //   immediately before
      return false;
    }
  }
  // we've run out
  return false;
}

function doWeHaveRealRelationNodesWhereNecessary(stmts: HelenaLangObject[],
    environment: Environment.Frame) {
  for (const stmt of stmts) {
    if (stmt.hasOutputPageVars()) {
      // ok, this is an interaction where we should be opening a new page based on the statement
      if ((stmt instanceof ClickStatement ||
          stmt instanceof ScrapeStatement ||
          stmt instanceof TypeStatement) && stmt.columnObj) {
        // if the statement is parameterized with the column object of a given
        //   relation, this will be non-null
        // also, it means the statement's currentNode will be a NodeVariable,
        //   so we can call currentXPath
        // also it means we'll already have assigned to the node variable, so
        //   currentXPath should actually have a value
        var currentXpath = stmt.currentNode.currentXPath(environment);
        if (currentXpath) {
          continue;
        }

        // we've found a statement for which we'll want to use a node to produce
        //   a new page, but we won't have one
        return false;
      }
    }
  }
  return true;
}

function markNonTraceContributingStatements(stmts: HelenaLangObject[]):
    RingerStatement[] {
  // if we ever get a sequence within the statements that's a keydown statement,
  //   then only scraping statements, then a keyup, assume we can toss the keyup
  //   and keydown ones

  HelenaConsole.log("markNonTraceContributingStatements", stmts);

  // ok first some special handling for cases where the only statements in the
  //   block aren't ringer-y at all
  // it's possible that this will sometimes screw things up.  if you ever get
  //   annoying weird behavior, 
  // where the page stops reacting correctly, this might be a place to look
  // but it's just so annoying when the scripts are slow on things that don't
  //   need to be slow.  so we're gonna do it anyway

  let allNonRinger = true;
  for (const stmt of stmts) {
    // console.log("ringerBasedButNotScraping",
    //   ringerBasedButNotScraping(statements[i]), statements[i]);
    if (ringerBasedAndNotIgnorable(stmt) && !stmt.nullBlockly) {
      allNonRinger = false;
      break;
    }
  }

  if (allNonRinger) {
    //console.log("Cool, found a situation where we can ignore all statements",
    //  statements);
    for (const stmt of stmts) {
      const ringerStmt = <RingerStatement> stmt;
      ringerStmt.contributesTrace = TraceContributions.NONE;
    }
    return <RingerStatement[]> stmts;
  }

  let keyIndexes: number[] = [];
  let keysdown: number[] = [];
  let keysup: number[] = [];
  const sets: number[][] = [];
  for (let i = 0; i < stmts.length; i++) {
    const stmt = stmts[i];
    if (stmt instanceof TypeStatement && stmt.onlyKeydowns) {
      // we're seeing typing, but only keydowns, so it might be the start of entering scraping mode
      keyIndexes.push(i);
      keysdown = keysdown.concat(stmt.keyCodes);
    } else if (keyIndexes.length > 0 && stmt instanceof ScrapeStatement &&
        stmt.scrapingRelationItem()) {
      // cool, we think we're in scraping mode, and we're scraping a relation-scraped thing, so no need to
      // actually execute these events with Ringer
      stmt.contributesTrace = TraceContributions.FOCUS;
      continue;
    } else if (keyIndexes.length > 0 && stmt instanceof TypeStatement &&
        stmt.onlyKeyups) {
      // ok, looks like we might be about to pop out of scraping mode
      keyIndexes.push(i);
      keysup = keysup.concat(stmt.keyCodes);

      // ok, do the keysdown and keysup arrays have the same elements (possibly
      //   including repeats), just reordered?
      // todo: is this a strong enough condition?
      keysdown.sort();
      keysup.sort();

      // below: are we letting up all the same keys we put down before? and are
      //   the keys from a set we might use for entering scraping mode?
      if (_.isEqual(keysdown, keysup) && isScrapingSet(keysdown)) {
        HelenaConsole.log("decided to remove set", keyIndexes, keysdown);
        sets.push(keyIndexes);
        keyIndexes = [];
        keysdown = [];
        keysup = [];
      }
    } else if (keyIndexes.length > 0 && !(stmt instanceof ScrapeStatement &&
        stmt.scrapingRelationItem())) {
      // well drat.  we started doing something that's not scraping a relation
      //   item
      // maybe clicked, or did another interaction, maybe just scraping
      //   something where we'll rely on ringer's node finding abilities
      //   but in either case, we need to actually run Ringer
      keyIndexes = [];
      keysdown = [];
      keysup = [];
    }
  }
  // ok, for now we're only going to get rid of the keydown and keyup statements
  // they're in sets because may ultimately want to try manipulating scraping
  //   statements in the middle if they don't have dom events (as when relation
  //   parameterized)
  // but for now we'll stick with this

  // todo: I'd like to get rid of the above and switch to just checking for a
  //   given event whether all contained events had additional.scrape set
  // the only complication is the focus thing mentioned below

  for (const set of sets) {
    // let's ignore the events associated with all of these statements!
    for (let j = set[0]; j < set[set.length-1] + 1; j++) {
      const stmt = <RingerStatement> stmts[j];
      stmt.contributesTrace = TraceContributions.NONE;
    }
    // ok, one exception.  sometimes the last relation scraping statement
    //   interacts with the same node that we'll use immediately after scraping
    //   stops
    // in these cases, during record, the focus was shifted to the correct node
    //   during scraping, but the replay won't shift focus unless we replay that
    //   focus event so we'd better replay that focus event
    const keyupIndex = set[set.length - 1];
    if (sameNodeIsNextUsed(<PageActionStatement> stmts[keyupIndex - 1],
        <PageActionStatement[]> stmts.slice(keyupIndex + 1, stmts.length))) {
      // is it ok to restrict it to only statements replayed immediately after? 
      //   rather than in a for loop that's coming up or whatever?
      // it's definitely ok while we're only using our own inserted for loops,
      //   since those get inserted where we start using a new node
      const lastStatementBeforeKeyup = <RingerStatement> stmts[keyupIndex - 1];
      HelenaConsole.log("lastStatementBeforeKeyup",
        lastStatementBeforeKeyup);
      lastStatementBeforeKeyup.contributesTrace = TraceContributions.FOCUS;
      // let's make sure to make the state match the state it should have, based
      //   on no longer having these keypresses around
      const cleanTrace = lastStatementBeforeKeyup.cleanTrace;
      for (const ev of cleanTrace) {
        // right now hard coded to get rid of ctrl alt every time.  todo: fix
        if (ev.data.ctrlKey) {
          ev.data.ctrlKey = false;
        }
        if (ev.data.altKey) {
          ev.data.altKey = false;
        }
      }
    }

    /* an alternative that removes keyup, keydown events instead of the whole statements
    for (var j = set.length - 1; j >= 0; j--) {
      //statements.splice(set[j], 1);
      var statement = statements[set[j]];
      console.log("statement", statement);
      var cleanTrace = statement.cleanTrace;
      for (var l =  cleanTrace.length - 1; l >= 0; l--) {
        if (cleanTrace[l].data.type === "keyup" || cleanTrace[l].data.type === "keydown") {
          cleanTrace.splice(l, 1);
        }
      }
    }
    */
    
  }
  
  HelenaConsole.log("markNonTraceContributingStatements", stmts);
  return <RingerStatement[]> stmts;
}


function parameterizeBodyStatementsForRelation(bodyStmts: HelenaLangObject[],
  relation: GenericRelation) {
  let relationColumnsUsed: (IColumnSelector | null)[] = [];
  for (const bodyStmt of bodyStmts) {
    relationColumnsUsed = relationColumnsUsed.concat(
      bodyStmt.parameterizeForRelation(relation)
    );
  }
  relationColumnsUsed = _.uniq(relationColumnsUsed);
  relationColumnsUsed = _.without(relationColumnsUsed, null);
  return relationColumnsUsed;
}

function loopStatementFromBodyAndRelation(bodyStmts: HelenaLangObject[],
    relation: GenericRelation, pageVar: PageVariable) {
  // we want to parameterize the body for the relation
  const relationColumnsUsed = parameterizeBodyStatementsForRelation(bodyStmts,
    relation); 

  // ok, and any pages to which we travel within a loop's non-loop body nodes
  //   must be counteracted with back buttons at the end
  // todo: come back and make sure we only do this for pages that aren't being
  //   opened in new tabs already, and maybe ultimately for pages that we can't
  //   convert to open in new tabs
  const backStatements = [];
  for (const stmt of bodyStmts) {
    if (stmt.hasOutputPageVars()) {
      // we're making that assumption again about just one outputpagevar.
      //   also that everything is happening in one tab.  must come back and
      //   revisit this
      const ringerStmt = <OutputPageVarStatement & PageActionStatement> stmt;
      const currPage = (<PageVariable[]> ringerStmt.outputPageVars)[0];
      const backPage = ringerStmt.pageVar;
      if (backPage && currPage.originalTabId() === backPage.originalTabId()) {
        // only need to add back button if they're actually in the same tab (may
        //   be in diff tabs if CTRL+click, or popup, whatever)
        backStatements.push(new BackStatement(currPage, backPage));
      } else {
        // we're going back to messing with an earlier page, so should close the
        //   current page. insert a statement that will do that
        backStatements.push(new ClosePageStatement(currPage));
      }
    }
  }
  backStatements.reverse(); // must do the back button in reverse order

  const cleanupStatementLs = backStatements;
  // todo: also, this is only one of the places we introduce loops. should do
  //   this everywhere we introduce or adjust loops.  really need to deal with
  //   the fact those aren't aligned right now

  const loopStatement = new LoopStatement(relation, relationColumnsUsed,
    bodyStmts, cleanupStatementLs, pageVar); 
  return loopStatement;
}

// parent will be either the full program or a loop statement
function tryAddingRelationHelper(relation: GenericRelation,
    bodyStmts: HelenaLangObject[], parent: StatementContainer): boolean {
  for (let i = 0; i < bodyStmts.length; i++) {
    const stmt = bodyStmts[i];
    if (stmt instanceof LoopStatement) {
      const used = tryAddingRelationHelper(relation, stmt.bodyStatements, stmt);
      if (used) {
        // if we've already found a use for it, we won't try to use it twice.
        //   so at least for now, as long as we only want one use, we should
        //   stop checking here, not continue
        return used;
      }
    }
    
    if (stmt.usesRelation(relation)) {
      // ok, let's assume the rest of this loop's body should be nested
      const bodyStatementLs = bodyStmts.slice(i, bodyStmts.length);
      if (!(stmt instanceof PageActionStatement) || !stmt.pageVar) {
        throw new ReferenceError("Have an incorrect statement reference");
      }

      // statement uses relation, so pick statement's pageVar
      const loopStatement = loopStatementFromBodyAndRelation(bodyStatementLs,
        relation, stmt.pageVar);
      // awesome, we have our new loop statement, which should now be the final
      //   statement in the parent
      const newStatements = bodyStmts.slice(0,i);
      newStatements.push(loopStatement);
      parent.updateChildStatements(newStatements);
      return true;
    }
  }
  return false;
}


function removeLoopsForRelation(bodyStmts: HelenaLangObject[],
    relation: GenericRelation): HelenaLangObject[] {
  let outputStatements: HelenaLangObject[] = [];
  for (const stmt of bodyStmts) {
    if (stmt instanceof LoopStatement) {
      if (stmt.relation === relation) {
        // ok, we want to remove this loop; let's pop the body statements back
        //   out into our outputStatements
        const bodyStmts = removeLoopsForRelation(stmt.bodyStatements, relation);
        outputStatements = outputStatements.concat(bodyStmts);
      } else {
        // we want to keep this loop, but we'd better descend and check the loop
        //   body still
        const newChildStatements = removeLoopsForRelation(stmt.bodyStatements,
          relation);
        stmt.updateChildStatements(newChildStatements);
        outputStatements.push(stmt);
      }
    } else {
      // not a loop statement
      stmt.unParameterizeForRelation(relation);
      outputStatements.push(stmt);
    }
  }
  return outputStatements;
}

/**
 * Filter out load events that load URLs whose associated DOM trees the user
 *   never actually uses.
 * @param trace
 */
function markUnnecessaryLoads(trace: DisplayTraceEvent[]) {
  const domEvents =  trace.filter((ev) => ev.type === "dom");
  const domEventURLs = [...new Set(domEvents.map((ev) => Traces.getDOMURL(ev)))];

  // ok, now first let's mark all the loads that are top-level and used, so we
  //   need them for introducing page variables (even if they'll ultimately be
  //   invisible/not load events/not forced to replay)
  //_.each(trace, function(ev){if (ev.type === "completed" &&
  //  ev.data.type === "main_frame" &&
  //  domEventURLs.indexOf(EventM.getLoadURL(ev)) > -1){
  //    EventM.setVisible(ev, true);}});
  
  // all right.  now we want to figure out (based on how the new page was
  //   reached, based on whether we saw a manualload event) which completed
  //   events are manual and shouldn't be made invisible/associated with prior
  //   dom event later

  // ok, manual load events are weird, because they sometimes actually happen
  //   after the completed events, and what we really want is to just go back
  //   and make sure we run completed events like normal but mark them visible
  //   if they include the url we want for the manual load so we'll find the
  //   nearest completed event with the correct url and we'll mark that one
  const urlsToCompletedEvents: {
    [key: string]: any
  } = {};
  for (let i = 0; i < trace.length; i++){
    const ev = trace[i];
    if (RingerEvents.isComplete(ev)) {
      const url = trimSlashes(Traces.getLoadURL(ev));
      if (url in urlsToCompletedEvents){
        urlsToCompletedEvents[url].push([i, ev]);
      } else {
        urlsToCompletedEvents[url] = [[i, ev]];
      }
    }
  }
  for (let i = 0; i < trace.length; i++){
    const ev = trace[i];
    if (ev.type === "manualload") {
      // ok, we found that this was actually a manual load one, so we better
      //   mark an event as visible
      const url = trimSlashes(ev.data.url);
      const completedEvs = urlsToCompletedEvents[url];
      if (!completedEvs || completedEvs.length < 1) {
        console.log("bad bad bad, we couldn't find a completed event for a " +
          "manual load:", ev);
        continue;
      }
      let minDistance = Number.MAX_SAFE_INTEGER;
      let preferredCe = null;
      for (let j = 0; j < completedEvs.length; j++){
        const ceIndex = completedEvs[j][0];
        const ce = completedEvs[j][1];
        const diff = Math.abs(ceIndex - i);
        if (diff < minDistance){
          minDistance = diff;
          preferredCe = ce;
        }
      }
      // go ahead and mark the closest completed event as the one that's
      //   visible/must be replayed
      Traces.setVisible(preferredCe, true);

      // go ahead and mark the closest completed event as the one that's
      //   visible/must be replayed
      Traces.setManual(preferredCe, true);
    }
  }
  return trace;
}

function trimSlashes(url: string) {
  return url.replace(/\/+$/g, ''); // trim slashes from the end
}

function associateNecessaryLoadsWithIDsAndParameterizePages(trace:
    DisplayTraceEvent[]) {
  let idCounter = 1; // blockly says not to count from 0

  // ok, unfortunately urls (our keys for frametopagevarid) aren't sufficient to
  //   distinguish all the different pagevariables, because sometimes pages load
  //   a new top-level/main_frame page without actually changing the url
  // so we'll need to actually keep track of the ports as well. any ports that
  //   appear with the target url before the creation of the next page var with
  //   the same url, we'll use those for the first page var, and so on

  const urlsToMostRecentPageVar: {
    [key: string]: PageVariable;
  } = {};

  const portsToPageVars: {
    [key: string]: PageVariable;
  } = {};

  // people do redirects!  to track it, let's track the url that was actually
  //   loaded into a given tab last
  const tabToCanonicalUrl: {
    [key: number]: string;
  } = {};

  // people do redirects. let's track which tab each url is in. shame we can't
  //   just get the tab.  whatever
  const urlToTab: {
    [key: string]: number;
  } = {};

  let lastURL = null;
  for (let i = 0; i < trace.length; i++){
    const ev = trace[i];
    const newPageVar = newTopLevelUrlLoadedEvent(ev, lastURL);

    // any time we complete making a new page in the top level, we want to intro
    //   a new pagevar
    if (newPageVar) {
      const url = Traces.getLoadURL(ev);
      if (url === lastURL) {
        // sometimes the same URL appears to load twice in a single logical load
        //   if we see the same url twice in a row, just ignore the second
        trace[i].mayBeSkippable = true;
        continue;
      }
      const p = new PageVariable("page" + idCounter, url);
      Traces.setLoadOutputPageVar(ev, p);
      urlsToMostRecentPageVar[url] = p;
      idCounter += 1;
      const tab = Traces.getTabId(ev);

      // this is the complete-time urls, so go ahead and put it in there
      tabToCanonicalUrl[tab] = url;

      urlToTab[url] = tab;
      // for now, anything that loads a new page var should be visible. later
      //   we'll take away any that shouldn't be
      // but for now it means just that it's top-level and thus needs to be
      //   taken care of
      Traces.setVisible(ev, true);
      lastURL = url;
    } else if (ev.type === "webnavigation") {
      // fortunately webnavigation events look at redirects, so we can put in that a redirect happend in a given tab
      // so that we can use the tab to get the canonical/complete-time url, then use that to get the relevant page var
      const url = Traces.getLoadURL(ev);
      if (!(url in urlToTab)){
        urlToTab[url] = Traces.getTabId(ev);
      }
    } else if (ev.type === "dom") {
      const port = Traces.getDOMPort(ev);
      let pageVar = null;
      if (port in portsToPageVars) {
        // we already know the port, and that's a great way to do the mapping
        pageVar = portsToPageVars[port];
      } else {
        // ok, have to look it up by url
        const url = Traces.getDOMURL(ev);
        let correctUrl = null;
        if (url in urlsToMostRecentPageVar) {
          // great, this dom event already uses the canonical complete-time url
          //   (no redirects)
          correctUrl = url;
        } else {
          // there was a redirect.  but we tracked it via webnavigation events,
          //   so let's go find it
          const tabId = urlToTab[url];
          correctUrl = tabToCanonicalUrl[tabId];
        }
        pageVar = urlsToMostRecentPageVar[correctUrl];
        if (!pageVar){
          HelenaConsole.warn("Woah woah woah, real bad, why did we try to " +
            "associate a dom event with a page var, but we didn't know a page" +
            " var for the dom it happened on????");
        }
        // from now on we'll associate this port with this pagevar, even if
        //   another pagevar later becomes associated with the url
        portsToPageVars[port] = pageVar;
      }
      Traces.setDOMInputPageVar(ev, pageVar); 
      pageVar.setRecordTimeFrameData(ev.frame);
    }
  }
  return trace;
}

function newTopLevelUrlLoadedEvent(ev: DisplayTraceEvent,
    lastURL: string | null) {
  // any time we complete making a new page in the top level, we want to intro
  //   a new pagevar
  return RingerEvents.isComplete(ev);
}


function addCausalLinks(trace: DisplayTraceEvent[]) {
  let lastDOMEvent = null;
  for (const ev of trace) {
    if (ev.type === "dom"){
      lastDOMEvent = ev;
      Traces.setDOMOutputLoadEvents(ev, []);
    } else if (lastDOMEvent !== null && RingerEvents.isComplete(ev) &&
      Traces.getVisible(ev) && !Traces.getManual(ev)) {
      // events should be invisible if they're not top-level or if they're
      //   caused by prior dom events instead of a url-bar load
      // if they're visible right now but not manual, that means they're caused
      //   by a dom event, so let's add the causal link and remove their
      //   visibility
      Traces.setLoadCausedBy(ev, lastDOMEvent);
      Traces.addDOMOutputLoadEvent(lastDOMEvent, ev);
      // now that we have a cause for the load event, we can make it invisible
      Traces.setVisible(ev, false);
    }
  }
  return trace;
}

function removeEventsBeforeFirstVisibleLoad(trace: DisplayTraceEvent[]) {
  for (let i = 0; i < trace.length; i++){
    const ev = trace[i];
    if (Traces.getVisible(ev)) {
      // we've found the first visible event
      return trace.slice(i, trace.length);
    }
  }
  throw new ReferenceError("First visible load not found");
}

function segment(trace: DisplayTraceEvent[]) {
  const allSegments = [];
  let currentSegment: DisplayTraceEvent[] = [];
  // an event that should be shown to the user and thus determines the type of
  //   the statement
  let currentSegmentVisibleEvent = null;
  for (const ev of trace) {
    if (allowedInSameSegment(currentSegmentVisibleEvent, ev)) {
      if (Traces.statementType(ev) !== null) {
        HelenaConsole.log("stype(ev)", ev, Traces.statementType(ev),
          currentSegmentVisibleEvent);
      }
      currentSegment.push(ev);

      // only relevant to first segment
      if (currentSegmentVisibleEvent === null &&
          Traces.statementType(ev) !== null) {
        currentSegmentVisibleEvent = ev;
      }
    } else {
      // the current event isn't allowed in last segment -- maybe it's on a new
      //   node or a new type of action.  need a new segment
      HelenaConsole.log("making a new segment", currentSegmentVisibleEvent, ev,
        currentSegment, currentSegment.length);
      allSegments.push(currentSegment);
      currentSegment = [ev];

      // if this were an invisible event, we wouldn't have needed to start a new
      //   block, so it's always ok to put this in for the current segment's
      //   visible event
      currentSegmentVisibleEvent = ev;
    }
  }
  allSegments.push(currentSegment); // put in that last segment

  // for now rather than this func, we'll try an alternative where we just show
  //   ctrl, alt, shift keypresses in a simpler way
  // allSegments = postSegmentationInvisibilityDetectionAndMerging(allSegments);

  HelenaConsole.log("allSegments", allSegments, allSegments.length);
  return allSegments;
}

 /**
  * Returns true if two trace events should be allowed in the same statement,
  *   based on visibility, statement type, statement page, statement target.
  * @param e1 
  * @param e2 
  */
 function allowedInSameSegment(e1: DisplayTraceEvent | null,
    e2: DisplayTraceEvent | null) {
  // if either of them is null (as when we do not yet have a current visible
  //   event), anything goes
  if (e1 === null || e2 === null) {
    return true;
  }
  const e1type = Traces.statementType(e1);
  const e2type = Traces.statementType(e2);
  HelenaConsole.log("allowedInSameSegment?", e1type, e2type, e1, e2);
  // if either is invisible, can be together, because an invisible event allowed
  //   anywhere
  if (e1type === null || e2type === null) {
    return true;
  }
  // now we know they're both visible
  // visible load events aren't allowed to share with any other visible events
  if (e1type === StatementTypes.LOAD || e2type === StatementTypes.LOAD){
    return false;
  }
  // now we know they're both visible and both dom events
  // if they're both visible, but have the same type and called on the same node, they're allowed together
  if (e1type === e2type) {
    const e1page = Traces.getDOMInputPageVar(e1);
    const e2page = Traces.getDOMInputPageVar(e2);
    if (e1page === e2page) {
      const e1node = e1.target.xpath;
      const e2node = e2.target.xpath;
      if (e1node === e2node) {
        return true;
      }
      // we also have a special case where keyup events allowed in text, but
      //   text not allowed in keyup
      // this is because text segments that start with keyups get a special
      //   treatment, since those are the ctrl, alt, shift type cases
      // if (e1type === StatementTypes.KEYBOARD &&
      //     e2type === StatementTypes.KEYUP) {
      //   return true;
      // }
    }
  }
  return false;
}

function segmentedTraceToProgram(segmentedTrace: DisplayTraceEvent[][],
    addOutputStatement?: boolean) {
  const statements = [];
  for (const seg of segmentedTrace) {
    let sType = null;
    for (let i = 0; i < seg.length; i++){
      const ev = seg[i];
      const st = Traces.statementType(ev);
      if (st !== null){
        sType = st;
        if (sType === StatementTypes.LOAD){
          statements.push(new LoadStatement(seg));
        } else if (sType === StatementTypes.MOUSE) {
          statements.push(new ClickStatement(seg));
        } else if (sType === StatementTypes.SCRAPE ||
                   sType === StatementTypes.SCRAPELINK) {
          statements.push(new ScrapeStatement(seg));
        } else if (sType === StatementTypes.KEYBOARD ||
                   sType === StatementTypes.KEYUP) {
          statements.push(new TypeStatement(seg));
        } else if (sType === StatementTypes.PULLDOWNINTERACTION) {
          statements.push(new PulldownInteractionStatement(seg));
        }
        break;
      }
    }
  }
  return new HelenaProgram(statements, addOutputStatement);
}

/*
function postSegmentationInvisibilityDetectionAndMerging(segments){
  // noticed that we see cases of users doing stray keypresses while over non-targets (as when about to scrape, must hold keys), then get confused when there are screenshots of whole page (or other node) in the control panel
  // so this merging isn't essential or especially foundational, but this detects the cases that are usually just keypresses that won't be parameterized or changed, and it can make the experience less confusing for users if we don't show them
  var outputSegments = [];
  for (var i = 0; i < segments.length; i++){
    var segment = segments[i];
    var merge = false;
    if (HelenaMainpanel.statementType(segment[0]) === StatementTypes.KEYBOARD){
      // ok, it's keyboard events
      WALconsole.log(segment[0].target);
      if (segment[0].target.snapshot.value === undefined && segment.length < 20){
        // yeah, the user probably doesn't want to see this...
        merge = true;
      }
    }
    var currentOutputLength = outputSegments.length;
    if (merge && currentOutputLength > 0){
      outputSegments[currentOutputLength - 1] = outputSegments[currentOutputLength - 1].concat(segments[i]);
    }
    else{
      outputSegments.push(segments[i]);
    }
  }
  return outputSegments;
}

function insertArrayAt(array, index, arrayToInsert) {
  Array.prototype.splice.apply(array, [index, 0].concat(arrayToInsert));
}
function addSeq(listOfStatements, statementSeq, blocklyParentStatement, inputName) {
  for (var i = 0; i < listOfStatements.length; i++) {
    if (listOfStatements[i] === blocklyParentStatement) {
      // awesome, found the new parent.  now the questions is: is this the parent because the new statementSeq
      // comes immediately after it in the listOfStatements?  or because it's the new first
      // seq in the body statements?  blockly does it both ways
      // we'll use inputName to find out
      var s = listOfStatements[i];
      if (inputName === "statements") {
        // ok.  the new seq is going in the body statements, right at the head
        insertArrayAt(s.bodyStatements, 0, statementSeq); // in place, so overwriting the original
      }
      else{
        // ok, not going in the body statements
        // going after this statement in the current listOfStatements
        insertArrayAt(listOfStatements, i + 1, statementSeq); // in place, again, so overwriting the original
      }
      return true;
    }
    else{
      // ok, haven't found it yet.  mayhaps it belongs in the body statements of this very statement?
      if (listOfStatements[i].bodyStatements) {
        // ok, this one has bodyStatements to check
        var res = addSeq(listOfStatements[i].bodyStatements, statementSeq, blocklyParentStatement, inputName);
        if (res) {
          // awesome, we're done
          return res;
        }
      }
    }
  }
  return false;
}

function checkEnoughMemoryToCloneTrace(memoryData, trace) {
  var approximateMemoryPerEvent = 133333; // bytes
  //if (data.availableCapacity/data.capacity < 0.1) { // this is for testing
  return (memoryData.availableCapacity) > approximateMemoryPerEvent * trace.length * 2.5;
}
function splitOnEnoughMemoryToCloneTrace(trace, ifEnoughMemory, ifNotEnoughMemory) {
  var check = function() {
    chrome.system.memory.getInfo(function(data) {
      if (checkEnoughMemoryToCloneTrace(data, trace)) {
        ifEnoughMemory();
      }
      else{
        ifNotEnoughMemory();
      }
    });
  };
  try {
      check();
  } catch(err) {
    // just try again until it works
    setTimeout(function() {splitOnEnoughMemoryToCloneTrace(trace,
      ifEnoughMemory, ifNotEnoughMemory);}, 1000);
  }
}
*/