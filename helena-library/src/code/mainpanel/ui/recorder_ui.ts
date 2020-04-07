import * as _ from "underscore";
import * as later from "later";

import { HelenaConsole } from "../../common/utils/helena_console";
import { DOMCreation } from "../../common/utils/dom_creation";
import { HelenaUIBase } from "./helena_ui_base";

import { EditRelationMessage, NextButtonSelectorMessage, RelationResponse,
  Messages,
  ScheduledScriptMessage,
  SavedProgramMessage} from "../../common/messages";

import { Relation } from "../relation/relation";
import { TextRelation } from "../relation/text_relation";

import { AnnotationItem } from "../lang/statements/control_flow/skip_block";
import { MainpanelNode } from "../../common/mainpanel_node";
import { HelenaProgram, RunObject } from "../lang/program";
import { LoadStatement } from "../lang/statements/browser/load";
import { ScheduledRun } from "../../common/scheduled_run";
import { HelenaConfig } from "../../common/config/config";
import { MiscUtilities } from "../../common/misc_utilities";
import { Dataset } from "../dataset";
import { HelenaServer } from "../utils/server";
import { Indexable } from "../../ringer-record-replay/common/utils";
import { Trace } from "../../common/utils/trace";
import { NextButtonTypes, IColumnSelector } from "../../content/selector/interfaces";

function activateButton(div: JQuery<HTMLElement>, selector: string,
  handler: JQuery.EventHandlerBase<HTMLElement,
    JQuery.ClickEvent<HTMLElement, null, HTMLElement, HTMLElement>>) {
  let button = div.find(selector);
  button.button();
  button.click(handler);
}

/**
 * Guide the user through making a demonstration recording.
 */
export class RecorderUI extends HelenaUIBase {
  public static ifttturl =
    "https://maker.ifttt.com/trigger/scheduled_scrape_completed/with/key/cBhUYy-EzpfmsfrJ9Bzs2p";

  public tabs?: JQuery<HTMLElement>;

  public ringerUseXpathFastMode: boolean;
  
  // I'm going to make these accessible from the outside for debuggning purposes
  public currentRingerTrace?: Trace;
  public currentHelenaProgram?: HelenaProgram | null;

  private currentRecordingWindow?: number;
  private scriptRunCounter: number;

  // during recording, when user scrapes, show the text so user gets feedback on
  //   what's happening
  // dictionary based on xpath since we can get multiple DOM events that scrape
  //   same data from same node
  private scraped: Indexable; 
  // todo: note that since we're indexing on xpath, if had same xpath on
  //   multiple different pages, this would fail to show us some data.  bad!
  //   actually, I think this whole thing may be unnecessary.  we've just been
  //   adding in the same xpath to the xpaths list to control how we display it
  //   anyway, so the indexing isn't really getting us anything, isn't
  //   eliminating anything, and we haven't had any trouble. looks like an
  //   artifact of an old style.  todo: get rid of it when have a chance.
  private keys: string[]; // want to show texts in the right order

  private currentSkipper?: Function;

  private highlyHumanReadable: {
    [key: string]: number
  };

  private currentUploadRelation?: TextRelation | null;

  constructor() {
    super();

    this.ringerUseXpathFastMode = true;

    this.scriptRunCounter = 0;
    this.scraped = {};
    this.keys = [];

    this.highlyHumanReadable = {
      "textContent": 12,
      "preceding-text": 10,
      "previousElementSiblingText": 10,
      "firstWord": 10,
      "firstTwoWords": 10,
      "firstThreeWords": 10,
      "preColonText": 11,
      "lastWord": 10,
      "possibleHeading": 10,
      "id": 9,
      "tagName": 9,
      "className": 9,
      "xpath": 8,
      "background-color": 7,
      "background-image": 7
    };

    $(this.init.bind(this));
  }

  public init() {
    const self = this;
    // messages received by this component
    // Messages.listenForMessage("content", "mainpanel", "selectorAndListData",
    //   processSelectorAndListData);
    // Messages.listenForMessage("content", "mainpanel", "nextButtonData",
    //   processNextButtonData);
    // Messages.listenForMessage("content", "mainpanel", "moreItems",
    //   moreItems);
    Messages.listenForMessage("content", "mainpanel", "scrapedData",
      this.processScrapedData.bind(this));
    Messages.listenForMessage("content", "mainpanel",
      "requestCurrentRecordingWindows",
      this.sendCurrentRecordingWindows.bind(this));
    Messages.listenForMessage("background", "mainpanel",
      "runScheduledScript", this.runScheduledScript.bind(this));
    Messages.listenForMessage("background", "mainpanel",
      "pleasePrepareForRefresh", this.prepareForPageRefresh.bind(this));
    Messages.listenForMessage("content", "mainpanel",
      "requestRingerUseXpathFastMode", () =>
        Messages.sendMessage("mainpanel", "content",
          "ringerUseXpathFastMode", {use: self.ringerUseXpathFastMode})
    );

    // handle user interactions with the mainpanel
    this.setUpRecordingUI();

    $(document).tooltip();

    // communicate to the HelenaBaseUI what we've called the elements we're using for blockly stuff
    this.setBlocklyDivIds("new_script_content", "toolbox", "blockly_area", "blockly_div");

    // it's possible that we want to start right off by doing a recording, in which case let's start that here
    let urlString = window.location.href;
    let url = new URL(urlString);
    let startUrl = url.searchParams.get("starturl");
    this.startRecording(startUrl? startUrl : undefined);
    this.setScrapingInstructions("#scraping_instructions");

  }

  public setScrapingInstructions(instructionsDivSelector: string) {
    let scrapeCond = "<kbd>ALT</kbd> + click";
    let linkScrapeCond = "<kbd>ALT</kbd> + <kbd>SHIFT</kbd> + click";

    if (window.navigator.platform.includes("Linux")) {
      scrapeCond = "<kbd>ALT</kbd> + <kbd>CTRL</kbd> + click";
      linkScrapeCond = "<kbd>ALT</kbd> + <kbd>CTRL</kbd> + <kbd>SHIFT</kbd>" +
        " + click";
    }

    let innerHTML = $(instructionsDivSelector).html();
    innerHTML = innerHTML.replace(
      new RegExp("___SCRAPINGCONDITIONSTRING___", "g"),
      scrapeCond
    );
    innerHTML = innerHTML.replace(
      new RegExp("___LINKSCRAPINGCONDITIONSTRING___", "g"),
      linkScrapeCond
    );

    $(instructionsDivSelector).html(innerHTML);
  }

  public setUpRecordingUI() {
    const self = this;

    // we'll start on the first tab, our default, which gives user change to
    //   start a new recording
    const tabsDivs = $("#tabs");
    this.tabs = tabsDivs.tabs();

    // if we switch to the second tab, we'll need to load in all the saved scripts
    tabsDivs.on("tabsbeforeactivate", (event, ui) => {
      if (ui.newPanel.attr('id') === "tabs-2") {
        self.loadSavedScripts();
      }
      if (ui.newPanel.attr('id') === "tabs-3") {
        self.loadScheduledScripts();
      }
    });

    this.showStartRecording();
  }

  public showStartRecording() {
    const self = this;
    const div = $("#new_script_content");
    DOMCreation.replaceContent(div, $("#about_to_record"));
    div.find("#start_recording").click(() => self.startRecording());
  }

  public startRecording(specifiedUrl?: string) {
    const self = this;

    console.log("startRecording", specifiedUrl);
    const div = $("#new_script_content");
    DOMCreation.replaceContent(div, $("#recording"));
    div.find("#stop_recording").click(this.stopRecording.bind(this));
    div.find("#cancel_recording").click(this.cancelRecording.bind(this));

    // if we already recorded one, there could be old stuff in here, so clear it
    //   out
    const $div = $("#scraped_items_preview");
    $div.html("<div class='scraped_items_preview_start'>" +
      "Collect the FIRST ROW of your target dataset.</div>");

    MiscUtilities.makeNewRecordReplayWindow((windowId: number) => {
      window.helenaMainpanel.recordingWindowIds.push(windowId);
      self.currentRecordingWindow = windowId;
      window.ringerMainpanel.reset();
      window.ringerMainpanel.start();
    }, specifiedUrl);
  }

