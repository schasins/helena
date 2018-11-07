'use strict'

/**********************************************************************
 * Guide the user through making a demonstration recording
 **********************************************************************/

// this inherits from HelenaUIBase
var RecorderUI = (function (pub) {
  pub.tabs = null;
  var ringerUseXpathFastMode = true;
  var demoMode = false;


  /**********************************************************************
   * We'll do a little setup and then we'll dig in on the real content
   **********************************************************************/

  function setUp(){

    // messages received by this component
    // utilities.listenForMessage("content", "mainpanel", "selectorAndListData", processSelectorAndListData);
    // utilities.listenForMessage("content", "mainpanel", "nextButtonData", processNextButtonData);
    // utilities.listenForMessage("content", "mainpanel", "moreItems", moreItems);
    utilities.listenForMessage("content", "mainpanel", "scrapedData", RecorderUI.processScrapedData);
    utilities.listenForMessage("content", "mainpanel", "requestCurrentRecordingWindows", RecorderUI.sendCurrentRecordingWindows);
    utilities.listenForMessage("background", "mainpanel", "runScheduledScript", RecorderUI.runScheduledScript);
    utilities.listenForMessage("background", "mainpanel", "pleasePrepareForRefresh", RecorderUI.prepareForPageRefresh);
    utilities.listenForMessage("content", "mainpanel", "requestRingerUseXpathFastMode",function(){utilities.sendMessage("mainpanel","content","ringerUseXpathFastMode", {use: ringerUseXpathFastMode});});
    
    // the UI needs to show keyboard shortcuts for scraping, so call the below so they show the right thing for the various OSs
    MiscUtilities.useCorrectScrapingConditionStrings("#scraping_instructions", "___SCRAPINGCONDITIONSTRING___", "___LINKSCRAPINGCONDITIONSTRING___"); // important to do this one first, what with everything going all stringy
    // handle user interactions with the mainpanel
    pub.setUpRecordingUI();

    $( document ).tooltip();

    // communicate to the HelenaBaseUI what we've called the elements we're using for blockly stuff
    pub.setBlocklyDivIds("new_script_content", "toolbox", "blockly_area", "blockly_div");

    // it's possible that we want to start right off by doing a recording, in which case let's start that here
    var urlString = window.location.href;
    var url = new URL(urlString);
    var startUrl = url.searchParams.get("starturl");
    RecorderUI.startRecording(startUrl);
  }

  $(setUp);

  /**********************************************************************
   * Now onto the functions we'll use for controlling the UI
   **********************************************************************/

  pub.setUpRecordingUI = function _setUpRecordingUI(){
    // we'll start on the first tab, our default, which gives user change to start a new recording
    var tabsDivs = $("#tabs");
    pub.tabs = tabsDivs.tabs();

    // if we switch to the second tab, we'll need to load in all the saved scripts
    $( "#tabs" ).on( "tabsbeforeactivate", function( event, ui ) {
      if (ui.newPanel.attr('id') === "tabs-2"){
        pub.loadSavedScripts();
      }
      if (ui.newPanel.attr('id') === "tabs-3"){
        pub.loadScheduledScripts();
      }
    });

    pub.showStartRecording();
  };

  pub.showStartRecording = function _showStartRecording(){
    var div = $("#new_script_content");
    DOMCreationUtilities.replaceContent(div, $("#about_to_record"));
    div.find("#start_recording").click(function(){RecorderUI.startRecording();});
  };

  var currentRecordingWindow = null;

  pub.startRecording = function _startRecording(specifiedUrl=undefined){
    console.log("startRecording", specifiedUrl);
    var div = $("#new_script_content");
    DOMCreationUtilities.replaceContent(div, $("#recording"));
    div.find("#stop_recording").click(RecorderUI.stopRecording);
    div.find("#cancel_recording").click(RecorderUI.cancelRecording);

    // if we already recorded one, there could be old stuff in here, so clear it out
    var $div = $("#scraped_items_preview");
    $div.html("");

    MiscUtilities.makeNewRecordReplayWindow(function(windowId){
      recordingWindowIds.push(windowId);
      currentRecordingWindow = windowId;
      SimpleRecord.startRecording();
    }, specifiedUrl);
  };

  pub.sendCurrentRecordingWindows = function _sendCurrentRecordingWindow(){
    utilities.sendMessage("mainpanel", "content", "currentRecordingWindows", {window_ids: recordingWindowIds}); // the tabs will check whether they're in the window that's actually recording to figure out what UI stuff to show
  }

  function activateButton(div, selector, handler){
    var button = div.find(selector);
    button.button();
    button.click(handler);
  }

  // I'm going to make these accessible from the outside for debuggning purposes
  pub.currentRingerTrace = null;
  pub.currentHelenaProgram = null;

  function setCurrentProgram(program, trace){
    pub.currentHelenaProgram = program;
    pub.currentRingerTrace = trace;
    pub.setBlocklyProgram(program);
  }

  pub.stopRecording = function _stopRecording(){
    var trace = SimpleRecord.stopRecording();
    var program = ReplayScript.ringerTraceToHelenaProgram(trace, currentRecordingWindow);
    if (program.statements.length < 1){
      // if we didn't actually see any statements worth replaying, let's assume they pressed stop before actually doing anything
      pub.cancelRecording();
      return;
    }
    setCurrentProgram(program, trace);

    // once we're done, remove the window id from the list of windows where we're allowed to record
    recordingWindowIds = _.without(recordingWindowIds, currentRecordingWindow);

    program.relevantRelations(); // now that we have a script, let's set some processing in motion that will figure out likely relations
    pub.showProgramPreview(true); // true because we're currently processing the script, stuff is in progress
  };

  pub.cancelRecording = function _cancelRecording(){
    SimpleRecord.stopRecording();
    // once we're done, remove the window id from the list of windows where we're allowed to record
    recordingWindowIds = _.without(recordingWindowIds, currentRecordingWindow);
    pub.showStartRecording();
  };

  pub.showProgramPreview = function _showProgramPreview(inProgress){
    WALconsole.log("showProgramPreview");
    if (inProgress === undefined){ inProgress = false; }
    var div = $("#new_script_content");
    DOMCreationUtilities.replaceContent(div, $("#script_preview")); // let's put in the script_preview node

    // I like it when the run button just says "Run Script" for demos
    // nice to have a reminder that it saves stuff if we're not in demo mode, but it's prettier with just run
    if (demoMode){
      div.find("#run").html("Run Script");
    }

    activateButton(div, "#run", RecorderUI.run);
    activateButton(div, "#run_fast_mode", RecorderUI.runWithFastMode);
    activateButton(div, "#save", RecorderUI.save);
    activateButton(div, "#replay", RecorderUI.replayOriginal);
    activateButton(div, "#schedule_later", RecorderUI.scheduleLater);
    activateButton(div, "#start_new", RecorderUI.startNewScript);
    activateButton(div, '#relation_upload', RecorderUI.uploadRelation);
    activateButton(div, '#relation_demonstration', RecorderUI.demonstrateRelation);

    // let's handle the collapsibles
    var tablesDiv = div.find("#relevant_tables_accordion");
    var additionalRunOptionsDiv = div.find("#extra_run_options_accordion");
    var troubleshootingDiv = div.find("#troubleshooting_accordion");
    var options = {collapsible: true, heightStyle: "content"};
    options.active = false;
    tablesDiv.accordion(options);
    additionalRunOptionsDiv.accordion(options);
    troubleshootingDiv.accordion({collapsible:true, active:false, heightStyle: "content"}); // always want all of these to start closed

    /*
    var troubleshootingDivs = $(".troubleshooting_option");
    for (var i = 0; i < troubleshootingDivs.length; i++){
      (function(){
        var d = $(troubleshootingDivs[i]);
        var controllingDiv = d.find(".troubleshooting_description");
        var childDiv = d.find(".troubleshooting_option_expansion");
        controllingDiv.click(function(){DOMCreationUtilities.toggleDisplay(childDiv);});  
      })();
    }
    */

    HelenaUIBase.setUpBlocklyEditor(false); // false bc no need to update the toolbox for our setup -- updateDisplayedScript below will do that anyway

    RecorderUI.updateDisplayedScript();
    RecorderUI.updateDisplayedRelations(inProgress);
  };

  function updateUIForRunFinished(dataset, timeScraped, runTabId){
        var div = $("#" + runTabId).find("#running_script_content");
        var done_note = div.find(".done_note");
        done_note.css("display", "inline-block");
        var still_saving_note = div.find(".still_saving_note");
        still_saving_note.css("display", "none");
        div.find("#pause").button("option", "disabled", true);
        div.find("#resume").button("option", "disabled", true);
        div.find("#cancelRun").button("option", "disabled", true);
  }

  pub.run = function _run(fastMode){
    if (fastMode === undefined){ fastMode = false;}
    // first set the correct fast mode, which means setting it to false if we haven't gotten true passed in
    // might still be on from last time

    // trying something new.  have running just always save the thing.  otherwise, it's so unpredictable
    RecorderUI.save(function(progId){
      // ok good, now we have a program id (already set in pub.currentHelenaProgram.id)
      ringerUseXpathFastMode = fastMode;
      // run whichever program is currently being displayed (so pub.currentHelenaProgram)
      pub.currentHelenaProgram.run({}, updateUIForRunFinished);
    });
  };

  pub.runWithFastMode = function _runWithFastMode(){
    // first turn on fast mode, run
    pub.run(true);
  };


  pub.runWithAndWithoutEntityScopes = function _runWithAndWithoutEntityScopes(){
    this.run();
    this.run({ignoreEntityScope:true});
  }

  var scriptRunCounter = 0;

  pub.newRunTab = function _newRunTab(runObject){
    // first let's make the new tab
    scriptRunCounter += 1;
    var tabDivId = 'runTab' + scriptRunCounter;
    var ul = pub.tabs.find( "ul" );
    $( "<li><a href='#" + tabDivId + "'>Script Run "+ scriptRunCounter + "</a></li>" ).appendTo( ul );
    $( "<div id='" + tabDivId + "'><div id='running_script_content'></div></div>" ).appendTo( pub.tabs );
    pub.tabs.tabs( "refresh" );
    pub.tabs.tabs( "option", "active", scriptRunCounter + 2 );

    // update the panel to show pause, resume buttons
    WALconsole.log("UI newRunTab");
    var div = $("#" + tabDivId).find("#running_script_content");
    DOMCreationUtilities.replaceContent(div, $("#script_running"));

    activateButton(div, "#pause", function(){RecorderUI.pauseRun(runObject);});
    activateButton(div, "#resume", function(){RecorderUI.resumeRun(runObject);});
    activateButton(div, "#restart", function(){RecorderUI.restartRun(runObject);});
    div.find("#resume").button("option", "disabled", true); // shouldn't be able to resume before we even pause

    activateButton(div, "#download", function(){runObject.dataset.downloadDataset();});
    activateButton(div, "#download_all", function(){runObject.dataset.downloadFullDataset();});

    var reset = function(){
      runObject.program.stopRunning(runObject);
      // todo: maybe have this close the tab or swap us back to the program preview
    }
    activateButton(div, "#cancelRun", reset);

    return tabDivId;
  };

  // for saving a program to the server
  pub.save = function _save(postIdRetrievalContinuation){
    var prog = pub.currentHelenaProgram;
    var div = $("#new_script_content");
    prog.name = div.find("#program_name").get(0).value;

    // ok, time to call the func that actually interacts with the server
    // saveToServer(progName, postIdRetrievalContinuation, saveStartedHandler, saveCompletedHandler)
    var saveStartedHandler = function(){
      // we've sent the save thing, so tell the user
      var status = div.find("#program_save_status");
      status.html("Saving...");
      status.css("display", "inline");
    };
    var saveCompletedHandler = function(){
      // we've finished the save thing, so tell the user
      var status = div.find("#program_save_status");
      status.html("Saved");
    };

    prog.saveToServer(postIdRetrievalContinuation, saveStartedHandler, saveCompletedHandler);
  };

  pub.replayOriginal = function _replayOriginal(){
    pub.currentHelenaProgram.replayOriginal();
  };

  pub.startNewScript = function _startNewScript(){
    setCurrentProgram(null, []);
    pub.resetForNewScript(); // clearing out a couple vars that have state from old prog or recording process
    pub.showStartRecording();
  }

  pub.pauseRun = function _pauseRun(runObject){
    WALconsole.log("Setting pause flag.");
    runObject.userPaused = true; // next runbasicblock call will handle saving a continuation
    var div = $("#" + runObject.tab).find("#running_script_content");
    div.find("#pause").button("option", "disabled", true); // can't pause while we're paused
    div.find("#resume").button("option", "disabled", false); // can now resume
  };

  pub.resumeRun = function _resumeRun(runObject){
    runObject.userPaused = false;
    var div = $("#" + runObject.tab).find("#running_script_content");
    div.find("#pause").button("option", "disabled", false);
    div.find("#resume").button("option", "disabled", true);
    runObject.resumeContinuation();
  };

  pub.restartRun = function _restartRun(runObject){
    WALconsole.log("Restarting.");
    var div = $("#" + runObject.tab).find("#running_script_content");
    //div.find("#pause").button("option", "disabled", false);
    div.find("#resume").button("option", "disabled", true);
    runObject.program.restartFromBeginning(runObject, updateUIForRunFinished);
  };

  pub.scheduleLater = function _scheduleLater(){
    WALconsole.log("going to schedule later runs.");
    var div = $("#new_script_content");
    DOMCreationUtilities.replaceContent(div, $("#schedule_a_run"));
    activateButton(div, "#schedule_a_run_done", function(){
      var scheduleText = div.find("#schedule").val();
      var schedule = later.parse.text(scheduleText);
      if (schedule.error !== -1){
        // drat, we couldn't parse it.  tell user
        div.find("#schedule_parse_failed").css("display", "inline-block");
        console.log(scheduleText, schedule);
      }
      else{
        // ok, everything is fine.  just save the thing
        var scheduledRecord = {schedule: scheduleText, progId: pub.currentHelenaProgram.id};
        chrome.storage.sync.get("scheduledRuns", function(obj) {
          if (!obj.scheduledRuns){
            obj.scheduledRuns = [];
          }
          obj.scheduledRuns.push(scheduledRecord);
          chrome.storage.sync.set(obj, function(){
            console.log("Saved the new scheduled run.");
            // and let's go back to our normal view of the program
            pub.showProgramPreview(false);
            // and let's tell the background script to retrieve all the schedules so it will actually run them
            utilities.sendMessage("mainpanel", "background", "scheduleScrapes", {});
          })
        });
      }
    });
  };

  pub.resetForNewScript = function resetForNewScript(){
    scraped = {};
    keys = [];
    HelenaUIBase.resetForNewScriptInternal();
  }

  // during recording, when user scrapes, show the text so user gets feedback on what's happening
  var scraped = {}; // dictionary based on xpath since we can get multiple DOM events that scrape same data from same node
  // todo: note that since we're indexing on xpath, if had same xpath on multiple different pages, this would fail to show us some data.  bad!
  // actually, I think this whole thing may be unnecessary.  we've just been adding in the same xpath to the xpaths list to control
  // how we display it anyway, so the indexing isn't really getting us anything, isn't eliminating anything, and we haven't had any trouble.
  // looks like an artifact of an old style.  todo: get rid of it when have a chance.
  var keys = []; // want to show texts in the right order
  pub.processScrapedData = function _processScrapedData(data){
    var xpath = data.xpath;
    var id = xpath + "_" + data.source_url;
    if (data.linkScraping){
      id += data.link;
      scraped[id] = data.link;
    }
    else{
      // just wanted to scrape text
      id += data.text;
      scraped[id] = data.text;
    }
    keys.push(id);
    var $div = $("#scraped_items_preview");
    $div.html("");
    for (var i = 0; i < keys.length; i++){
      $div.append($('<div class="first_row_elem">'+scraped[keys[i]]+'</div>'));
    }
  };

  pub.runScheduledScript = function _runScheduledScript(data){
    console.log("Running scheduled script", data);
    // let's let the background script know that we got its message
    utilities.sendMessage("mainpanel", "background", "runningScheduledScript", {});
    var progId = data.progId;
    pub.loadSavedProgram(progId, function(){
      // once it's loaded, go ahead and actually run it.
      pub.currentHelenaProgram.run({}, function(datasetObj, timeToScrape, tabId){
        // and for scheduled runs we're doing something that's currently a little wacky, where we trigger an IFTTT action when the scrape has run
        // todo: come up with a cleaner set up for this
        // this is the part that will send the email
        var ifttturl = "https://maker.ifttt.com/trigger/scheduled_scrape_completed/with/key/cBhUYy-EzpfmsfrJ9Bzs2p";
        var subject = "Scheduled Scrape Completed: " + pub.currentHelenaProgram.name;
        var url = datasetObj.downloadUrl();
        var fullurl = datasetObj.downloadFullDatasetUrl();
        var body = "dataset: " + datasetObj.getId() + "<br>dataset download url (most recent scrape output): <a href=" + url + ">" + url + "</a>" + "<br>full dataset download url (all scrape outputs): <a href=" + fullurl + ">" + fullurl + "</a><br>num rows:" + datasetObj.fullDatasetLength + "<br>time to scrape (milliseconds): " + timeToScrape;
        $.post(ifttturl, {value1: subject, value2: body});
        updateUIForRunFinished(datasetObj, timeToScrape, tabId);
      });
    });
  };

  pub.prepareForPageRefresh = function _prepareForPageRefresh(){
    // first we want to wrap up anything we might have been doing.  in particular, if we're scraping and we have some outstanding 
    // data, not yet backed up to the server, better send it to the server.  should we stop scraping also?

    for (var i = 0; i < currentRunObjects.length; i++){
      var runObject = currentRunObjects[i];
      pub.pauseRun(runObject); // we'll let that do its thing in the background
    }

    var actualReady = function(){
      // we want to let the background page know that we refreshed, in case it was the one that requested it
      utilities.sendMessage("mainpanel", "background", "readyToRefresh", {});
    };

    var i = 0;
    var processARunObject = function(){
      if (i >= currentRunObjects.length){
        // ok, we're done.  we've closed the datasets for all the current run objects
        actualReady();
      }
      else{
        // still more run objects to process
        var runObject = currentRunObjects[i];
        i += 1;
        runObject.dataset.closeDatasetWithCont(processARunObject);
      }
    }

    processARunObject();
  }

  function editSelector(relation){
    // show the UI for editing the selector
    // we need to open up the new tab that we'll use for showing and editing the relation, and we need to set up a listener to update the selector associated with this relation, based on changes the user makes over at the content script
    var bestLengthSoFar = 0;
    var heardAnswer = false;
    chrome.tabs.create({url: relation.url, active: true}, function(tab){
      RecorderUI.showRelationEditor(relation, tab.id);
      var sendSelectorInfo = function(){utilities.sendMessage("mainpanel", "content", "editRelation", relation.messageRelationRepresentation(), null, null, [tab.id]);};
      var sendSelectorInfoUntilAnswer = function(){
        $("#instructions_part_1").css("display", "none");
        $("#instructions_part_2").css("display", "block");
        if (heardAnswer){return;}
        sendSelectorInfo(); 
        setTimeout(sendSelectorInfoUntilAnswer, 1000);
      }
      var div = $("#new_script_content");
      var button = $("#page_looks_right");
      button.button();
      button.click(sendSelectorInfoUntilAnswer);
    });
    // now we've sent over the current selector info.  let's set up the listener that will update the preview (and the object)
    utilities.listenForMessageWithKey("content", "mainpanel", "editRelation", "editRelation", 
    function(msg){
      heardAnswer = true;
      if (msg.demonstration_time_relation.length >= bestLengthSoFar){
        bestLengthSoFar = msg.demonstration_time_relation.length;
        if (bestLengthSoFar > 0){
          relation.setNewAttributes(msg.selector, msg.selector_version, msg.exclude_first, msg.columns, msg.demonstration_time_relation, msg.num_rows_in_demo, msg.next_type, msg.next_button_selector);
          RecorderUI.updateDisplayedRelation(relation, msg.colors);
          RecorderUI.setColumnColors(msg.colors, msg.columns, msg.tab_id);
        }
        else{
          // still need to give the user the option to add a new column, even if we have no selector so far
          RecorderUI.setColumnColors([], [], msg.tab_id);
        }
      }
    }); // remember this will overwrite previous editRelation listeners, since we're providing a key
  }

  function replaceRelation(relation){
    // show the UI for replacing the selector, which will basically be the same as the one we use for uploading a text relation in the first place
    WALconsole.log("going to upload a replacement relation.");
    var div = $("#new_script_content");
    DOMCreationUtilities.replaceContent(div, $("#upload_relation"));
    $('#upload_data').on("change", pub.handleNewUploadedRelation); // and let's actually process changes
    activateButton(div, "#upload_done", function(){if (currentUploadRelation !== null){ relation.setRelationContents(currentUploadRelation.getRelationContents());} RecorderUI.showProgramPreview(); currentUploadRelation = null;}); // ok, we're actually using this relation
    activateButton(div, "#upload_cancel", function(){RecorderUI.showProgramPreview; currentUploadRelation = null;}); // don't really need to do anything here
  }


  var currentSkipper = null;
  pub.handleFunctionForSkippingToNextPageOfRelationFinding = function(skipToNextPageFunc){
    currentSkipper = skipToNextPageFunc;
  };

  pub.handleRelationFindingPageUpdate = function(pageCurrentlyBeingSearched){
    var $overlaytext = $("#overlay").find("#overlay_text");
    var $currentPage = $overlaytext.find("#overlay_text_current_page");
    if ($currentPage.length > 0){
      $currentPage[0].html(pageCurrentlyBeingSearched);
    }
    else{
      $overlaytext.append($("<div>Currently looking for relations on page <span id='overlay_text_current_page'>"+pageCurrentlyBeingSearched+"</span>.</div>"));
    }
  }

  pub.updateDisplayedRelations = function _updateDisplayedRelations(currentlyUpdating){
    WALconsole.log("updateDisplayedRelation");
    if (currentlyUpdating === undefined){ currentlyUpdating = false; }

    var relationObjects = pub.currentHelenaProgram.relations;
    var $div = $("#new_script_content").find("#status_message");
    $div.html("");
    var $overlay = $("#overlay");
    var $overlaytext = $overlay.find("#overlay_text");
    if (currentlyUpdating){
      $overlaytext.html("<center><img src='../icons/ajax-loader.gif'><br>Looking at webpages to find relevant tables.  Give us a moment.<br></center>");
      
      if (!demoMode){
        var giveUpButton = $("<button>Give up looking for relevant tables.</button>");
        giveUpButton.button();
        giveUpButton.click(function(){
          pub.currentHelenaProgram.insertLoops(true); // if user thinks we won't have relations, go ahead and do prog processing (making loopyStatements) without them
          // and let's prevent future guessed relations from messing us up
          pub.currentHelenaProgram.forbidAutomaticLoopInsertion();
        });
        $overlaytext.append(giveUpButton);

        var giveUpButton2 = $("<button>Give up ON THIS CURRENT PAGE (and continue to next page).</button>");
        giveUpButton2.button();
        giveUpButton2.click(function(){
          currentSkipper(); // this gets updated by handleFunctionForSkippingToNextPageOfRelationFinding above
        });
        $overlaytext.append(giveUpButton2);
      }

      $overlay.css("display", "inline");
    }
    else{
      $overlay.css("display", "none");
    }

    $div = $("#new_script_content").find("#relations");
    $div.html("");
    if (relationObjects.length === 0 && !currentlyUpdating){
      $div.html("No relevant tables found.  Sorry!");  
      return;
    }
    for (var i = 0; i < relationObjects.length; i++){
      WALconsole.log("updateDisplayedRelations table");
      var $relDiv = $("<div class=relation_preview></div>");
      $div.append($relDiv);
      (function updateDisplayedRelation(){ // closure to save the relation object
        var relation = relationObjects[i];
        var textRelation = relation.demonstrationTimeRelationText();
        if (textRelation.length > 2){
          textRelation = textRelation.slice(0,3);
          textRelation.push(_.map(Array.apply(null, Array(textRelation[0].length)), function(){return "...";}));
        }
        var table = DOMCreationUtilities.arrayOfArraysToTable(textRelation);

        var columns = relation.columns;
        var tr = $("<tr></tr>");
        for (var j = 0; j < columns.length; j++){
          (function(){
            var closJ = j;
            
            var columnTitle = $("<input></input>");
            columnTitle.val(columns[j].name);
            columnTitle.change(function(){relation.setColumnName(columns[closJ], columnTitle.val()); RecorderUI.updateDisplayedScript();});

            var td = $("<td></td>");
            td.append(columnTitle);
            tr.append(td);
          })();
        }
        table.prepend(tr);
        var relationTitle = $("<input></input>");
        relationTitle.val(relation.name);
        relationTitle.change(function(){relation.name = relationTitle.val(); RecorderUI.updateDisplayedScript();});
        $relDiv.append(relationTitle);
        $relDiv.append(table);

        var saveRelationButton = $("<button>Save These Table and Column Names</button>");
        saveRelationButton.button();
        saveRelationButton.click(function(){relation.saveToServer();});
        $relDiv.append(saveRelationButton);

        var editRelationButton = $("<button>Edit This Table</button>");
        editRelationButton.button();
        editRelationButton.click(function(){editSelector(relation);});
        $relDiv.append(editRelationButton);

        var removeRelationButton = $("<button>This Table Is Not Relevant</button>");
        removeRelationButton.button();
        removeRelationButton.click(function(){pub.currentHelenaProgram.removeRelation(relation);});
        $relDiv.append(removeRelationButton);
        WALconsole.log("Done with updateDisplayedRelations table");

        if (relation instanceof WebAutomationLanguage.TextRelation){
          var replaceRelationButton = $("<button>Replace This Uploaded Table</button>");
          replaceRelationButton.button();
          replaceRelationButton.click(function(){replaceRelation(relation);});
          $relDiv.append(replaceRelationButton);
        }
      })();
    }

    pub.updateDuplicateDetection(); // if the relation gets updated, the preview for the duplicate detection should change
  };

  pub.showRelationEditor = function _showRelationEditor(relation, tabId){
    var div = $("#new_script_content");
    DOMCreationUtilities.replaceContent(div, $("#relation_editing"));

    // let's highlight the appropriate next_type
    var currNextType = relation.nextType;
    var checkedNode = div.find("#next_type_"+currNextType); // remember we have to keep the NextTypes (in utilities) in line with the ids in the mainpanel html
    checkedNode.attr("checked", true);
    var radioButtons = div.find('#next_type input[type=radio]');
    for (var i = 0; i < radioButtons.length; i++){
      radioButtons[i].name = radioButtons[i].name+"_current"; // name must be different from the name of other buttonsets, and since we've copied from elsewhere on the page, we need to change this
    }
    var nextTypeButtonset = div.find("#next_type").buttonset();
    radioButtons.change(function(){
      relation.nextType = parseInt(this.value);
      if (relation.nextType === NextTypes.NEXTBUTTON || relation.nextType === NextTypes.MOREBUTTON){
        // ok, we need the user to actually show us the button
        var buttonType = "next";
        if (relation.nextType === NextTypes.MOREBUTTON){ buttonType = "more";}
        var expl = div.find("#next_type_explanation");
        expl.html("Please click on the '"+buttonType+"' button now.");

        utilities.listenForMessageOnce("content", "mainpanel", "nextButtonSelector", function(data){
          relation.nextButtonSelector = data.selector;
          expl.html("");
        });
        utilities.sendMessage("mainpanel", "content", "nextButtonSelector", null, null, null, [tabId]);
      }
      else{
        utilities.sendMessage("mainpanel", "content", "clearNextButtonSelector", null, null, null, [tabId]);
      }
    });

    // ready button
    var readyButton = div.find("#relation_editing_ready");
    readyButton.button();

    readyButton.click(function(){
      // once ready button clicked, we'll already have updated the relation selector info based on messages the content panel has been sending, so we can just go back to looking at the program preview

      // one exception -- if this was a whole new relation, it won't be in there
      // so then we'll need to add it
      console.log("relation", relation);
      var rels = pub.currentHelenaProgram.relations;
      if (rels.indexOf(relation) < 0){
        pub.currentHelenaProgram.relations.push(relation);
      }
      
      // one thing we do need to change is there may now be nodes included in the relation (or excluded) that weren't before, so we should redo loop insertion
      pub.currentHelenaProgram.insertLoops(false);

      RecorderUI.showProgramPreview();
      // we also want to close the tab...
      console.log("showRelationEditor removing tab", tabId);
      chrome.tabs.remove(tabId);
      // todo: maybe we also want to automatically save changes to server?  something to consider.  not yet sure
    });
  };

  pub.updateDisplayedRelation = function _updateDisplayedRelation(relationObj, colors){
    WALconsole.log("updateDisplayedRelation");
    var $relDiv = $("#new_script_content").find("#output_preview");
    $relDiv.html("");

    var textRelation = relationObj.demonstrationTimeRelationText();
    var table = DOMCreationUtilities.arrayOfArraysToTable(textRelation);

    var columns = relationObj.columns;
    var tr = $("<tr></tr>");
    for (var j = 0; j < columns.length; j++){
      (function(){
        var xpath = columns[j].xpath;
        var colorStyle = "style='background-color:" + colors[j] + ";'"
        var columnTitle = $("<input class='edit-relation-table-header-cell' " + colorStyle + " ></input>");
        columnTitle.val(columns[j].name);
        var closJ = j;
        columnTitle.change(function(){WALconsole.log(columnTitle.val(), xpath); relationObj.setColumnName(columns[closJ], columnTitle.val()); RecorderUI.updateDisplayedScript();});
        var td = $("<td></td>");
        td.append(columnTitle);
        tr.append(td);
      })();
    }
    table.prepend(tr);

    var relationTitle = $("<input></input>");
    relationTitle.val(relationObj.name);
    relationTitle.change(function(){relationObj.name = relationTitle.val(); RecorderUI.updateDisplayedScript();});
    $relDiv.append(relationTitle);
    $relDiv.append(table);
  };

  pub.setColumnColors = function _setColumnColors(colorLs, columnLs, tabid){
    var $div = $("#new_script_content").find("#color_selector");
    $div.html("Select the right color for the cell you want to add:   ").css("border", "2px solid transparent");
    for (var i = 0; i < columnLs.length; i++){
      var colorDiv = $("<div class='edit-relation-color-block' style='background-color:"+colorLs[i]+";border:2px solid transparent'></div>");
      (function(){
        var col = columnLs[i].index;
        colorDiv.click(function(event){
          var target = $(event.target);
          var siblings = $(target).parent().children();
          for (var i = 0; i < siblings.length; i++) {
            $(siblings[i]).css("border", "2px solid transparent");
            $(siblings[i]).css("outline", "none");
          }
          $(target).css("border", "2px solid red");
          utilities.sendMessage("mainpanel", "content", "currentColumnIndex", {index: col}, null, null, [tabid]);
        });
      })();
      $div.append(colorDiv);
    }
    // todo: now going to allow folks to make a new column, but also need to communicate with content script about color to show
    var separatorDiv = $("<div class='edit-relation-color-block'>or</div>").css("border", "2px solid transparent");
    var colorDiv = $("<div class='edit-relation-color-block' id='edit-relation-new-col-button' style='border:2px solid transparent'>New Col</div>");
    (function(){
      // maria here, new col button click
      colorDiv.click(function(event){
        utilities.sendMessage("mainpanel", "content", "currentColumnIndex", {index: "newCol"}, null, null, [tabid]);
        var target = $(event.target);
        var siblings = $(target).parent().children();
        for (var i = 0; i < siblings.length; i++) {
          $(siblings[i]).css("border", "2px solid transparent");
        }
        $(target).css("outline", "2px solid red");
      });
    })();
    $div.append(separatorDiv);
    $div.append(colorDiv);
  };

  pub.updateDisplayedScript = function _updateDisplayedScript(updateBlockly){
    if (updateBlockly === undefined){ updateBlockly = true; }
    WALconsole.log("updateDisplayedScript");
    var program = pub.currentHelenaProgram;
    var scriptPreviewDiv = $("#new_script_content").find("#program_representation");
    if (true){ // should probably stop keeping this text version at all todo
      scriptPreviewDiv.remove();
    }
    else {
      var scriptString = program.toString();
      DOMCreationUtilities.replaceContent(scriptPreviewDiv, $("<div>"+scriptString+"</div>")); // let's put the script string in the script_preview node
    }

  // our mutation observer in the Helena base UI should now take care of this?
  /*
    // sometimes prog preview and stuff will have changed size, changing the shape of the div to which blockly should conform, so run the adjustment func
    pub.blocklyReadjustFunc();
    // unfortunately the data urls used for node 'snapshots' don't show up right away
    // when they don't, blockly thinks it can be higher up in the page than it should be, because the images load and extend the top div
    
    var imgs = scriptPreviewDiv.find("img");
    for (var i = 0; i < imgs.length; i++){
      var img = imgs[i];
      img.onload = function(){
        pub.blocklyReadjustFunc(); 
      }
    }
    */
    
    
    if (updateBlockly){
      pub.displayBlockly(program);
      // the below is really not the place for this...but oh well
      var editingOff = false;
      var editingOffMessage = "Program editing is turned off for this study!  (We're evaluating programming by demonstration, not editing.)  If your current program doesn't give the results you want, try the 'Start New Script' button above.";
      if (editingOff){
       $("#blockly_overlay").css("display", "block");
       $("#blockly_overlay").html(editingOffMessage);
      }
    }

    // we also want to update the section that lets the user say what loop iterations are duplicates
    // used for data in relations get shuffled during scraping and for recovering from failures. also incremental scraping.
    pub.updateDuplicateDetection();
    // we also want to make sure the user can tell us which features are required for each node that we find using similarity approach
    pub.updateNodeRequiredFeaturesUI();
    // same deal with custom thresholds
    pub.updateCustomThresholds();

    if (program.name){
      $("#new_script_content").find("#program_name").get(0).value = program.name;
    }
  };

  pub.updateDuplicateDetection = function _updateDuplicateDetection(){
    WALconsole.log("updateDuplicateDetection");
    var duplicateDetectionData = pub.currentHelenaProgram.getDuplicateDetectionData();

    var $div = $("#new_script_content").find("#duplicates_container_content");
    $div.html("");
    for (var i = 0; i < duplicateDetectionData.length; i++){
      (function(){
        var oneLoopData = duplicateDetectionData[i];
        var loopStatement = oneLoopData.loopStatement;
        var table = DOMCreationUtilities.arrayOfArraysToTable(oneLoopData.displayData);
        var nodeVariables = oneLoopData.nodeVariables;
        var tr = $("<tr></tr>");
        var annotationItems = [];
        var availableAnnotationItems = [];
        for (var j = 0; j < nodeVariables.length; j++){
          
            var attributes = ["TEXT", "LINK"];
            for (var k = 0; k < attributes.length; k++){
              (function(){
                var nodeVariable = nodeVariables[j];
                var attr = attributes[k];
                var element = {nodeVar: nodeVariable, attr: attr};
                availableAnnotationItems.push(element);
                var atributeRequired = $("<input type='checkbox'>");
                atributeRequired.change(function(){
                  console.log("toggling attribute required for", nodeVariable, attr);
                  if (atributeRequired.prop("checked")){
                    annotationItems.push(element);
                  }
                  else{
                    // can't just use without bc element won't be exactly the same as the other object, so use findWhere to find the first element with the same properties
                    annotationItems = _.without(annotationItems, _.findWhere(annotationItems, element));
                  }
                  console.log("annotationItems", annotationItems)});

                var td = $("<td></td>");
                td.append(atributeRequired);
                tr.append(td);
              })();
            }
        }
        table.prepend(tr);
        var tds = table.find("td");
        for (var k = 0; k < tds.length; k++){
          var td = tds[k];
          $(td).css("max-width", "200px");
          $(td).css("word-wrap", "break-word");
        }
        $div.append(table);

        var addAnnotationButton = $("<div>Add Annotation</div>");
        addAnnotationButton.button();
        addAnnotationButton.click(function(){loopStatement.addAnnotation(annotationItems, availableAnnotationItems, pub.currentHelenaProgram);});
        $div.append(addAnnotationButton);
      })();
    }
  };

  var highlyHumanReadable = {"textContent": 12, "preceding-text": 10, "previousElementSiblingText": 10, "firstWord": 10, "firstTwoWords": 10, "firstThreeWords": 10, "preColonText": 11, "lastWord": 10, "possibleHeading": 10, "id": 9, "tagName": 9, "className": 9, "xpath": 8, "background-color": 7, "background-image": 7};

  function sortProps(props, alreadyChosen){
    var rankedProps = {}
    for (var prop in props){
      if (alreadyChosen.indexOf(prop) > -1){
        rankedProps[prop] = 20;
      }
      else if (prop in highlyHumanReadable){
        rankedProps[prop] = highlyHumanReadable[prop];
      }
      else if (prop.startsWith("child")){
        rankedProps[prop] = 6;
      }
      else if (prop.startsWith("lastChild")){
        rankedProps[prop] = 5;
      }
      else{
        rankedProps[prop] = 0;
      }
    }
    var propsSorted = Object.keys(rankedProps).sort(function(a,b){return rankedProps[b] - rankedProps[a]});
    return propsSorted;
  }

  pub.updateCustomThresholds = function _updateCustomThresholds(){
    console.log("updateCustomThresholds");
    var prog = pub.currentHelenaProgram; // program.relationFindingTimeoutThreshold and program.nextButtonAttemptsThreshold

    var defaultSeconds = DefaultHelenaValues.relationFindingTimeoutThreshold / 1000;
    var defaultTries = DefaultHelenaValues.nextButtonAttemptsThreshold;
    console.log(defaultSeconds, defaultTries);

    // first let's update the description text to include the correct defaults
    var $div = $("#new_script_content").find("#thresholds_container");
    $div.find(".defaultRelationTimeout").html(defaultSeconds);
    $div.find(".defaultRetriesTotal").html(defaultTries);
    $div.find(".defaultRetries").html(defaultTries - 1);

    // now let's update the text boxes to refelct the current program's custom thresholds, if they have any
    // and put the correct defaults in the input boxes otherwise
    var secondsInput = $div.find("#relationGiveUpThreshold")[0];
    var triesInput = $div.find("#nextButtonRetries")[0];

    function setWithSavedValueIfAvailable(inputNode, savedValue, defaultValue){
      if (savedValue){ 
        inputNode.value = savedValue;
      }
      else {
        inputNode.value = defaultValue;
      }
    }
    setWithSavedValueIfAvailable(secondsInput, prog.relationFindingTimeoutThreshold / 1000, defaultSeconds);
    setWithSavedValueIfAvailable(triesInput, prog.nextButtonAttemptsThreshold - 1, defaultTries - 1)

    // ok, now what if the user changes the text in the text box?
    function attachHandlerToUpdateProgValBasedOnNewInput(isint, node, prog, progAttribute, defaultVal, transformInputToSaved, transformSavedToInput){
      if (!node.hasHandler){
        $(node).change(function(){
          var newVal = node.value;
          if (isint){
            newVal = parseInt(newVal);
          }
          else{
            newVal = parseFloat(newVal);
          }
          if (newVal === 0 || (newVal && newVal > 0)){ // special case 0 because if (0) is false
            prog[progAttribute] = transformInputToSaved(newVal);
            // in case we rounded, update what the input shows
            node.value = newVal;
          }
          else{
            // ugh, why'd you put in something we can't parse.  set it back to something reasonable
            setWithSavedValueIfAvailable(node, transformSavedToInput(prog[progAttribute]), defaultVal);
          }
        });
        node.hasHandler = true;
      }
    }

    attachHandlerToUpdateProgValBasedOnNewInput(false, secondsInput, prog, "relationFindingTimeoutThreshold", defaultSeconds, 
      function(a){return a * 1000;}, function(a){return a / 1000;});

    attachHandlerToUpdateProgValBasedOnNewInput(true, triesInput, prog, "nextButtonAttemptsThreshold", defaultTries - 1, 
      function(a){return a + 1;}, function(a){return a - 1;});
  };

  pub.updateNodeRequiredFeaturesUI = function _updateNodeRequiredFeaturesUI(){
    WALconsole.log("updateNodeRequiredFeaturesUI");
    var similarityNodes = pub.currentHelenaProgram.getNodesFoundWithSimilarity();

    var $div = $("#new_script_content").find("#require_features_container_content");

    if (similarityNodes.length > 0){
      $div.html("");
      for (var i = 0; i < similarityNodes.length; i++){
        (function(){
          var nodeVar = similarityNodes[i];
          var nodeDiv = $("<div class='require_features_node_item'><div class='node_name'>"+nodeVar.toString()+"</div></div>");
          var showNodeFeatures = function(){
            var priorFeaturesDiv = nodeDiv.find(".node_features_container");
            if (priorFeaturesDiv.length > 0){
              priorFeaturesDiv.remove();
            }
            var featuresDiv = $("<div class='node_features_container'></div>");
            var snapshot = nodeVar.recordTimeSnapshot();
            var requiredFeatures = nodeVar.getRequiredFeatures();
            var sortedProps = sortProps(snapshot, requiredFeatures)
            for (var j = 0; j < sortedProps.length; j++){
              var p = sortedProps[j];
              (function(){
                var prop = p;
                var val = snapshot[prop];
                if (val && val.length && val.length > 200){
                  val = val.slice(0,50)+"..."+val.slice(val.length - 50, val.length);
                }
                else if (val === ""){
                  val = "EMPTY";
                }
                else if (!val){
                  val = String(val);
                }
                var featureDiv = $("<div class='node_feature'><span class='node_prop'>"+prop+"</span> must be <span class='node_prop_val'>"+val+"</span></div>");
                if (requiredFeatures.indexOf(prop) > -1){
                  featureDiv.addClass('node_feature_selected');
                }
                else{
                  featureDiv.addClass('node_feature_unselected');
                }
                featureDiv.click(function(){
                  if (requiredFeatures.indexOf(prop) > -1){
                    // if it's currently required, stop requiring it
                    nodeVar.unrequireFeature(prop);
                  }
                  else{
                    // if it's currently not required, start requiring it
                    nodeVar.requireFeature(prop);
                  }
                  // in either case, once the feature node is clicked, have to re-display the feature data for the whole node
                  showNodeFeatures();
                });
                featuresDiv.append(featureDiv);
              })();
            }
            nodeDiv.append(featuresDiv);
          };
          $(nodeDiv.find(".node_name")[0]).click(function(){
            // toggle whether we're showing
            var priorFeaturesDiv = nodeDiv.find(".node_features_container");
            if (priorFeaturesDiv.length > 0){
              priorFeaturesDiv.remove();
            }
            else{
              showNodeFeatures();
            }
          });
          $div.append(nodeDiv);
        })();
      }
    }
    else{
      $div.html("All of this script's cells come from tables.  If you're not happy with the table cells, you might try using the `Edit This Table' buttons above.");
    }

  };

  pub.addNewRowToOutput = function _addNewRowToOutput(runTabId, listOfCellTexts){
    var div = $("#" + runTabId).find("#running_script_content").find("#output_preview").find("table").find("tbody");
    var l = div.children().length;
    var limit = 100;
    if (l === limit){
      if ($("#" + runTabId).find("#running_script_content").find("#output_preview").find("#data_too_big").length === 0){
        $("#" + runTabId).find("#running_script_content").find("#output_preview").append($("<div id='data_too_big'>This dataset is too big for us to display.  The preview here shows the first "+limit+" rows.  To see the whole dataset, just click the download button above.</div>"));  
      }
    }
    else if (l < limit){
      WALconsole.log("adding output row: ", l);
      div.append(DOMCreationUtilities.arrayOfTextsToTableRow(listOfCellTexts));
    }
    $("#" + runTabId).find("#running_script_content").find("#output_explanation").hide();
  };

  var currentUploadRelation = null;
  pub.uploadRelation = function _uploadRelation(){
    WALconsole.log("going to upload a relation.");
    var div = $("#new_script_content");
    DOMCreationUtilities.replaceContent(div, $("#upload_relation"));
    $('#upload_data').on("change", pub.handleNewUploadedRelation); // and let's actually process changes
    activateButton(div, "#upload_done", function(){if (currentUploadRelation !== null){ pub.currentHelenaProgram.tryAddingRelation(currentUploadRelation);} RecorderUI.showProgramPreview();}); // ok, we're actually using this relation.  the program better get parameterized
    activateButton(div, "#upload_cancel", RecorderUI.showProgramPreview); // don't really need to do anything here
  };

  pub.demonstrateRelation = function _demonstrateRelation(){
    // for now we'll just assume we want to introduce a new relation on first page.  in future fix.  todo: fix
    WALconsole.log("going to demo a relaiton.");
    var newRelation = new WebAutomationLanguage.Relation();
    newRelation.pageVarName = pub.currentHelenaProgram.statements[0].outputPageVar.name; //fix!
    newRelation.url = pub.currentHelenaProgram.statements[0].url; // fix!
    editSelector(newRelation);
  }

  pub.handleNewUploadedRelation = function _handleNewUploadedRelation(event){
    WALconsole.log("New list uploaded.");
    var fileReader = new FileReader();
    fileReader.onload = function (event) {
      var str = event.target.result;
      // ok, we have the file contents.  let's display them
      currentUploadRelation = new WebAutomationLanguage.TextRelation(str);
      var csvData = currentUploadRelation.relation;
      var sampleData = csvData;
      if (sampleData.length > 100) {
        var sampleData = csvData.slice(0,100); // only going to show a sample
        sampleData.push(new Array(csvData[0].length).fill("...")); // to indicate to user that it's a sample
      }
      var tableElement = DOMCreationUtilities.arrayOfArraysToTable(sampleData);
      $("#upload_data_table").append(tableElement);
    }
    // now that we know how to handle reading data, let's actually read some
    fileReader.readAsText(event.target.files[0]);
  }

  pub.addDialog = function _addDialog(title, dialogText, buttonTextToHandlers){
    var dialogDiv = $("#dialog");
    var dialogDiv2 = dialogDiv.clone();
    dialogDiv2.attr("title", title);
    dialogDiv2.html(dialogText);
    $("#new_script_content").append(dialogDiv2);
    var buttons = [];
    for (var buttonText in buttonTextToHandlers){
      (function(){
        var bt = buttonText;
        buttons.push({text: bt, click: function(){dialogDiv2.remove(); buttonTextToHandlers[bt]();}});
      })(); // closure to save buttonText, attach correct handler
    }
    dialogDiv2.dialog({
      dialogClass: "no-close",
      buttons: buttons,
      closeOnEscape: false // user shouldn't be able to close except by using one of our handlers
    }).prev(".ui-dialog-titlebar").css("background","#F9A7AE");;
    return dialogDiv2;
  };

  pub.continueAfterDialogue = function _continueAfterDialogue(text, continueButtonText, continueButtonContinuation){
    var handlers = {};
    handlers[continueButtonText] = continueButtonContinuation;
    var dialog = pub.addDialog("Continue?", text, handlers);
    // todo: also add the option to pause?  which would do the normal user pause interaction?
    return dialog;
  };

  pub.loadSavedScripts = function _loadSavedScripts(){
    WALconsole.log("going to load saved scripts.");
    var savedScriptsDiv = $("#saved_script_list");
    var handler = function(response){
      WALconsole.log(response);
      var arrayOfArrays = _.map(response, function(prog){
        var date = $.format.date(prog.date * 1000, "dd/MM/yyyy HH:mm")
        return [prog.name, date];});
      var html = DOMCreationUtilities.arrayOfArraysToTable(arrayOfArrays);
      var trs = html.find("tr");
      for (var i = 0; i < trs.length; i++){
        (function(){
          var cI = i;
          WALconsole.log("adding handler", trs[i], response[i].id)
          $(trs[i]).click(function(){
            WALconsole.log(cI);
            var id = response[cI].id;
            pub.loadSavedProgram(id);
          });
          $(trs[i]).addClass("hoverable");
        })();
      }
      savedScriptsDiv.html(html);
    }
    HelenaServerInteractions.loadSavedPrograms(handler);
  };

  pub.loadScheduledScripts = function _loadScheduledScripts(){
    chrome.storage.sync.get("scheduledRuns", function(obj) {
      var scriptsDiv = $("#scheduled_runs_list");
      if (!obj.scheduledRuns){
        // none to show
        scriptsDiv.html("No runs scheduled now.");
        return;
      }
      // ok, looks like we have a few to show
      scriptsDiv.html("");
      for (var i = 0; i < obj.scheduledRuns.length; i++){
        (function(){
          var run = obj.scheduledRuns[i];
          var newNode = $("<div class='scheduled_script_run'>" + run.progId + "</br>" + run.schedule + "</div>");
          var removeButton = $("<span class='ui-icon ui-icon-closethick'></span>")
          removeButton.click(function(){
            // if we click, want to remove it from the saved chrome.storage, then reshow the scheduled scripts
            obj.scheduledRuns = _.without(obj.scheduledRuns, run);
            chrome.storage.sync.set(obj, function(){
              console.log("Saved the new unscheduled run.");
              // and let's tell the background script to retrieve all the schedules so it will update the ones it's keeping track of
              utilities.sendMessage("mainpanel", "background", "scheduleScrapes", {});
            })
            pub.loadScheduledScripts();
          });
          newNode.append(removeButton);
          scriptsDiv.append(newNode);
        })();
      }
      /*
      chrome.storage.sync.set(obj, function(){
        console.log("Saved the new scheduled run.");
        // and let's go back to our normal view of the program
        pub.showProgramPreview(false);
        // and let's tell the background script to retrieve all the schedules so it will actually run them
        utilities.sendMessage("mainpanel", "background", "scheduleScrapes", {});
      })
      */
    });
  };

  pub.loadSavedDataset = function _loadSavedDataset(datasetId){
    WALconsole.log("loading dataset: ", datasetId);
    var handler = function(progId){
      pub.loadSavedProgram(progId);
    }
    HelenaServerInteractions.loadSavedDataset(datasetId, handler);
  };

  pub.loadSavedProgram = function _loadSavedProgram(progId, continuation){
    WALconsole.log("loading program: ", progId);
    var handler = function(response){
      WALconsole.log("received program: ", response);
      var revivedProgram = ServerTranslationUtilities.unJSONifyProgram(response.program.serialized_program);
      revivedProgram.id = response.program.id; // if id was only assigned when it was saved, serialized_prog might not have that info yet
      revivedProgram.name = response.program.name;
      setCurrentProgram(revivedProgram, null);
      $("#tabs").tabs("option", "active", 0); // make that first tab (the program running tab) active again
      pub.showProgramPreview(false); // false because we're not currently processing the program (as in, finding relations, something like that)
      if (continuation){
        continuation();
      }
    }
    HelenaServerInteractions.loadSavedProgram(progId, handler);
  };

  pub.updateRowsSoFar = function _updateRowsSoFar(runTabId, num){
    var div = $("#" + runTabId).find("#running_script_content");
    div.find("#rows_so_far").html(num);
  };

  return pub;
}(HelenaUIBase));

// the RecorderUI is the UI object that will show Helena programs, so certain edits to the programs
// are allowed to call UI hooks that make the UI respond to program changes
WebAutomationLanguage.setUIObject(RecorderUI);