  public sendCurrentRecordingWindows() {
    // the tabs will check whether they're in the window that's actually
    //   recording to figure out what UI stuff to show
    Messages.sendMessage("mainpanel", "content",
      "currentRecordingWindows", {
        window_ids: window.helenaMainpanel.recordingWindowIds
      }); 
  }

  private setCurrentProgram(program: HelenaProgram | null, trace?: Trace) {
    this.currentHelenaProgram = program;
    this.currentRingerTrace = trace;
    this.setBlocklyProgram(program);
  }

  private setWindowSize(program: HelenaProgram, trace: Trace) {
    // the last dom event is the one we want to use to figure out the window size
    // because user might have changed the window size to make it work
    let ev;
    for (let i = trace.length - 1; i--; i >= 0) {
      let evCand = trace[i];
      if (evCand.frame) {
        ev = evCand;
        break;
      }
    }
    if (ev) {
      program.windowWidth = ev.frame.outerWidth;
      program.windowHeight = ev.frame.outerHeight;
    }
  }

  /**
   * Sets global configuration variables. Used for test scripts, not in live
   *   execution.
   * @param kvArgs 
   */
  public setGlobalConfig(kvArgs: Indexable) {
    if ("helenaServerUrl" in kvArgs) {
      HelenaConfig.helenaServerUrl = kvArgs.helenaServerUrl;
    }
    if ("numRowsToSendInOneSlice" in kvArgs) {
      HelenaConfig.numRowsToSendInOneSlice = kvArgs.numRowsToSendInOneSlice;
    }
  }

  public stopRecording() {
    window.ringerMainpanel.stop();
    const trace = window.ringerMainpanel.record.getEvents();
    const program = HelenaProgram.fromRingerTrace(trace,
      this.currentRecordingWindow);
    if (program.statements.length < 1) {
      // if we didn't actually see any statements worth replaying, let's assume
      //   they pressed stop before actually doing anything
      this.cancelRecording();
      return;
    }
    this.setCurrentProgram(program, trace);
    this.setWindowSize(program, trace);

    // once we're done, remove the window id from the list of windows where
    //   we're allowed to record
    if (this.currentRecordingWindow) {
      window.helenaMainpanel.recordingWindowIds = window.helenaMainpanel.recordingWindowIds.filter(
        (window) => window !== this.currentRecordingWindow
      );
    }

    // now that we have a script, let's set some processing in motion that will
    //   figure out likely relations
    program.relevantRelations();
    
    // true because we're currently processing the script, stuff is in progress
    this.showProgramPreview(true);
  }

  public cancelRecording() {
    window.ringerMainpanel.stop();
    // once we're done, remove the window id from the list of windows where
    //   we're allowed to record
    if (this.currentRecordingWindow) {
      window.helenaMainpanel.recordingWindowIds = window.helenaMainpanel.recordingWindowIds.filter(
        (window) => window !== this.currentRecordingWindow
      );
    }
    this.showStartRecording();
  }

  public showProgramPreview(inProgress = false) {
    HelenaConsole.log("showProgramPreview");
    const div = $("#new_script_content");
    // let's put in the script_preview node
    DOMCreation.replaceContent(div, $("#script_preview"));

    // I like it when the run button just says "Run Script" for demos
    //   nice to have a reminder that it saves stuff if we're not in demo mode,
    //   but it's prettier with just run
    if (window.helenaMainpanel.demoMode) {
      div.find("#run").html("Run Script");
    }

    activateButton(div, "#run", this.run.bind(this));
    activateButton(div, "#run_fast_mode", this.runWithFastMode.bind(this));
    activateButton(div, "#download_script", this.downloadScript.bind(this));
    activateButton(div, "#load_downloaded_script", () => {
      div.find("#load_downloaded_script_helper").click()
    });
    $('#load_downloaded_script_helper').on("change",
      this.handleNewUploadedHelenaProgram.bind(this)
    );
    activateButton(div, "#save", this.save.bind(this));
    activateButton(div, "#replay", this.replayOriginal.bind(this));
    activateButton(div, "#schedule_later", this.scheduleLater.bind(this));
    activateButton(div, "#start_new", this.startNewScript.bind(this));
    activateButton(div, '#relation_upload', this.uploadRelation.bind(this));
    activateButton(div, '#relation_demonstration',
      this.demonstrateRelation.bind(this));

    // let's handle the collapsibles
    const tablesDiv = div.find("#relevant_tables_accordion");
    const additionalRunOptionsDiv = div.find("#extra_run_options_accordion");
    const troubleshootingDiv = div.find("#troubleshooting_accordion");
    const options = {
      collapsible: true,
      heightStyle: "content",
      active: false
    };
    tablesDiv.accordion(options);
    additionalRunOptionsDiv.accordion(options);
    troubleshootingDiv.accordion({
      collapsible: true,
      active: false,
      heightStyle: "content"
    }); // always want all of these to start closed

    /*
    var troubleshootingDivs = $(".troubleshooting_option");
    for (var i = 0; i < troubleshootingDivs.length; i++) {
      (function() {
        var d = $(troubleshootingDivs[i]);
        var controllingDiv = d.find(".troubleshooting_description");
        var childDiv = d.find(".troubleshooting_option_expansion");
        controllingDiv.click(()=> DOMCreation.toggleDisplay(childDiv));  
      })();
    }
    */

    // when the user updates parameter names, we'll need to do some special
    //   processing
    // div.find("#param_name").get(0).onchange = pub.processNewParameterName;
    activateButton(div, '#add_param', this.processNewParameterName.bind(this));

    // false bc no need to update the toolbox for our setup --
    //   updateDisplayedScript below will do that anyway
    this.setUpBlocklyEditor(false);

    this.updateDisplayedScript();
    this.updateDisplayedRelations(inProgress);
    this.showParamVals();
  }

  private updateUIForRunFinished(dataset: Dataset, timeScraped: number,
      runTabId: string) {
    const div = $("#" + runTabId).find("#running_script_content");
    const done_note = div.find(".done_note");
    done_note.css("display", "inline-block");
    // if we still show the little thing that says we're waiting for output,
    //   hide it now
    div.find("#output_explanation").hide();
    const still_saving_note = div.find(".still_saving_note");
    still_saving_note.css("display", "none");
    div.find("#pause").button("option", "disabled", true);
    div.find("#resume").button("option", "disabled", true);
    div.find("#cancelRun").button("option", "disabled", true);
  }

  public run(fastMode = false, params?: object) {
    const self = this;
    HelenaConsole.log("Params: " + params);
    // first set the correct fast mode, which means setting it to false if we
    //   haven't gotten true passed in might still be on from last time

    // trying something new.  have running just always save the thing.
    //   otherwise, it's so unpredictable
    this.save(() => {
      // now we have a program id (already set in currentHelenaProgram.id)
      self.ringerUseXpathFastMode = fastMode;

      if (!self.currentHelenaProgram) {
        throw new ReferenceError("No currentHelenaProgram.");
      }
      // run whichever program is currently being displayed
      self.currentHelenaProgram.runProgram({},
        self.updateUIForRunFinished.bind(self), params);
    });
  }

  public runWithFastMode() {
    // first turn on fast mode, run
    this.run(true);
  }

  public runWithAndWithoutEntityScopes() {
    this.run();
    this.run(false, { ignoreEntityScope: true });
  }

  public newRunTab(runObject: RunObject) {
    const self = this;

    // first let's make the new tab
    this.scriptRunCounter += 1;
    const tabDivId = 'runTab' + this.scriptRunCounter;

    if (!this.tabs) {
      throw new ReferenceError("Tabs not set.");
    }

    const ul = this.tabs.find("ul");
    $( "<li><a href='#" + tabDivId + "'>Script Run "+ this.scriptRunCounter +
      "</a></li>" ).appendTo(ul);
    $( "<div id='" + tabDivId +
      "'><div id='running_script_content'></div></div>").appendTo(this.tabs);
    this.tabs.tabs("refresh");
    this.tabs.tabs("option", "active", this.scriptRunCounter + 2);

    // update the panel to show pause, resume buttons
    HelenaConsole.log("UI newRunTab");
    const div = $("#" + tabDivId).find("#running_script_content");
    DOMCreation.replaceContent(div, $("#script_running"));

    activateButton(div, "#pause", () => self.pauseRun(runObject));
    activateButton(div, "#resume", () => self.resumeRun(runObject));
    activateButton(div, "#restart", () => self.restartRun(runObject));

    // shouldn't be able to resume before we even pause
    div.find("#resume").button("option", "disabled", true); 

    activateButton(div, "#download", () => runObject.dataset.downloadDataset());
    activateButton(div, "#download_all", () =>
      runObject.dataset.downloadFullDataset());

    activateButton(div, "#cancelRun", () => {
      runObject.program.stopRunning(runObject);
      // todo: maybe have this close the tab or swap us back to the program
      //   preview
    });

    return tabDivId;
  }

  // todo: changing the values in these input boxes should actually prompt call
  //   to update program's default parameter values!!

  public showParamVals() {
    const div = $("#param_wrapper");
    const prog = this.currentHelenaProgram;

    if (!prog) {
      throw new ReferenceError("currentHelenaProgram not set.");
    }

    let paramNames = prog.getParameterNames();
    let params = prog.getParameterDefaultValues();
    let targetDiv = div.find("#current_param_vals");
    targetDiv.empty(); // first clear it out
    
    if (paramNames) {
      for (const name of paramNames) {
        let val = params[name];
        if (!val) {
          val = "no default value set"
        }
        const newDiv = $("<div><span class='paramname'>" + name +
          "</span><input type='text' name='paramval' value='" + val +
          "'></input></div>");
        targetDiv.append(newDiv);
      }
    }
  }

  public processNewParameterName() {
    const div = $("#param_wrapper");
    const prog = this.currentHelenaProgram;

    if (!prog) {
      throw new ReferenceError("currentHelenaProgram not set.");
    }

    const paramInputNode = <HTMLInputElement> div.find("#param_name").get(0);
    const paramName = paramInputNode.value;
    const paramValInputNode = <HTMLInputElement> div.find("#param_val").get(0);
    const paramVal = paramValInputNode.value;
    // prog.setAssociatedString(paramName);
    console.log("Current parameter name", paramName);
    const priorParameterNames = prog.getParameterNames();
    if (priorParameterNames && !priorParameterNames.includes(paramName)) {
      priorParameterNames.push(paramName);
      prog.setParameterNames(priorParameterNames);
      prog.setParameterDefaultValue(paramName, paramVal);
      // now that we've set new variable names, the blockly blocks should be
      //   updated to reflect that
      this.updateDisplayedScript();
      this.showParamVals();
      paramInputNode.value = "Enter parameter name here";
      paramValInputNode.value = "Enter default parameter value here";
    }
  }

  // for saving a program to the server
  public save(postIdRetrievalContinuation: Function) {
    const prog = this.currentHelenaProgram;

    if (!prog) {
      throw new ReferenceError("currentHelenaProgram not set.");
    }

    const div = $("#new_script_content");
    prog.name = (<HTMLInputElement> div.find("#program_name").get(0)).value;

    // ok, time to call the func that actually interacts with the server
    // saveToServer(progName, postIdRetrievalContinuation, saveStartedHandler,
    //   saveCompletedHandler)
    const saveStartedHandler = () => {
      // we've sent the save thing, so tell the user
      const status = div.find("#program_save_status");
      status.html("Saving...");
      status.css("display", "inline");
    }
    const saveCompletedHandler = () => {
      // we've finished the save thing, so tell the user
      const status = div.find("#program_save_status");
      status.html("Saved");
    }

    prog.saveToServer(postIdRetrievalContinuation, saveStartedHandler,
      saveCompletedHandler);
  }

  // for saving a program locally
  public downloadScript() {
    const prog = this.currentHelenaProgram;
    
    if (!prog) {
      throw new ReferenceError("currentHelenaProgram not set.");
    }

    const div = $("#new_script_content");
    prog.name = (<HTMLInputElement> div.find("#program_name").get(0)).value;

    const serializedProg = prog.convertToJSON();
    downloadObject(prog.name + ".hln", serializedProg);
  }

  // for loading a program stored locally
  public handleNewUploadedHelenaProgram(event: Event) {
    const self = this;

    HelenaConsole.log("New program uploaded.");
    const fileReader = new FileReader();
    fileReader.onload = () => {
      const str = fileReader.result;

      if (!str) {
        throw new ReferenceError("File reader has no result.");
      }
      // ok, we have the file contents
      self.loadDownloadedScriptHelper(<string> str);
    }

    // now that we know how to handle reading data, let's actually read some
    const target = <HTMLInputElement> event.target;
    const file = (<FileList> target.files)[0];
    fileReader.readAsText(file);
  }

  private loadDownloadedScriptHelper(serialized_program: string,
    continuation?: Function) {
    const revivedProgram = HelenaProgram.fromJSON(serialized_program);
    this.setCurrentProgram(revivedProgram, undefined);

    // make that first tab (the program running tab) active again
    $("#tabs").tabs("option", "active", 0);

    // false because we're not currently processing the program (as in, finding
    //   relations, something like that)
    this.showProgramPreview(false);
    if (continuation) {
      continuation();
    } 
  }

  public replayOriginal() {
    this.currentHelenaProgram?.replayOriginal();
  }

  public startNewScript() {
    this.setCurrentProgram(null, []);
    // clearing out a couple vars that have state from old prog or recording
    //   process
    this.resetForNewScript();
    this.showStartRecording();
  }

  public pauseRun(runObject: RunObject) {
    HelenaConsole.log("Setting pause flag.");
    
    // next runbasicblock call will handle saving a continuation
    runObject.userPaused = true;

    const div = $("#" + runObject.tab).find("#running_script_content");

    // can't pause while we're paused
    div.find("#pause").button("option", "disabled", true);

    div.find("#resume").button("option", "disabled", false); // can now resume
  }

  public resumeRun(runObject: RunObject) {
    runObject.userPaused = false;
    const div = $("#" + runObject.tab).find("#running_script_content");
    div.find("#pause").button("option", "disabled", false);
    div.find("#resume").button("option", "disabled", true);
    if (runObject.resumeContinuation) {
      runObject.resumeContinuation();
    }
  }

  public restartRun(runObject: RunObject) {
    HelenaConsole.log("Restarting.");
    const div = $("#" + runObject.tab).find("#running_script_content");
    //div.find("#pause").button("option", "disabled", false);
    div.find("#resume").button("option", "disabled", true);
    runObject.program.restartFromBeginning(runObject,
      this.updateUIForRunFinished.bind(this));
  }

  public scheduleLater() {
    const self = this;

    HelenaConsole.log("going to schedule later runs.");
    const div = $("#new_script_content");
    DOMCreation.replaceContent(div, $("#schedule_a_run"));
    activateButton(div, "#schedule_a_run_done", () => {
      const scheduleText = <string> div.find("#schedule").val();
      const schedule = later.parse.text(scheduleText);
      if (schedule.error !== -1) {
        // drat, we couldn't parse it.  tell user
        div.find("#schedule_parse_failed").css("display", "inline-block");
        console.log(scheduleText, schedule);
      } else {
        // ok, everything is fine.  just save the thing
        const scheduledRecord: ScheduledRun = {
          schedule: scheduleText,
          progId: <string> self.currentHelenaProgram?.id
        };
        window.chrome.storage.sync.get("scheduledRuns", (obj) => {
          if (!obj.scheduledRuns) {
            obj.scheduledRuns = [];
          }
          obj.scheduledRuns.push(scheduledRecord);
          chrome.storage.sync.set(obj, () => {
            console.log("Saved the new scheduled run.");
            // and let's go back to our normal view of the program
            self.showProgramPreview(false);
            // and let's tell the background script to retrieve all the
            //   schedules so it will actually run them
            Messages.sendMessage("mainpanel", "background",
              "scheduleScrapes", {});
          })
        });
      }
    });
  }

  public resetForNewScript() {
    this.scraped = {};
    this.keys = [];
    window.helenaMainpanel.resetForNewScript();
  }

  public processScrapedData(data: MainpanelNode.Interface) {
    const xpath = data.xpath;
    let id = xpath + "_" + data.source_url;
    if (data.linkScraping) {
      id += data.link;
      this.scraped[id] = data.link;
    } else {
      // just wanted to scrape text
      id += data.text;
      this.scraped[id] = data.text;
    }
    this.keys.push(id);
    const $div = $("#scraped_items_preview");
    $div.html("");
    for (const key of this.keys) {
      $div.append($(`<div class="first_row_elem">${this.scraped[key]}</div>`));
    }
  }

  public runScheduledScript(data: ScheduledScriptMessage) {
    const self = this;
    console.log("Running scheduled script", data);
    // let's let the background script know that we got its message
    Messages.sendMessage("mainpanel", "background",
      "runningScheduledScript", {});
    const progId = data.progId;
    this.loadSavedProgram(progId, () => {
      const curProg = <HelenaProgram> self.currentHelenaProgram;
      // once it's loaded, go ahead and actually run it.
      curProg.runProgram({}, (datasetObj: Dataset, timeToScrape: number,
          tabId: string) => {
        const curProg = <HelenaProgram> self.currentHelenaProgram;
        // and for scheduled runs we're doing something that's currently a
        //   little wacky, where we trigger an IFTTT action when the scrape has
        //   run
        // todo: come up with a cleaner set up for this
        // this is the part that will send the email
        const subject = "Scheduled Scrape Completed: " + curProg.name;
        const url = datasetObj.downloadUrl();
        const fullurl = datasetObj.downloadFullDatasetUrl();
        const body = "dataset: " + datasetObj.getId() + "<br>dataset download" +
          " url (most recent scrape output): <a href=" + url + ">" + url +
          "</a>" + "<br>full dataset download url (all scrape outputs): " +
          "<a href=" + fullurl + ">" + fullurl + "</a><br>num rows:" +
          datasetObj.fullDatasetLength + "<br>time to scrape (milliseconds): "
          + timeToScrape;
        $.post(RecorderUI.ifttturl, {
          value1: subject,
          value2: body
        });
        self.updateUIForRunFinished(datasetObj, timeToScrape, tabId);
      });
    });
  }

  public prepareForPageRefresh() {
    // first we want to wrap up anything we might have been doing.  in
    //   particular, if we're scraping and we have some outstanding data, not
    //   yet backed up to the server, better send it to the server.
    //   should we stop scraping also?

    for (const runObject of window.helenaMainpanel.currentRunObjects) {
      this.pauseRun(runObject); // we'll let that do its thing in the background
    }

    let i = 0;
    const processARunObject = function() {
      if (i >= window.helenaMainpanel.currentRunObjects.length) {
        // ok, we're done.  we've closed the datasets for all the current run
        //   objects. we want to let the background page know that we refreshed,
        //   in case it was the one that requested it
        Messages.sendMessage("mainpanel", "background",
          "readyToRefresh", {});
      } else {
        // still more run objects to process
        const runObject = window.helenaMainpanel.currentRunObjects[i];
        i += 1;
        runObject.dataset.closeDatasetWithCont(processARunObject);
      }
    }

    processARunObject();
  }

  private editSelector(relation: Relation) {
    const self = this;
    // show the UI for editing the selector
    // we need to open up the new tab that we'll use for showing and editing the
    //   relation, and we need to set up a listener to update the selector
    //   associated with this relation, based on changes the user makes over at
    //   the content script
    let bestLengthSoFar = 0;
    let heardAnswer = false;
    chrome.tabs.create({ url: relation.url, active: true }, (tab) => {
      const tabId = tab.id;
      if (tabId === undefined) {
        throw new ReferenceError("Tab has no ID set.");
      }
      self.showRelationEditor(relation, tabId);
      const sendSelectorInfo = () => {
        Messages.sendMessage("mainpanel", "content", "editRelation",
          relation.messageRelationRepresentation(), undefined, undefined,
          [ tabId ]);
        };
      const sendSelectorInfoUntilAnswer = () => {
        $("#instructions_part_1").css("display", "none");
        $("#instructions_part_2").css("display", "block");
        if (heardAnswer) { return; }
        sendSelectorInfo(); 
        setTimeout(sendSelectorInfoUntilAnswer, 1000);
      }
      // var div = $("#new_script_content");
      const button = $("#page_looks_right");
      button.button();
      button.click(sendSelectorInfoUntilAnswer);
    });
    // now we've sent over the current selector info.  let's set up the listener
    //   that will update the preview (and the object)
    Messages.listenForMessageWithKey("content", "mainpanel",
      "editRelation", "editRelation",
      (msg: RelationResponse & EditRelationMessage &
          Messages.MessageContentWithTab) => {
        heardAnswer = true;
        if (msg.demonstration_time_relation.length >= bestLengthSoFar) {
          bestLengthSoFar = msg.demonstration_time_relation.length;
          if (bestLengthSoFar > 0) {
            relation.setNewAttributes(msg.selector, msg.selector_version,
              msg.exclude_first, msg.columns, msg.demonstration_time_relation,
              msg.num_rows_in_demonstration, msg.next_type,
              msg.next_button_selector);
            self.updateDisplayedRelation(relation, msg.colors);
            self.setColumnColors(msg.colors, msg.columns, msg.tab_id);
          } else {
            // still need to give the user the option to add a new column, even
            //   if we have no selector so far
            self.setColumnColors([], [], msg.tab_id);
          }
        }
      }
    );
    // remember this will overwrite previous editRelation listeners, since
    //   we're providing a key
  }

  private replaceRelation(relation: TextRelation) {
    const self = this;
    // show the UI for replacing the selector, which will basically be the same
    //   as the one we use for uploading a text relation in the first place
    HelenaConsole.log("going to upload a replacement relation.");
    const div = $("#new_script_content");
    DOMCreation.replaceContent(div, $("#upload_relation"));
    
    // and let's actually process changes
    $('#upload_data').on("change", this.handleNewUploadedRelation.bind(this));

    activateButton(div, "#upload_done", () => {
      if (self.currentUploadRelation) {
        relation.setRelationContents(
          self.currentUploadRelation.getRelationContents()
        );
      }
      self.showProgramPreview();
      self.currentUploadRelation = null;
    }); // ok, we're actually using this relation
    
    activateButton(div, "#upload_cancel", () => {
      self.showProgramPreview();
      self.currentUploadRelation = null;
    }); // don't really need to do anything here
  }

  public handleFunctionForSkippingToNextPageOfRelationFinding(
    skipToNextPageFunc: Function) {
      this.currentSkipper = skipToNextPageFunc;
  };

  public handleRelationFindingPageUpdate(pageCurrentlyBeingSearched: number) {
    const $overlaytext = $("#overlay").find("#overlay_text");
    const $currentPage = $overlaytext.find("#overlay_text_current_page");
    if ($currentPage.length > 0) {
      $currentPage.html(pageCurrentlyBeingSearched.toString());
    } else {
      $overlaytext.append(
        $("<div>Currently looking for relations on page " + 
          "<span id='overlay_text_current_page'>" + pageCurrentlyBeingSearched +
          "</span>.</div>"));
    }
  }

  public updateDisplayedRelations(currentlyUpdating = false) {
    const self = this;
    HelenaConsole.log("updateDisplayedRelation");

    if (!self.currentHelenaProgram) {
      throw new ReferenceError("currentHelenaProgram not set.");
    }

    const relations = self.currentHelenaProgram.relations;
    let $div = $("#new_script_content").find("#status_message");
    $div.html("");
    const $overlay = $("#overlay");
    const $overlaytext = $overlay.find("#overlay_text");
    if (currentlyUpdating) {
      $overlaytext.html("<center><img src='../icons/ajax-loader2.gif' " + 
        "height='20px'><br>Looking at webpages to find relevant tables. " +
        "Give us a moment.<br></center>");
      
      if (!window.helenaMainpanel.demoMode) {
        const giveUpButton =
          $("<button>Give up looking for relevant tables.</button>");
        giveUpButton.button();
        giveUpButton.click(() => {
          // if user thinks we won't have relations, go ahead and do prog
          //   processing (making loopyStatements) without them
          self.currentHelenaProgram?.insertLoops(true);
          // and let's prevent future guessed relations from messing us up
          self.currentHelenaProgram?.forbidAutomaticLoopInsertion();
        });
        $overlaytext.append(giveUpButton);

        const giveUpButton2 = $("<button>Give up ON THIS CURRENT PAGE " +
          "(and continue to next page).</button>");
        giveUpButton2.button();
      
        // this gets updated by
        //   handleFunctionForSkippingToNextPageOfRelationFinding above
        giveUpButton2.click(() => {
          if (self.currentSkipper) {
            self.currentSkipper();
          }
        });
        $overlaytext.append(giveUpButton2);
      }

      $overlay.css("display", "inline");
    } else {
      $overlay.css("display", "none");
    }

    $div = $("#new_script_content").find("#relations");
    $div.html("");
    if (relations.length === 0 && !currentlyUpdating) {
      $div.html("No relevant tables found. Sorry!");  
      return;
    }
    for (const relation of relations) {
      HelenaConsole.log("updateDisplayedRelations table");
      const $relDiv = $("<div class=relation_preview></div>");
      $div.append($relDiv);
      let textRelation = relation.demonstrationTimeRelationText();
      if (textRelation.length > 2) {
        textRelation = textRelation.slice(0,3);
        textRelation.push(
          Array.apply(null, Array(textRelation[0].length)).map(() => "..."));
      }
      const table = DOMCreation.arrayOfArraysToTable(
        textRelation);

      const columns = relation.columns;
      const tr = $("<tr></tr>");
      for (const column of columns) {
        const columnTitle = $("<input></input>");
        columnTitle.val(<string> column.name);
        columnTitle.change(() => {
          relation.setColumnName(column, <string> columnTitle.val());
          self.updateDisplayedScript();
        });

        const td = $("<td></td>");
        td.append(columnTitle);
        tr.append(td);
      }
      table.prepend(tr);
      const relationTitle = $("<input></input>");
      relationTitle.val(relation.name);
      relationTitle.change(() => {
        relation.name = <string> relationTitle.val();
        self.updateDisplayedScript();
      });
      $relDiv.append(relationTitle);
      $relDiv.append(table);

      const saveRelationButton =
        $("<button>Save These Table and Column Names</button>");
      saveRelationButton.button();
      saveRelationButton.click(() => (<Relation> relation).saveToServer());
      $relDiv.append(saveRelationButton);

      const editRelationButton = $("<button>Edit This Table</button>");
      editRelationButton.button();
      editRelationButton.click(() => self.editSelector(<Relation> relation));
      $relDiv.append(editRelationButton);

      const removeRelationButton =
        $("<button>This Table Is Not Relevant</button>");
      removeRelationButton.button();
      removeRelationButton.click(() => {
        self.currentHelenaProgram?.removeRelation(relation);
      });
      $relDiv.append(removeRelationButton);
      HelenaConsole.log("Done with updateDisplayedRelations table");

      if (relation instanceof TextRelation) {
        const replaceRelationButton =
          $("<button>Replace This Uploaded Table</button>");
        replaceRelationButton.button();
        replaceRelationButton.click(() => self.replaceRelation(relation));
        $relDiv.append(replaceRelationButton);
      }
    }

    // if the relation gets updated, the preview for the duplicate detection
    //   should change
    self.updateDuplicateDetection();
  }

  public showRelationEditor(relation: Relation, tabId: number) {
    const self = this;

    const div = $("#new_script_content");
    DOMCreation.replaceContent(div, $("#relation_editing"));

    // let's highlight the appropriate next_type
    const currNextType = relation.nextType;

    // remember we have to keep the NextButtonTypes in line with the
    //   ids in the mainpanel html
    const checkedNode = div.find("#next_type_" + currNextType);
    checkedNode.prop("checked", true);
    const radioButtons = <JQuery<HTMLInputElement>>
      div.find('#next_type input[type=radio]');

    for (const radioButton of radioButtons) {
      // name must be different from the name of other buttonsets, and since
      //   we've copied from elsewhere on the page, we need to change this
      radioButton.name = radioButton.name + "_current";
    }

    // var nextTypeButtonset = div.find("#next_type").buttonset();
    radioButtons.change((event: JQuery.ChangeEvent) => {
      const target = <HTMLInputElement> event.currentTarget;
      relation.nextType = parseInt(target.value);
      if (relation.nextType === NextButtonTypes.NEXTBUTTON ||
          relation.nextType === NextButtonTypes.MOREBUTTON) {
        // ok, we need the user to actually show us the button
        let buttonType = "next";
        if (relation.nextType === NextButtonTypes.MOREBUTTON) {
          buttonType = "more";
        }
        const expl = div.find("#next_type_explanation");
        expl.html("Please click on the '" + buttonType + "' button now.");

        Messages.listenForMessageOnce("content", "mainpanel",
        "nextButtonSelector", (data: NextButtonSelectorMessage) => {
          relation.nextButtonSelector = data.selector;
          expl.html("");
        });
        Messages.sendMessage("mainpanel", "content",
          "nextButtonSelector", {}, undefined, undefined, [tabId]);
      } else {
        Messages.sendMessage("mainpanel", "content",
          "clearNextButtonSelector", {}, undefined, undefined, [tabId]);
      }
    });

    // ready button
    const readyButton = div.find("#relation_editing_ready");
    readyButton.button();

    readyButton.click(() => {
      // once ready button clicked, we'll already have updated the relation
      //   selector info based on messages the content panel has been sending,
      //   so we can just go back to looking at the program preview

      // one exception -- if this was a whole new relation, it won't be in there
      //   so then we'll need to add it
      console.log("relation", relation);
      const rels = self.currentHelenaProgram?.relations;
      if (rels && !rels.includes(relation)) {
        self.currentHelenaProgram?.relations.push(relation);
      }
      
      // one thing we do need to change is there may now be nodes included in
      //   the relation (or excluded) that weren't before, so we should redo
      //   loop insertion
      self.currentHelenaProgram?.insertLoops(false);

      self.showProgramPreview();
      // we also want to close the tab...
      console.log("showRelationEditor removing tab", tabId);
      chrome.tabs.remove(tabId);
      // todo: maybe we also want to automatically save changes to server?
      //   something to consider.  not yet sure
    });
  }

  public updateDisplayedRelation(relation: Relation, colors: string[]) {
    const self = this;
    HelenaConsole.log("updateDisplayedRelation");
    const $relDiv = $("#new_script_content").find("#output_preview");
    $relDiv.html("");

    const textRelation = relation.demonstrationTimeRelationText();
    const table = DOMCreation.arrayOfArraysToTable(
      textRelation);

    const columns = relation.columns;
    const tr = $("<tr></tr>");
    let colIndex = 0;
    for (const column of columns) {
      const xpath = column.xpath;
      const colorStyle = "style='background-color:" + colors[colIndex] + ";'";
      const columnTitle = $("<input class='edit-relation-table-header-cell' " +
        colorStyle + " ></input>");
      columnTitle.val(<string> column.name);
      columnTitle.change(() => {
        HelenaConsole.log(columnTitle.val(), xpath);
        relation.setColumnName(column, <string> columnTitle.val());
        self.updateDisplayedScript();
      });
      const td = $("<td></td>");
      td.append(columnTitle);
      tr.append(td);
      colIndex++;
    }
    table.prepend(tr);

    const relationTitle = $("<input></input>");
    relationTitle.val(relation.name);
    relationTitle.change(() => {
      relation.name = <string> relationTitle.val();
      self.updateDisplayedScript();
    });
    $relDiv.append(relationTitle);
    $relDiv.append(table);
  };

  public setColumnColors(colors: string[], columnLs: IColumnSelector[],
    tabid: number) {
    const $div = $("#new_script_content").find("#color_selector");
    $div.html("Select the right color for the cell you want to add:   ");
    for (let i = 0; i < columnLs.length; i++) {
      const colorDiv = $("<div class='edit-relation-color-block' " +
        "style='background-color:" + colors[i] + "'></div>");
      const col = columnLs[i].index;
      colorDiv.click(() => {
        Messages.sendMessage("mainpanel", "content",
          "currentColumnIndex", { index: col }, undefined, undefined, [tabid]);
      });
      $div.append(colorDiv);
    }

    // todo: now going to allow folks to make a new column, but also need to
    //   communicate with content script about color to show
    const separatorDiv = $("<div class='edit-relation-color-block'>or</div>");
    const colorDiv = $("<div class='edit-relation-color-block' " + 
      "id='edit-relation-new-col-button'>New Col</div>");
    colorDiv.click(() => {
      Messages.sendMessage("mainpanel", "content", "currentColumnIndex",
        {index: "newCol"}, undefined, undefined, [tabid]);
      }
    );
    $div.append(separatorDiv);
    $div.append(colorDiv);
  }

  public updateDisplayedScript(updateBlockly = true) {
    HelenaConsole.log("updateDisplayedScript");
    const program = this.currentHelenaProgram;
    const scriptPreviewDiv =
      $("#new_script_content").find("#program_representation");

    scriptPreviewDiv.remove();
    if (updateBlockly && program) {
      this.displayBlockly(program);
    }

    if (program) {
      this.updateDisplayedDownloadURLs(program);
    }

    // we also want to update the section that lets the user say what loop
    // iterations are duplicates
    // used for data in relations get shuffled during scraping and for
    //   recovering from failures. also incremental scraping.
    this.updateDuplicateDetection();
    
    // we also want to make sure the user can tell us which features are
    //   required for each node that we find using similarity approach
    this.updateNodeRequiredFeaturesUI();

    // same deal with custom thresholds
    this.updateCustomThresholds();
    this.updateCustomWaits();

    if (program && program.name) {
      const progNameEl = <HTMLInputElement> $("#new_script_content")
        .find("#program_name").get(0);
      progNameEl.value = program.name;
    }
  }

  public programIdUpdated(prog: HelenaProgram) {
    // a special handler that the helena library will call when a program's id
    //   is updated. we'll use it to update the download urls we're showing
    if (prog === this.currentHelenaProgram) {
      this.updateDisplayedDownloadURLs(this.currentHelenaProgram);
    }
  }

  public updateDisplayedDownloadURLs(prog: HelenaProgram) {
    if (prog.id) {
      const $div = $("#new_script_content").find("#advanced_options");
      $div.find("#download_urls_placeholder").remove();

      function makeOrUpdateDownloadUrl($div: JQuery<HTMLElement>, id: string,
        url: string, instructions: string) {
          let $url = $div.find("#" + id);
          if ($url.length < 1) {
            $url = $("<div id='" + id + "'></div>");
            $div.append($url);
          }
          $url.html(instructions + ": <a href=" + url + " target='_blank'>" +
            url + "</a>");
      }

      const baseUrl = Dataset.downloadFullDatasetUrl(prog);
      makeOrUpdateDownloadUrl($div, "download_url_1", baseUrl,
        "Download all data ever scraped by this program at");
      makeOrUpdateDownloadUrl($div, "download_url_2", baseUrl + "/24",
        "Download all data scraped by this program in the last 24 hours (and " +
          "feel free to change the 24 at the end of the URL to your own " +
          "preferred number)");
    }
  }

  public updateDuplicateDetection() {
    const self = this;
    HelenaConsole.log("updateDuplicateDetection");
    const duplicateDetectionData =
      this.currentHelenaProgram?.getDuplicateDetectionData();

    const $div = $("#new_script_content").find("#duplicates_container_content");
    $div.html("");

    if (!duplicateDetectionData) {
      return;
    }

    for (const oneLoopData of duplicateDetectionData) {
      const loopStatement = oneLoopData.loopStatement;
      const table = DOMCreation.arrayOfArraysToTable(oneLoopData.displayData);
      const nodeVariables = oneLoopData.nodeVariables;
      const tr = $("<tr></tr>");
      let annotationItems: AnnotationItem[] = [];
      let availableAnnotationItems: AnnotationItem[] = [];
      let colCount = 0;
      for (const nodeVariable of nodeVariables) {
        const attributes = ["TEXT", "LINK"];
        for (const attr of attributes) {
          let element = { nodeVar: nodeVariable, attr: attr };
          const iColCount = colCount;
          colCount += 1;
          availableAnnotationItems.push(element);
          const attrRequired = $("<input type='checkbox'>");
          attrRequired.change(() => {
            console.log("toggling attribute required for", nodeVariable, attr);
            if (attrRequired.prop("checked")) {
              annotationItems.push(element);
              // now update how we show the table, add green col
              table.find("tr").each((i, row) => {
                const cells = $(row).find("td");
                const targetCell = $(cells[iColCount]);
                targetCell.addClass("greentable");
              });
            } else {
              // can't just use without bc element won't be exactly the same as
              //   the other object, so use findWhere to find the first element
              //   with the same properties
              const matchEl = _.findWhere(annotationItems, element);
              if (matchEl) {
                annotationItems = annotationItems.filter(
                  (item) => item !== matchEl
                );
              }
              // now update how we show the table, remove green col
              table.find("tr").each((i, row) => {
                const cells = $(row).find("td");
                const targetCell = $(cells[iColCount]);
                targetCell.removeClass("greentable");
              });
            }
            console.log("annotationItems", annotationItems)});

          const td = $("<td></td>");
          td.append(attrRequired);
          tr.append(td);
        }
      }
      table.prepend(tr);
      table.find("td").each((i, td) => {
        $(td).css("max-width", "200px");
        $(td).css("word-wrap", "break-word");
      });
      $div.append(table);

      const addAnnotationButton = $("<div>Add Skip Block</div>");
      addAnnotationButton.button();
      addAnnotationButton.click(() => {
        if (self.currentHelenaProgram) {
          loopStatement.addAnnotation(annotationItems, availableAnnotationItems,
            self.currentHelenaProgram);
        }
      });
      $div.append(addAnnotationButton);
    }
  };

  private sortProps(props: { [key: string]: any }, alreadyChosen: string[]) {
    const rankedProps: {
      [key: string]: number;
    } = {}
    for (const prop in props) {
      if (alreadyChosen.indexOf(prop) > -1) {
        rankedProps[prop] = 20;
      } else if (prop in this.highlyHumanReadable) {
        rankedProps[prop] = this.highlyHumanReadable[prop];
      } else if (prop.startsWith("child")) {
        rankedProps[prop] = 6;
      } else if (prop.startsWith("lastChild")) {
        rankedProps[prop] = 5;
      } else {
        rankedProps[prop] = 0;
      }
    }
    return Object.keys(rankedProps).sort(
      (a,b) => rankedProps[b] - rankedProps[a]
    );
  }

  public updateCustomThresholds() {
    HelenaConsole.namedLog("tooCommon", "updateCustomThresholds");
    // program.relationFindingTimeoutThreshold and
    //   program.nextButtonAttemptsThreshold
    const prog = this.currentHelenaProgram;

    if (!prog) {
      throw new ReferenceError("currentHelenaProgram not set");
    }

    const defaultSeconds = HelenaConfig.relationFindingTimeoutThreshold / 1000;
    const defaultTries = HelenaConfig.nextButtonAttemptsThreshold;
    console.log(defaultSeconds, defaultTries);

    // first let's update the description text to include the correct defaults
    const $div = $("#new_script_content").find("#thresholds_container");
    $div.find(".defaultRelationTimeout").html(defaultSeconds.toString());
    $div.find(".defaultRetriesTotal").html(defaultTries.toString());
    $div.find(".defaultRetries").html((defaultTries - 1).toString());

    // now let's update the text boxes to refelct the current program's custom
    //   thresholds, if they have any and put the correct defaults in the input
    //   boxes otherwise
    const secondsInput =
      <HTMLInputElement> $div.find("#relationGiveUpThreshold")[0];
    const triesInput = <HTMLInputElement> $div.find("#nextButtonRetries")[0];

    function setWithSavedValueIfAvailable(inputNode: HTMLInputElement,
      savedValue: number | undefined, defaultValue: number) {
      if (savedValue) { 
        inputNode.value = savedValue.toString();
      } else {
        inputNode.value = defaultValue.toString();
      }
    }

    let progRelationFindingTimeoutThreshold = undefined;
    if (prog.relationFindingTimeoutThreshold) {
      progRelationFindingTimeoutThreshold =
        prog.relationFindingTimeoutThreshold / 1000;
    }

    let progNextButtonAttemptsThreshold = undefined;
    if (prog.nextButtonAttemptsThreshold) {
      progNextButtonAttemptsThreshold =
        prog.nextButtonAttemptsThreshold - 1;
    }

    setWithSavedValueIfAvailable(secondsInput,
      progRelationFindingTimeoutThreshold, defaultSeconds);
    setWithSavedValueIfAvailable(triesInput,
      progNextButtonAttemptsThreshold, defaultTries - 1);

    // ok, now what if the user changes the text in the text box?
    function attachHandlerToUpdateProgValBasedOnNewInput(isint: boolean,
      element: HTMLInputElement, prog: HelenaProgram, progAttribute:
        "relationFindingTimeoutThreshold" | "nextButtonAttemptsThreshold",
      defaultVal: number, transformInputToSaved: Function,
      transformSavedToInput: Function) {
      if (!element.dataset.hasHandler) {
        $(element).change(() => {
          let newVal;
          if (isint) {
            newVal = parseInt(element.value);
          } else {
            newVal = parseFloat(element.value);
          }
          if (newVal !== NaN) {
            prog[progAttribute] = transformInputToSaved(newVal);
            // in case we rounded, update what the input shows
            element.value = newVal.toString();
          } else {
            // ugh, why'd you put in something we can't parse. set it back to
            //   something reasonable
            setWithSavedValueIfAvailable(element,
              transformSavedToInput(prog[progAttribute]), defaultVal);
          }
        });
        element.dataset.hasHandler = "true";
      }
    }

    attachHandlerToUpdateProgValBasedOnNewInput(false, secondsInput, prog,
      "relationFindingTimeoutThreshold", defaultSeconds,
      (a: number) => a * 1000, (a: number) => a / 1000);

    attachHandlerToUpdateProgValBasedOnNewInput(true, triesInput, prog,
      "nextButtonAttemptsThreshold", defaultTries - 1, (a: number) => a + 1,
      (a: number) => a - 1);
  }

  public updateCustomWaits() {
    HelenaConsole.namedLog("tooCommon", "updateCustomWaits");

    // program.relationFindingTimeoutThreshold and
    //   program.nextButtonAttemptsThreshold
    const prog = this.currentHelenaProgram; 

    if (!prog) {
      throw new ReferenceError("currentHelenaProgram not set.");
    }
    const relations = <Relation[]> prog.relations;

    const defaultSeconds = HelenaConfig.relationScrapeWait / 1000;

    const $div = $("#new_script_content").find("#thresholds_container2");

    for (const rel of relations) {
      // first let's add a text box for the current relation
      const $secondsInput = <JQuery<HTMLInputElement>>
        $('<input type="text" class="relationScrapeWait">');
      const newRel = $("<div><div>How long should we wait before extracting " +
        `content from newly-found table cells in table ${rel.name}?` +
        "</div></div>");
      newRel.append($secondsInput);
      newRel.append("seconds");
      const wrapper = $div.find("#thresholds_container2_relations");
      wrapper.append(newRel);
      const secondsInput = $secondsInput[0];

      // let's update the text box to reflect the current program's custom
      //   thresholds, if they have any and put the correct defaults in the
      //   input boxes otherwise

      if (rel.relationScrapeWait) {
        secondsInput.value = (rel.relationScrapeWait / 1000).toString();
      } else {
        secondsInput.value = defaultSeconds.toString();
      }

      // ok, now what if the user changes the text in the text box?
      if (!secondsInput.dataset.hasHandler) {
        $(secondsInput).change(() => {
          let newVal = parseFloat(secondsInput.value);
          if (newVal !== NaN) {
            if (newVal > 5) {
              newVal = 5;
            }
            rel.relationScrapeWait = newVal * 1000;

            // in case we rounded, update what the input shows
            secondsInput.value = newVal.toString();
          }
          else{
            secondsInput.value = defaultSeconds.toString();
          }
        });
        secondsInput.dataset.hasHandler = "true";
      }
    }
  }

  public updateNodeRequiredFeaturesUI() {
    const self = this;
    HelenaConsole.log("updateNodeRequiredFeaturesUI");
    const similarityNodes =
      this.currentHelenaProgram?.getNodesFoundWithSimilarity();

    const $div =
      $("#new_script_content").find("#require_features_container_content");

    if (similarityNodes && similarityNodes.length > 0) {
      $div.html("");
      for (const nodeVar of similarityNodes) {
        const nodeDiv = $("<div class='require_features_node_item'>" + 
          `<div class='node_name'>${nodeVar.toString()}</div></div>`);
        const showNodeFeatures = () => {
          const priorFeaturesDiv = nodeDiv.find(".node_features_container");
          if (priorFeaturesDiv.length > 0) {
            priorFeaturesDiv.remove();
          }
          const featuresDiv = $("<div class='node_features_container'></div>");
          const snapshot = nodeVar.recordTimeSnapshot();
          const requiredFeatures = nodeVar.getRequiredFeatures();
          if (snapshot) {
            const sortedProps = self.sortProps(snapshot, requiredFeatures);
            for (const p of sortedProps) {
              const prop = p;
              let val = (<Indexable> snapshot)[prop];
              if (val && val.length && val.length > 200) {
                val = val.slice(0,50) + "..." +
                  val.slice(val.length - 50, val.length);
              } else if (val === "") {
                val = "EMPTY";
              } else if (!val) {
                val = String(val);
              }
              
              const featureDiv = $("<div class='node_feature'>" +
                `<span class='node_prop'>${prop}</span> must be` +
                `<span class='node_prop_val'>${val}</span></div>`);
              if (requiredFeatures.includes(prop)) {
                featureDiv.addClass('node_feature_selected');
              } else {
                featureDiv.addClass('node_feature_unselected');
              }
              featureDiv.click(() => {
                if (requiredFeatures.includes(prop)) {
                  // if it's currently required, stop requiring it
                  nodeVar.unrequireFeature(prop);
                } else {
                  // if it's currently not required, start requiring it
                  nodeVar.requireFeature(prop);
                }
                // in either case, once the feature node is clicked, have to
                //   re-display the feature data for the whole node
                showNodeFeatures();
              });
              featuresDiv.append(featureDiv);
            }
          }
          nodeDiv.append(featuresDiv);
        }

        $(nodeDiv.find(".node_name")[0]).click(() => {
          // toggle whether we're showing
          const priorFeaturesDiv = nodeDiv.find(".node_features_container");
          if (priorFeaturesDiv.length > 0) {
            priorFeaturesDiv.remove();
          } else {
            showNodeFeatures();
          }
        });

        $div.append(nodeDiv);
      }
    } else {
      $div.html("All of this script's cells come from tables. " + 
        "If you're not happy with the table cells, you might try using the " +
        "`Edit This Table' buttons above.");
    }
  }

  public addNewRowToOutput(runTabId: string, listOfCellTexts: string[],
    limit = 100) {
    const div = $("#" + runTabId).find("#running_script_content")
      .find("#output_preview").find("table").find("tbody");
    const l = div.children().length;
    if (l === limit) {
      if ($("#" + runTabId).find("#running_script_content")
        .find("#output_preview").find("#data_too_big").length === 0) {
          $("#" + runTabId).find("#running_script_content")
            .find("#output_preview")
            .append($("<div id='data_too_big'>This dataset is too big for us " +
              `to display.  The preview here shows the first ${limit} rows. ` +
              "To see the whole dataset, click the download button above." +
              "</div>"));  
      }
    } else if (l < limit) {
      HelenaConsole.log("adding output row: ", l);
      div.append(DOMCreation.arrayOfTextsToTableRow(
        listOfCellTexts));
    }
    $("#" + runTabId).find("#running_script_content")
      .find("#output_explanation").hide();
  }

  public uploadRelation() {
    const self = this;
    HelenaConsole.log("going to upload a relation.");
    const div = $("#new_script_content");
    DOMCreation.replaceContent(div, $("#upload_relation"));
    // and let's actually process changes
    $('#upload_data').on("change", this.handleNewUploadedRelation.bind(this));
    
    // we're actually using this relation. the program better get parameterized
    activateButton(div, "#upload_done", () => {
      if (self.currentUploadRelation) {
        self.currentHelenaProgram?.tryAddingRelation(
          self.currentUploadRelation);
      }
      self.showProgramPreview();
    });
    
    // don't really need to do anything here
    activateButton(div, "#upload_cancel", () => self.showProgramPreview());
  }

  public demonstrateRelation() {
    // for now we'll just assume we want to introduce a new relation on first
    //   page.  in future fix.  todo: fix
    HelenaConsole.log("going to demo a relation.");
    const loadStmt = <LoadStatement> this.currentHelenaProgram?.statements[0];
    let pageVarName = loadStmt.outputPageVar?.name;
    if (!pageVarName) {
      pageVarName = "";
    }
    let url = loadStmt.url;
    if (!url) {
      url = "";
    }
    // TODO: cjbaik: is this how you produce a dummy relation with these vars?
    const newRelation = new Relation("", "", {}, 1, 0, [], [], 0, pageVarName,
      url, 1, null, 0);
    this.editSelector(newRelation);
  }

  public handleNewUploadedRelation(event: JQuery.ChangeEvent) {
    const self = this;
    HelenaConsole.log("New list uploaded.");
    const fileName = event.target.files[0].name;
    const fileReader = new FileReader();
    fileReader.onload = () => {
      let str = <string> fileReader.result;
      if (!str.endsWith("\n")) {
        // sometimes last row gets dropped because no newline at the end of it
        str = str + "\n";
      }
      // ok, we have the file contents.  let's display them
      self.currentUploadRelation = new TextRelation(str, fileName);
      const csvData = self.currentUploadRelation?.relation;
      let sampleData;
      if (csvData && csvData.length > 100) {
        // only going to show a sample
        sampleData = csvData.slice(0,100);

        // to indicate to user that it's a sample
        sampleData.push(new Array(csvData[0].length).fill("..."));
      } else {
        sampleData = csvData;
      }
      const tableElement = DOMCreation.arrayOfArraysToTable(
        sampleData);
      $("#upload_data_table").append(tableElement);
    }
    // now that we know how to handle reading data, let's actually read some
    fileReader.readAsText(event.target.files[0]);
  }

  public addDialog(title: string, dialogText: string,
    buttonTextToHandlers: { [key: string]: Function}) {
    const dialogDiv = $("#dialog");
    const dialogDiv2 = dialogDiv.clone();
    dialogDiv2.attr("title", title);
    dialogDiv2.html(dialogText);
    $("#new_script_content").append(dialogDiv2);
    const buttons = [];
    for (const bt in buttonTextToHandlers) {
      buttons.push({
        text: bt,
        click: () => {
          dialogDiv2.remove();
          buttonTextToHandlers[bt]();
        }
      });
    }
    dialogDiv2.dialog({
      dialogClass: "no-close",
      buttons: buttons,

      // user shouldn't be able to close except by using one of our handlers
      closeOnEscape: false
    }).prev(".ui-dialog-titlebar").css("background","#F9A7AE");;
    return dialogDiv2;
  }

  public continueAfterDialogue(text: string, continueButtonText: string,
    continueButtonContinuation: Function) {
    const handlers: { [key: string]: Function } = {};
    handlers[continueButtonText] = continueButtonContinuation;
    const dialog = this.addDialog("Continue?", text, handlers);
    // todo: also add the option to pause?  which would do the normal user pause
    //   interaction?
    return dialog;
  };

  public loadSavedScripts() {
    const self = this;
    HelenaConsole.log("going to load saved scripts.");
    const savedScriptsDiv = $("#saved_script_list");
    const handler = (response: SavedProgramMessage[]) => {
      HelenaConsole.log(response);
      const arrayOfArrays = response.map((prog) => {
        const date = $.format.date(prog.date * 1000, "dd/MM/yyyy HH:mm")
        return [prog.name, date];
      });
      const html = DOMCreation.arrayOfArraysToTable(arrayOfArrays);
      const trs = html.find("tr");
      for (let i = 0; i < trs.length; i++) {
        const cI = i;
        HelenaConsole.log("adding handler", trs[i], response[i].id);
        $(trs[i]).click(() => {
          HelenaConsole.log(cI);
          const id = response[cI].id;
          self.loadSavedProgram(id);
        });
        $(trs[i]).addClass("hoverable");
      }
      savedScriptsDiv.html("");
      savedScriptsDiv.append(html);
    }
    HelenaServer.loadSavedPrograms(handler);
  }

  public loadScheduledScripts() {
    const self = this;
    chrome.storage.sync.get("scheduledRuns", (obj) => {
      const scriptsDiv = $("#scheduled_runs_list");
      if (!obj.scheduledRuns) {
        // none to show
        scriptsDiv.html("No runs scheduled now.");
        return;
      }

      // ok, looks like we have a few to show
      scriptsDiv.html("");
      for (const run of obj.scheduledRuns) {
        const newNode = $(`<div class='scheduled_script_run'>${run.progId}` +
          `<br />${run.schedule}</div>`);
        const removeButton =
          $("<span class='ui-icon ui-icon-closethick'></span>")
        removeButton.click(() => {
          // if we click, want to remove it from the saved chrome.storage, then
          //   reshow the scheduled scripts
          obj.scheduledRuns = obj.scheduledRuns.filter(
            (schRun: object) => schRun !== run
          );
          chrome.storage.sync.set(obj, () => {
            console.log("Saved the new unscheduled run.");
            // and let's tell the background script to retrieve all the
            //   schedules so it will update the ones it's keeping track of
            Messages.sendMessage("mainpanel", "background",
              "scheduleScrapes", {});
          })
          self.loadScheduledScripts();
        });
        newNode.append(removeButton);
        scriptsDiv.append(newNode);
      }
      /*
      chrome.storage.sync.set(obj, function() {
        console.log("Saved the new scheduled run.");
        // and let's go back to our normal view of the program
        pub.showProgramPreview(false);
        // and let's tell the background script to retrieve all the schedules so
        //   it will actually run them
        Messages.sendMessage("mainpanel", "background", "scheduleScrapes", {});
      })
      */
    });
  }

  public loadSavedDataset(datasetId: number) {
    const self = this;
    HelenaConsole.log("loading dataset: ", datasetId);
    HelenaServer.loadSavedDataset(datasetId, (progId: string) => {
      self.loadSavedProgram(progId);
    });
  }

  public loadSavedProgram(progId: string, continuation?: Function) {
    const self = this;
    HelenaConsole.log("loading program: ", progId);
    HelenaServer.loadSavedProgram(progId,
      (resp: { program: SavedProgramMessage }) => {
        HelenaConsole.log("received program: ", resp);
        const revivedProgram = HelenaProgram.fromJSON(
          resp.program.serialized_program);
        
        // if id was only assigned when it was saved, serialized_prog might not
        //   have that info yet
        revivedProgram.setId(resp.program.id);

        revivedProgram.name = resp.program.name;

        this.setCurrentProgram(revivedProgram, undefined);

        // make that first tab (the program running tab) active again
        $("#tabs").tabs("option", "active", 0);

        // false because we're not currently processing the program (as in,
        //   finding relations, something like that)
        self.showProgramPreview(false);

        if (continuation) {
          continuation();
        }
      }
    );
  }

  public updateRowsSoFar(runTabId: string, num: number) {
    const div = $("#" + runTabId).find("#running_script_content");
    div.find("#rows_so_far").html(num.toString());
  }
}

function downloadObject(filename: string, text: string) {
  const element = document.createElement('a');
  // element.setAttribute('href', 'data:text/plain;charset=utf-8,' +
  //   encodeURIComponent(text));
  element.setAttribute('href', URL.createObjectURL(new Blob([text], {
                type: "application/octet-stream"})));
  element.setAttribute('download', filename);

  element.style.display = 'none';
  document.body.appendChild(element);

  element.click();

  document.body.removeChild(element);
}