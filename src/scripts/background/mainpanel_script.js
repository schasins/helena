function setUp(){

  //messages received by this component
  //utilities.listenForMessage("content", "mainpanel", "selectorAndListData", processSelectorAndListData);
  //utilities.listenForMessage("content", "mainpanel", "nextButtonData", processNextButtonData);
  //utilities.listenForMessage("content", "mainpanel", "moreItems", moreItems);
  utilities.listenForMessage("content", "mainpanel", "scrapedData", RecorderUI.processScrapedData);
  utilities.listenForMessage("content", "mainpanel", "requestCurrentRecordingWindows", RecorderUI.sendCurrentRecordingWindows);
  utilities.listenForMessage("background", "mainpanel", "runScheduledScript", RecorderUI.runScheduledScript);
  

  MiscUtilities.useCorrectScrapingConditionStrings("#scraping_instructions", "___SCRAPINGCONDITIONSTRING___", "___LINKSCRAPINGCONDITIONSTRING___"); // important to do this one first, what with everything going all stringy
  //handle user interactions with the mainpanel
  //$("button").button(); 
  //$( "#tabs" ).tabs();
  RecorderUI.setUpRecordingUI();

  // control blockly look and feel
  Blockly.HSV_SATURATION = 0.7;
  Blockly.HSV_VALUE = 0.97;
}

$(setUp);

var workspace = null;
var blocklyLabels = [];
var blocklyReadjustFunc = null;
var recordingWindowIds = [];
var scrapingRunsCompleted = 0;
var datasetsScraped = [];

/**********************************************************************
 * Guide the user through making a demonstration recording
 **********************************************************************/

var RecorderUI = (function () {
  var pub = {};

  pub.tabs = null;

  pub.setUpRecordingUI = function _setUpRecordingUI(){
    // we'll start on the first tab, our default, which gives user change to start a new recording
    pub.tabs = $( "#tabs" ).tabs();

    var div = $("#new_script_content");
    DOMCreationUtilities.replaceContent(div, $("#about_to_record"));
    div.find("#start_recording").click(RecorderUI.startRecording);
    // if we switch to the second tab, we'll need to load in all the saved scripts
    $( "#tabs" ).on( "tabsbeforeactivate", function( event, ui ) {
      if (ui.newPanel.attr('id') === "tabs-2"){
        pub.loadSavedScripts();
      }
    });
  };

  var currentRecordingWindow = null;

  pub.startRecording = function _startRecording(){
    var div = $("#new_script_content");
    DOMCreationUtilities.replaceContent(div, $("#recording"));
    div.find("#stop_recording").click(RecorderUI.stopRecording);

    MiscUtilities.makeNewRecordReplayWindow(function(windowId){
      recordingWindowIds.push(windowId);
      currentRecordingWindow = windowId;
      SimpleRecord.startRecording();
    });
  };

  pub.sendCurrentRecordingWindows = function _sendCurrentRecordingWindow(){
    utilities.sendMessage("mainpanel", "content", "currentRecordingWindows", {window_ids: recordingWindowIds}); // the tabs will check whether they're in the window that's actually recording to figure out what UI stuff to show
  }

  function activateButton(div, selector, handler){
    var button = div.find(selector);
    button.button();
    button.click(handler);
  }

  pub.stopRecording = function _stopRecording(){
    var trace = SimpleRecord.stopRecording();
    var program = ReplayScript.setCurrentTrace(trace, currentRecordingWindow);

    // once we're done, remove the window id from the list of windows where we're allowed to record
    recordingWindowIds = _.without(recordingWindowIds, currentRecordingWindow);

    program.relevantRelations(); // now that we have a script, let's set some processing in motion that will figure out likely relations
    pub.showProgramPreview(true); // true because we're currently processing the script, stuff is in progress
  };

  pub.updateBlocklyToolbox = function _updateBlocklyToolbox(){
    WALconsole.log("updateBlocklyToolbox");
    // before we can use the toolbox, we have to actually have all the relevant blocks
    ReplayScript.prog.updateBlocklyBlocks();

    // first make a toolbox with all the block nodes we want
    var $toolboxDiv = $("#new_script_content").find("#toolbox");
    if (!$toolboxDiv.length > 0){
      // we must not be currently showing the blockly preview.  we'll get around to doing this stuff once we do switch to that view
      return;
    }
    $toolboxDiv.html("");
    for (var i = 0; i < blocklyLabels.length; i++){
      $toolboxDiv.append($("<block type=\"" + blocklyLabels[i] + "\"></block>"));
    }
  }

  function handleBlocklyEditorResizing(){
    WALconsole.log("handleBlocklyEditorResizing");
    var $toolboxDiv = $("#new_script_content").find("#toolbox");
    // handle the actual editor resizing
    var blocklyArea = document.getElementById('blockly_area');
    var blocklyDiv = document.getElementById('blockly_div');
    workspace = Blockly.inject('blockly_div', {toolbox: $toolboxDiv.get(0)});
    pub.updateBlocklyToolbox();
    var onresize = function(e) {
      // compute the absolute coordinates and dimensions of blocklyArea.
      var element = blocklyArea;
      var x = 0;
      var y = 0;
      do {
        x += element.offsetLeft;
        y += element.offsetTop;
        element = element.offsetParent;
      } while (element);
      // Position blocklyDiv over blocklyArea.
      blocklyDiv.style.left = x + 'px';
      blocklyDiv.style.top = y + 'px';
      blocklyDiv.style.width = blocklyArea.offsetWidth + 'px';
      blocklyDiv.style.height = blocklyArea.offsetHeight + 'px';
    };
    window.addEventListener('resize', onresize, false);
    onresize();
    Blockly.svgResize(workspace);
    return onresize;
  };

  pub.showProgramPreview = function _showProgramPreview(inProgress){
    WALconsole.log("showProgramPreview");
    if (inProgress === undefined){ inProgress = false; }
    var div = $("#new_script_content");
    DOMCreationUtilities.replaceContent(div, $("#script_preview")); // let's put in the script_preview node
    activateButton(div, "#run", RecorderUI.run);
    activateButton(div, "#save", RecorderUI.save);
    activateButton(div, "#replay", RecorderUI.replayOriginal);
    activateButton(div, "#schedule_later", RecorderUI.scheduleLater);
    activateButton(div, '#relation_upload', RecorderUI.uploadRelation);
    activateButton(div, '#relation_demonstration', RecorderUI.demonstrateRelation);

    var troubleshootingDivs = $(".troubleshooting_option");
    for (var i = 0; i < troubleshootingDivs.length; i++){
      (function(){
        var d = $(troubleshootingDivs[i]);
        var controllingDiv = d.find(".troubleshooting_description");
        var childDiv = d.find(".troubleshooting_option_expansion");
        controllingDiv.click(function(){DOMCreationUtilities.toggleDisplay(childDiv);});  
      })();
    }

    blocklyReadjustFunc = handleBlocklyEditorResizing();

    RecorderUI.updateDisplayedScript();
    RecorderUI.updateDisplayedRelations(inProgress);
  };

  pub.run = function _run(){
    // run whichever program is currently being displayed (so ReplayScript.prog)
    ReplayScript.prog.run({});
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

    var reset = function(){
      runObject.program.stopRunning(runObject);
      // todo: maybe have this close the tab or swap us back to the program preview
    }
    activateButton(div, "#cancelRun", reset);

    return tabDivId;
  };

  // for saving a program to the server
  pub.save = function _save(continuation){
    var prog = ReplayScript.prog;
    var div = $("#new_script_content");
    var name = div.find("#program_name").get(0).value;
    prog.name = name;
    var relationObjsSerialized = _.map(
      _.filter(prog.relations, function(rel){return rel instanceof WebAutomationLanguage.Relation;}), // todo: in future, don't filter.  actually save textrelations too
      ServerTranslationUtilities.JSONifyRelation);
    var serializedProg = ServerTranslationUtilities.JSONifyProgram(prog);
    var msg = {id: prog.id, serialized_program: serializedProg, relation_objects: relationObjsSerialized, name: name};
    $.post('http://kaofang.cs.berkeley.edu:8080/saveprogram', msg, function(response){
      var progId = response.program.id;
      prog.id = progId;
      if (continuation && _.isFunction(continuation)){
        continuation(progId);
      }
    });
  };

  pub.replayOriginal = function _replayOriginal(){
    ReplayScript.prog.replayOriginal();
  };

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
    div.find("#pause").button("option", "disabled", false);
    div.find("#resume").button("option", "disabled", true);
    runObject.program.restartFromBeginning(runObject);
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
        var scheduledRecord = {schedule: scheduleText, progId: ReplayScript.prog.id};
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

  // during recording, when user scrapes, show the text so user gets feedback on what's happening
  var scraped = {}; // dictionary based on xpath since we can get multiple DOM events that scrape same data from same node
  // todo: note that since we're indexing on xpath, if had same xpath on multiple different pages, this would fail to show us some data.  bad!
  // actually, I think this whole thing may be unnecessary.  we've just been adding in the same xpath to the xpaths list to control
  // how we display it anyway, so the indexing isn't really getting us anything, isn't eliminating anything, and we haven't had any trouble.
  // looks like an artifact of an old style.  todo: get rid of it when have a chance.
  var xpaths = []; // want to show texts in the right order
  pub.processScrapedData = function _processScrapedData(data){
    var xpath = data.xpath;
    var id = "";
    if (data.linkScraping){
      id = xpath+"_link"; 
      scraped[id] = data.link;
    }
    else{
      // just wanted to scrape text
      id = xpath+"_text";
      scraped[id] = data.text;
    }
    xpaths.push(id);
    $div = $("#scraped_items_preview");
    $div.html("");
    for (var i = 0; i < xpaths.length; i++){
      $div.append($('<div class="first_row_elem">'+scraped[xpaths[i]]+'</div>'));
    }
  };

  pub.runScheduledScript = function _runScheduledScript(data){
    console.log("Running scheduled script", data);
    var progId = data.progId;
    pub.loadSavedProgram(progId, function(){
      // once it's loaded, go ahead and actually run it.
      ReplayScript.prog.run({}, function(datasetObj, timeToScrape){
        // and for scheduled runs we're doing something that's currently a little wacky, where we trigger an IFTTT action when the scrape has run
        // todo: come up with a cleaner set up for this
        var ifttturl = "https://maker.ifttt.com/trigger/scheduled_scrape_completed/with/key/cBhUYy-EzpfmsfrJ9Bzs2p";
        var subject = "Scheduled Scrape Completed: " + ReplayScript.prog.name;
        var url = datasetObj.downloadUrl();
        var body = "dataset: " + datasetObj.id + "<br>dataset download url: <a href=" + url + ">" + url + "</a><br>num rows: " + datasetObj.fullDatasetLength + "<br>time to scrape (milliseconds): " + timeToScrape;
        $.post(ifttturl, {value1: subject, value2: body});
      });
    });
  };

  pub.updateDisplayedRelations = function _updateDisplayedRelations(currentlyUpdating){
    WALconsole.log("updateDisplayedRelation");
    if (currentlyUpdating === undefined){ currentlyUpdating = false; }

    var relationObjects = ReplayScript.prog.relations;
    $div = $("#new_script_content").find("#status_message");
    $div.html("");
    if (currentlyUpdating){
      $div.html("Looking at webpages to find relevant tables.  Give us a moment.<br><center><img src='../icons/ajax-loader.gif'></center>");
      var giveUpButton = $("<button>Give up looking for relevant tables.</button>");
      giveUpButton.button();
      giveUpButton.click(function(){
        ReplayScript.prog.insertLoops(); // if user thinks we won't have relations, go ahead and do prog processing (making loopyStatements) without them
      });
      $div.append(giveUpButton);
    }
    else{
      $div.html("");
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
            
            var columnScraped = $("<input type='checkbox'>");
            columnScraped.prop( "checked", relation.isColumnUsed(columns[j]));
            columnScraped.change(function(){relation.toggleColumnUsed(columns[closJ]); RecorderUI.updateDisplayedScript();});

            var td = $("<td></td>");
            td.append(columnTitle);
            td.append(columnScraped);
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
        editRelationButton.click(function(){relation.editSelector();});
        $relDiv.append(editRelationButton);
        var removeRelationButton = $("<button>This Table Is Not Relevant</button>");
        removeRelationButton.button();
        removeRelationButton.click(function(){ReplayScript.prog.removeRelation(relation);});
        $relDiv.append(removeRelationButton);
        WALconsole.log("Done with updateDisplayedRelations table");
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
      // the one thing we do need to change is there may now be nodes included in the relation (or excluded) that weren't before, so we should redo loop insertion
      ReplayScript.prog.insertLoops();

      RecorderUI.showProgramPreview();
      // we also want to close the tab...
      console.log("showRelationEditor removing tab", tabId);
      chrome.tabs.remove(tabId);
      // todo: maybe we also want to automatically save changes to server?  something to consider.  not yet sure
    });
  };

  pub.updateDisplayedRelation = function _updateDisplayedRelation(relationObj){
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
        var columnTitle = $("<input></input>");
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
    $div.html("Select the right color for the cell you want to add:   ");
    // for now we'll only have boxes for existing colors, since don't currently support adding additional columns
    // but eventually should offer user opportunity to select the next unused color, intro a new col.  todo
    for (var i = 0; i < columnLs.length; i++){
      var colorDiv = $("<div style='width: 20px; height:20px; display:inline-block; background-color:"+colorLs[i]+"'></div>");
      (function(){
        var col = columnLs[i].index;
        colorDiv.click(function(){utilities.sendMessage("mainpanel", "content", "currentColumnIndex", {index: col}, null, null, [tabid]);});
      })();
      $div.append(colorDiv);
    }
  };

  pub.updateDisplayedScript = function _updateDisplayedScript(updateBlockly){
    if (updateBlockly === undefined){ updateBlockly = true; }
    WALconsole.log("updateDisplayedScript");
    var program = ReplayScript.prog;
    var scriptString = program.toString();
    var scriptPreviewDiv = $("#new_script_content").find("#program_representation");
    DOMCreationUtilities.replaceContent(scriptPreviewDiv, $("<div>"+scriptString+"</div>")); // let's put the script string in the script_preview node

    // sometimes prog preview and stuff will have changed size, changing the shape of the div to which blockly should conform, so run the adjustment func
    blocklyReadjustFunc();
    // unfortunately the data urls used for node 'snapshots' don't show up right away
    // when they don't, blockly thinks it can be higher up in the page than it should be, because the images load and extend the top div
    var imgs = scriptPreviewDiv.find("img");
    for (var i = 0; i < imgs.length; i++){
      var img = imgs[i];
      img.onload = function(){
        blocklyReadjustFunc(); 
      }
    }
    
    if (updateBlockly){
      // first make sure we have all the up to date blocks.  for instance, if we have relations available, we'll add loops to toolbox
      pub.updateBlocklyToolbox();
      program.displayBlockly();
    }

    // we also want to update the section that lets the user say what loop iterations are duplicates
    // used for data in relations get shuffled during scraping and for recovering from failures. also incremental scraping.
    pub.updateDuplicateDetection();
    // we also want to make sure the user can tell us which features are required for each node that we find using similarity approach
    pub.updateNodeRequiredFeaturesUI();

    if (program.name){
      $("#new_script_content").find("#program_name").get(0).value = program.name;
    }
  };

  pub.updateDuplicateDetection = function _updateDuplicateDetection(){
    WALconsole.log("updateDuplicateDetection");
    var duplicateDetectionData = ReplayScript.prog.getDuplicateDetectionData();

    $div = $("#new_script_content").find("#duplicates_container_content");
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
        $div.append(table);

        var addAnnotationButton = $("<div>Add Annotation</div>");
        addAnnotationButton.button();
        addAnnotationButton.click(function(){loopStatement.addAnnotation(annotationItems, availableAnnotationItems);});
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

  pub.updateNodeRequiredFeaturesUI = function _updateNodeRequiredFeaturesUI(){
    WALconsole.log("updateNodeRequiredFeaturesUI");
    var similarityNodes = ReplayScript.prog.getNodesFoundWithSimilarity();

    $div = $("#new_script_content").find("#require_features_container_content");

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
  };

  var currentUploadRelation = null;
  pub.uploadRelation = function _uploadRelation(){
    WALconsole.log("going to upload a relation.");
    var div = $("#new_script_content");
    DOMCreationUtilities.replaceContent(div, $("#upload_relation"));
    $('#upload_data').on("change", pub.handleNewUploadedRelation); // and let's actually process changes
    activateButton(div, "#upload_done", function(){if (currentUploadRelation !== null){ ReplayScript.prog.tryAddingRelation(currentUploadRelation);} RecorderUI.showProgramPreview();}); // ok, we're actually using this relation.  the program better get parameterized
    activateButton(div, "#upload_cancel", RecorderUI.showProgramPreview); // don't really need to do anything here
  };

  pub.demonstrateRelation = function _demonstrateRelation(){
    // for now we'll just assume we want to introduce a new relation on first page.  in future fix.  todo: fix
    WALconsole.log("going to demo a relaiton.");
    var targetUrl = ReplayScript.prog.statements[0].url; // fix!
    var newRelation = new WebAutomationLanguage.Relation();
    newRelation.url = targetUrl;
    newRelation.editSelector();
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
    for (buttonText in buttonTextToHandlers){
      (function(){
        var bt = buttonText;
        buttons.push({text: bt, click: function(){dialogDiv2.remove(); buttonTextToHandlers[bt]();}});
      })(); // closure to save buttonText, attach correct handler
    }
    dialogDiv2.dialog({
      dialogClass: "no-close",
      buttons: buttons,
      closeOnEscape: false // user shouldn't be able to close except by using one of our handlers
    });
  };

  pub.loadSavedScripts = function _loadSavedScripts(){
    WALconsole.log("going to load saved scripts.");
    var savedScriptsDiv = $("#saved_script_list");
    $.get('http://kaofang.cs.berkeley.edu:8080/programs/', {}, function(response){
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
    });
  };

  pub.loadSavedDataset = function _loadSavedDataset(datasetId){
    WALconsole.log("loading dataset: ", datasetId);
    console.log('http://kaofang.cs.berkeley.edu:8080/programfordataset/'+datasetId);
    $.get('http://kaofang.cs.berkeley.edu:8080/programfordataset/'+datasetId, {}, function(response){
      var progId = response.program_id;
      pub.loadSavedProgram(progId);
    });
  };

  pub.loadSavedProgram = function _loadSavedProgram(progId, continuation){
    WALconsole.log("loading program: ", progId);
    $.get('http://kaofang.cs.berkeley.edu:8080/programs/'+progId, {}, function(response){
      var revivedProgram = ServerTranslationUtilities.unJSONifyProgram(response.program.serialized_program);
      revivedProgram.id = response.program.id; // if id was only assigned when it was saved, serialized_prog might not have that info yet
      revivedProgram.name = response.program.name;
      ReplayScript.prog = revivedProgram;
      $("#tabs").tabs("option", "active", 0); // make that first tab (the program running tab) active again
      pub.showProgramPreview(false); // false because we're not currently processing the program (as in, finding relations, something like that)
      if (continuation){
        continuation();
      }
    });
  };

  pub.updateRowsSoFar = function _updateRowsSoFar(runTabId, num){
    var div = $("#" + runTabId).find("#running_script_content");
    div.find("#rows_so_far").html(num);
  };

  return pub;
}());

/**********************************************************************
 * Hiding the modifications to the internals of Ringer event objects
 **********************************************************************/

var EventM = (function _EventM() {
  var pub = {};

  pub.prepareForDisplay = function _prepareForDisplay(ev){
    if (!ev.additionalDataTmp){ // this is where this tool chooses to store temporary data that we'll actually clear out before sending it back to r+r
      ev.additionalDataTmp = {};
    } 
    ev.additionalDataTmp.display = {};
  };

  pub.getLoadURL = function _getLoadURL(ev){
    return ev.data.url;
  };

  pub.getDOMURL = function _getDOMURL(ev){
    return ev.frame.topURL;
  };

  pub.getDOMPort = function _getDOMPort(ev){
    return ev.frame.port;
  }

  pub.getVisible = function _getVisible(ev){
    return ev.additionalDataTmp.display.visible;
  };
  pub.setVisible = function _setVisible(ev, val){
    ev.additionalDataTmp.display.visible = val;
  };

  pub.getLoadOutputPageVar = function _getLoadOutputPageVar(ev){
    return ev.additionalDataTmp.display.pageVarId;
  };
  pub.setLoadOutputPageVar = function _setLoadOutputPageVar(ev, val){
    ev.additionalDataTmp.display.pageVarId = val;
  };

  pub.getDOMInputPageVar = function _getDOMInputPageVar(ev){
    return ev.additionalDataTmp.display.inputPageVar;
  };
  pub.setDOMInputPageVar = function _setDOMInputPageVar(ev, val){
    ev.additionalDataTmp.display.inputPageVar = val;
  };

  pub.getDOMOutputLoadEvents = function _getDOMOutputLoadEvents(ev){
    if (ev.type !== "dom") {return false;}
    return ev.additionalDataTmp.display.causesLoads;
  };
  pub.setDOMOutputLoadEvents = function _setDOMOutputLoadEvents(ev, val){
    if (ev.type !== "dom") {return false;}
    ev.additionalDataTmp.display.causesLoads = val;
  };
  pub.addDOMOutputLoadEvent = function _addDOMOutputLoadEvent(ev, val){
    ev.additionalDataTmp.display.causesLoads.push(val);
  };

  pub.getLoadCausedBy = function _getLoadCausedBy(ev){
    return ev.additionalDataTmp.display.causedBy;
  };
  pub.setLoadCausedBy = function _setLoadCausedBy(ev, val){
    ev.additionalDataTmp.display.causedBy = val;
  };

  pub.getDisplayInfo = function _getDisplayInfo(ev){
    return ev.additionalDataTmp.display;
  }
  pub.clearDisplayInfo = function _clearDisplayInfo(ev){
    delete ev.additionalDataTmp.display;
  }
  pub.setDisplayInfo = function _setDisplayInfo(ev, displayInfo){
    ev.additionalDataTmp.display = displayInfo;
  }

  pub.setTemporaryStatementIdentifier = function _setTemporaryStatementIdentifier(ev, id){
    if (!ev.additional){
      // not a dom event, can't copy this stuff around
      return null;
    }
    ev.additional.___additionalData___.temporaryStatementIdentifier = id; // this is where the r+r layer lets us store data that will actually be copied over to the new events (for dom events);  recall that it's somewhat unreliable because of cascading events; sufficient for us because cascading events will appear in the same statement, so can have same statement id, but be careful
  }
  pub.getTemporaryStatementIdentifier = function _getTemporaryStatementIdentifier(ev){
    if (!ev.additional){
      // not a dom event, can't copy this stuff around
      return null;
    }
    return ev.additional.___additionalData___.temporaryStatementIdentifier;
  }

  return pub;
}());

/**********************************************************************
 * Manipulations of whole scripts
 **********************************************************************/

var ReplayScript = (function _ReplayScript() {
  var pub = {};

  pub.trace = null;
  pub.prog = null;

  // controls the sequence of transformations we do when we get a trace

  pub.setCurrentTrace = function _setCurrentTrace(trace, windowId){
    WALconsole.log(trace);
    trace = processTrace(trace, windowId);
    trace = prepareForDisplay(trace);
    trace = markUnnecessaryLoads(trace);
    trace = associateNecessaryLoadsWithIDsAndParameterizePages(trace);
    trace = addCausalLinks(trace);
    trace = removeEventsBeforeFirstVisibleLoad(trace);
    pub.trace = trace;

    segmentedTrace = segment(trace);
    var prog = segmentedTraceToProgram(segmentedTrace);
    pub.prog = prog;
    return prog;
  }

  // functions for each transformation

  function processTrace(trace, windowId){
    WALconsole.log(trace);
    trace = sanitizeTrace(trace);
    WALconsole.log(trace);
    WALconsole.log(trace.length);
    trace = windowFilter(trace, windowId);
    WALconsole.log(trace);
    WALconsole.log(trace.length);
    return trace;
  }

  // strip out events that weren't performed in the window we created for recording
  function windowFilter(trace, windowId){
    return _.filter(trace, function(event){return (event.data && event.data.windowId === windowId) || (event.frame && event.frame.windowId === windowId);});
  }

  // strip out the 'stopped' events
  function sanitizeTrace(trace){
    return _.filter(trace, function(obj){return obj.state !== "stopped";});
  }

  function prepareForDisplay(trace){
    _.each(trace, function(ev){EventM.prepareForDisplay(ev);});
    return trace;
  }

  // user doesn't need to see load events for loads that load URLs whose associated DOM trees the user never actually uses
  function markUnnecessaryLoads(trace){
    var domEvents =  _.filter(trace, function(ev){return ev.type === "dom";});
    var domEventURLs = _.unique(_.map(domEvents, function(ev){return EventM.getDOMURL(ev);}));
    _.each(trace, function(ev){if (ev.type === "completed" && domEventURLs.indexOf(EventM.getLoadURL(ev)) > -1){ EventM.setVisible(ev, true);}});
    return trace;
  }

  function associateNecessaryLoadsWithIDsAndParameterizePages(trace){
    var idCounter = 1; // blockly says not to count from 0

    // ok, unfortunately urls (our keys for frametopagevarid) aren't sufficient to distinguish all the different pagevariables, because sometimes pages load a new top-level/main_frame page without actually changing the url
    // so we'll need to actually keep track of the ports as well.  any ports that appear with the target url before the creation of the next page var with the same url, we'll use those for the first page var, and so on

    var urlsToMostRecentPageVar = {};
    var portsToPageVars = {};
    for (var i = 0; i < trace.length; i++){
      var ev = trace[i];
      if (ev.type === "completed" && EventM.getVisible(ev)){ 
        var url = EventM.getLoadURL(ev);
        var p = new WebAutomationLanguage.PageVariable("p"+idCounter, url);
        EventM.setLoadOutputPageVar(ev, p);
        urlsToMostRecentPageVar[url] = p;
        idCounter += 1;
      }
      else if (ev.type === "dom"){
        var port = EventM.getDOMPort(ev);
        var pageVar = null;
        if (port in portsToPageVars){
          pageVar = portsToPageVars[port];
        }
        else{
          // ok, have to look it up by url
          var url = EventM.getDOMURL(ev);
          pageVar = urlsToMostRecentPageVar[url];
          // from now on we'll associate this port with this pagevar, even if another pagevar later becomes associated with the url
          portsToPageVars[port] = pageVar;
        }
        EventM.setDOMInputPageVar(ev, pageVar); 
        p.setRecordTimeFrameData(ev.frame);
      }
    }
    return trace;
  }

  function addCausalLinks(trace){
    lastDOMEvent = null;
    _.each(trace, function(ev){
      if (ev.type === "dom"){
        lastDOMEvent = ev;
        EventM.setDOMOutputLoadEvents(ev, []);
      }
      else if (lastDOMEvent !== null && ev.type === "completed" && EventM.getVisible(ev)) {
        EventM.setLoadCausedBy(ev, lastDOMEvent);
        EventM.addDOMOutputLoadEvent(lastDOMEvent, ev);
        // now that we have a cause for the load event, we can make it invisible
        EventM.setVisible(ev, false);
      }
    });
    return trace;
  }

  function removeEventsBeforeFirstVisibleLoad(trace){
    for (var i = 0; i < trace.length; i++){
      var ev = trace[i];
      if (EventM.getVisible(ev)){
        // we've found the first visible event
        return trace.slice(i, trace.length);
      }
    }
  }

  // helper function.  returns whether two events should be allowed in the same statement, based on visibility, statement type, statement page, statement target
  function allowedInSameSegment(e1, e2){
    // if either of them is null (as when we do not yet have a current visible event), anything goes
    if (e1 === null || e2 === null){
      return true;
    }
    var e1type = WebAutomationLanguage.statementType(e1);
    var e2type = WebAutomationLanguage.statementType(e2);
    //WALconsole.log("allowedInSameSegment", e1type, e2type);
    // if either is invisible, can be together, because an invisible event allowed anywhere
    if (e1type === null || e2type === null){
      return true;
    }
    // now we know they're both visible
    // visible load events aren't allowed to share with any other visible events
    if (e1.type === "completed" || e2.type === "completed"){
      return false;
    }
    // now we know they're both visible and both dom events
    // if they're both visible, but have the same type and called on the same node, they're allowed together
    if (e1type === e2type){
      var e1page = EventM.getDOMInputPageVar(e1);
      var e2page = EventM.getDOMInputPageVar(e2);
      if (e1page === e2page){
        var e1node = e1.target.xpath;
        var e2node = e2.target.xpath;
        if (e1node === e2node){
          return true;
        }
        // we also have a special case where keyup events allowed in text, but text not allowed in keyup
        // this is because text segments that start with keyups get a special treatment, since those are the ctrl, alt, shift type cases
        if (e1node === StatementTypes.KEYBOARD && e2node === StatementTypes.KEYUP){
          return true;
        }
      }
    }
    return false;
  }

  function postSegmentationInvisibilityDetectionAndMerging(segments){
    // noticed that we see cases of users doing stray keypresses while over non-targets (as when about to scrape, must hold keys), then get confused when there are screenshots of whole page (or other node) in the control panel
    // so this merging isn't essential or especially foundational, but this detects the cases that are usually just keypresses that won't be parameterized or changed, and it can make the experience less confusing for users if we don't show them
    var outputSegments = [];
    for (var i = 0; i < segments.length; i++){
      var segment = segments[i];
      var merge = false;
      if (WebAutomationLanguage.statementType(segment[0]) === StatementTypes.KEYBOARD){
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

  function segment(trace){
    var allSegments = [];
    var currentSegment = [];
    var currentSegmentVisibleEvent = null; // an event that should be shown to the user and thus determines the type of the statement
    _.each(trace, function(ev){
      if (allowedInSameSegment(currentSegmentVisibleEvent, ev)){
        if (WebAutomationLanguage.statementType(ev) !== null){
          WALconsole.log("stype(ev)", ev, WebAutomationLanguage.statementType(ev), currentSegmentVisibleEvent);
        }
        currentSegment.push(ev);
        if (currentSegmentVisibleEvent === null && WebAutomationLanguage.statementType(ev) !== null ){ // only relevant to first segment
          currentSegmentVisibleEvent = ev;
        }
      }
      else{
        // the current event isn't allowed in last segment -- maybe it's on a new node or a new type of action.  need a new segment
        WALconsole.log("making a new segment", currentSegmentVisibleEvent, ev, currentSegment, currentSegment.length);
        allSegments.push(currentSegment);
        currentSegment = [ev];
        currentSegmentVisibleEvent = ev; // if this were an invisible event, we wouldn't have needed to start a new block, so it's always ok to put this in for the current segment's visible event
      }});
    allSegments.push(currentSegment); // put in that last segment
    // allSegments = postSegmentationInvisibilityDetectionAndMerging(allSegments); // for now rather than this func, we'll try an alternative where we just show ctrl, alt, shift keypresses in a simpler way
    WALconsole.log("allSegments", allSegments, allSegments.length);
    return allSegments;
  }

  function segmentedTraceToProgram(segmentedTrace){
    var statements = [];
    _.each(segmentedTrace, function(seg){
      sType = null;
      for (var i = 0; i < seg.length; i++){
        var ev = seg[i];
        var st = WebAutomationLanguage.statementType(ev);
        if (st !== null){
          sType = st;
          if (sType === StatementTypes.LOAD){
            statements.push(new WebAutomationLanguage.LoadStatement(seg));
          }
          else if (sType === StatementTypes.MOUSE){
            statements.push(new WebAutomationLanguage.ClickStatement(seg));
          }
          else if (sType === StatementTypes.SCRAPE || sType === StatementTypes.SCRAPELINK){
            statements.push(new WebAutomationLanguage.ScrapeStatement(seg));
          }
          else if (sType === StatementTypes.KEYBOARD || sType === StatementTypes.KEYUP){
            statements.push(new WebAutomationLanguage.TypeStatement(seg));
          }
          break;
        }
      }
    });
    return new WebAutomationLanguage.Program(statements);
  }

  return pub;
}());

/**********************************************************************
 * Our high-level automation language
 **********************************************************************/

var StatementTypes = {
  MOUSE: 1,
  KEYBOARD: 2,
  LOAD: 3,
  SCRAPE: 4,
  SCRAPELINK: 5,
  KEYUP: 6
};

var WebAutomationLanguage = (function _WebAutomationLanguage() {
  var pub = {};

  var statementToEventMapping = {
    mouse: ['click','dblclick','mousedown','mousemove','mouseout','mouseover','mouseup'],
    keyboard: ['keydown','keyup','keypress','textinput','paste','input']
  };

  // helper function.  returns the StatementType (see above) that we should associate with the argument event, or null if the event is invisible
  pub.statementType = function _statementType(ev){
    if (ev.type === "completed"){
      if (!EventM.getVisible(ev)){
        return null; // invisible, so we don't care where this goes
      }
      return StatementTypes.LOAD;
    }
    else if (ev.type === "dom"){
      if (statementToEventMapping.mouse.indexOf(ev.data.type) > -1){
        if (ev.additional.scrape){
          if (ev.additional.scrape.linkScraping){
            return StatementTypes.SCRAPELINK;
          }
          return StatementTypes.SCRAPE;
        }
        return StatementTypes.MOUSE;
      }
      else if (statementToEventMapping.keyboard.indexOf(ev.data.type) > -1){
        /*
        if (ev.data.type === "keyup"){
          return StatementTypes.KEYUP;
        }
        */
        //if ([16, 17, 18].indexOf(ev.data.keyCode) > -1){
        //  // this is just shift, ctrl, or alt key.  don't need to show these to the user
        //  return null;
        //}
        return StatementTypes.KEYBOARD;
      }
    }
    return null; // these events don't matter to the user, so we don't care where this goes
  }

  function firstVisibleEvent(trace){
    for (var i = 0; i < trace.length; i++){
      var ev = trace[i];
      var st = WebAutomationLanguage.statementType(ev);
      if (st !== null){
        return ev;
      }
    }
  }

  // helper functions that some statements will use

  function makePageVarsDropdown(pageVars){
    var pageVarsDropDown = [];
    for (var i = 0; i < pageVars.length; i++){
      var pageVarStr = pageVars[i].toString();
      pageVarsDropDown.push([pageVarStr, pageVarStr]);
    }
    return pageVarsDropDown;
  }

  function makeRelationsDropdown(relations){
    var relationsDropDown = [];
    for (var i = 0; i < relations.length; i++){
      var relationStr = relations[i].name;
      relationsDropDown.push([relationStr, relationStr]);
    }
    return relationsDropDown;
  }

  function nodeRepresentation(statement, linkScraping){
    if (linkScraping === undefined){ linkScraping = false; }
    if (statement.currentNode instanceof WebAutomationLanguage.NodeVariable){
      var alreadyBound = statement.currentNode.getSource() === NodeSources.RELATIONEXTRACTOR; // todo: this isn't really correct.  we could reuse a node scraped or clicked before, and then it would be bound already.  fix this.
      var nodeRep = statement.currentNode.toString(alreadyBound, statement.pageVar);
      if (linkScraping){
        nodeRep += ".link";
      }
      return nodeRep;
    }
    if (statement.trace[0].additional.visualization === "whole page"){
      return "whole page";
    }
    if (linkScraping){
      return statement.trace[0].additional.scrape.link; // we don't have a better way to visualize links than just giving text
    }
    return "<img src='"+statement.trace[0].additional.visualization+"' style='max-height: 150px; max-width: 350px;'>";
  }

  function makeNodeVariableForTrace(trace){
    var recordTimeNode = null;
    var recordTimeNodeSnapshot = null;
    var imgData = null;
    if (trace.length > 0){ // may get 0-length trace if we're just adding a scrape statement by editing (as for a known column in a relation)
      var i = 0; // 0 bc this is the first ev that prompted us to turn it into the given statement, so must use the right node
      recordTimeNode = trace[i].additional.scrape;
      recordTimeNodeSnapshot = trace[i].target.snapshot;
      imgData = trace[i].additional.visualization;
    }
    return new WebAutomationLanguage.NodeVariable(null, recordTimeNode, recordTimeNodeSnapshot, imgData, NodeSources.RINGER); // null bc no preferred name
  }

  function outputPagesRepresentation(statement){
    var prefix = "";
    if (statement.outputPageVars.length > 0){
      prefix = _.map(statement.outputPageVars, function(pv){return pv.toString();}).join(", ")+" = ";
    }
    return prefix;
  }

  // returns true if we successfully parameterize this node with this relation, false if we can't
  function parameterizeNodeWithRelation(statement, relation, pageVar){
      // note: may be tempting to use the columns' xpath attributes to decide this, but this is not ok!  now that we can have
      // mutliple suffixes associated with a column, that xpath is not always correct
      // but we're in luck because we know the selector has just been applied to the relevant page (to produce relation.demonstrationTimeRelation and from that relation.firstRowXpaths)
      // so we can learn from those attributes which xpaths are relevant right now, and thus which ones the user would have produced in the current demo
      
      // if the relation is a text relation, we actually don't want to do the below, because it doesn't represent nodes, only texts
      if (relation instanceof WebAutomationLanguage.TextRelation){
        return null;
      }

      // hey, this better be in the same order as relation.columns and relation.firstRowXpaths!
      // todo: maybe add some helper functions to get rid of this necessity? since it may not be clear in there...
      var nodeRepresentations = relation.firstRowNodeRepresentations();

      for (var i = 0; i < relation.firstRowXPaths.length; i++){
        var firstRowXpath = relation.firstRowXPaths[i];
        if (firstRowXpath === statement.origNode){
          statement.relation = relation;
          var name = relation.columns[i].name;
          var nodeRep = nodeRepresentations[i];
          statement.currentNode = new WebAutomationLanguage.NodeVariable(name, nodeRep, null, null, NodeSources.RELATIONEXTRACTOR); // note that this means the elements in the firstRowXPaths and the elements in columns must be aligned!
          
          // the statement should track whether it's currently parameterized for a given relation and column obj
          statement.relation = relation;
          statement.columnObj = relation.columns[i];

          return relation.columns[i]; 
        }
      }
      return null;
  }

  function unParameterizeNodeWithRelation(statement, relation){
    if (statement.relation === relation){
      statement.relation = null;
      statement.columnObj = null;
      var columnObject = statement.columnObj;
      statement.columnObj = null;
      statement.currentNode = makeNodeVariableForTrace(statement.trace);
      return columnObject;
    }
    return null;
  }

  function currentNodeXpath(statement, environment){
    if (statement.currentNode instanceof WebAutomationLanguage.NodeVariable){
      return statement.currentNode.currentXPath(environment);
    }
    return statement.currentNode; // this means currentNode better be an xpath if it's not a variable use!
  }

  function currentTab(statement){
    return statement.pageVar.currentTabId();
  }

  function originalTab(statement){
    return statement.pageVar.originalTabId();
  }

  function cleanTrace(trace){
    var cleanTrace = [];
    for (var i = 0; i < trace.length; i++){
      cleanTrace.push(cleanEvent(trace[i]));
    }
    return cleanTrace;
  }

  function cleanEvent(ev){
      var displayData = EventM.getDisplayInfo(ev);
      EventM.clearDisplayInfo(ev);
      var cleanEvent = clone(ev);
      // now restore the true trace object
      EventM.setDisplayInfo(ev, displayData);
      return cleanEvent;
  }

  function proposeCtrlAdditions(statement){
    if (statement.outputPageVars.length > 0){
      var counter = 0;
      var lastIndex = _.reduce(statement.trace, function(acc, ev){counter += 1; if (EventM.getDOMOutputLoadEvents(ev).length > 0) {return counter;} else {return acc;}}, 0);

      var ctrlKeyDataFeatures = {altKey: false, bubbles: true, cancelable: true, charCode: 0, ctrlKey: true, keyCode: 17, keyIdentifier: "U+00A2", keyLocation: 1, metaKey: false, shiftKey: false, timeStamp: 1466118461375, type: "keydown"};

      var ctrlDown = cleanEvent(statement.trace[0]); // clones
      ctrlDown.data = ctrlKeyDataFeatures;
      ctrlDown.meta.dispatchType = "KeyboardEvent";

      var ctrlUp = cleanEvent(statement.trace[0]);
      ctrlUp.data = clone(ctrlKeyDataFeatures);
      ctrlUp.data.ctrlKey = false;
      ctrlUp.data.type = "keyup";
      ctrlUp.meta.dispatchType = "KeyboardEvent";

      statement.trace.splice(lastIndex, 0, ctrlUp);
      statement.trace.splice(0, 0, ctrlDown);

      WALconsole.log(ctrlUp, ctrlDown);

      for (var i = 0; i < lastIndex + 1; i++){ // lastIndex + 1 because we just added two new events!
        if (statement.trace[i].data){
          statement.trace[i].data.ctrlKey = true; // of course may already be true, which is fine
        }
      }
    }
  }

  function requireFeatures(statement, featureNames){
    ReplayTraceManipulation.requireFeatures(statement.trace, statement.node, featureNames); // note that statement.node stores the xpath of the original node
    ReplayTraceManipulation.requireFeatures(statement.cleanTrace, statement.node, featureNames);
  }

  function setBlocklyLabel(obj, label){
    obj.blocklyLabel = label;
  }

  function addToolboxLabel(label){
    blocklyLabels.push(label);
    blocklyLabels = _.uniq(blocklyLabels);
  }

  function attachToPrevBlock(currBlock, prevBlock){
    if (prevBlock){ // sometimes prevblock is null
      var prevBlockConnection = prevBlock.nextConnection;
      var thisBlockConnection = currBlock.previousConnection;
      prevBlockConnection.connect(thisBlockConnection);
    }
  }

  // for things like loops that have bodies, attach the nested blocks
  function attachNestedBlocksToWrapper(wrapperBlock, fistNestedBlock){
    var parentConnection = wrapperBlock.getInput('statements').connection;
    var childConnection = fistNestedBlock.previousConnection;
    parentConnection.connect(childConnection);
  }

  function genBlocklyBlocksSeq(statements){
    var foundFirstNonNull = false;
    var lastBlock = null;
    for (var i = 0; i < statements.length; i++){
      var newBlock = statements[i].genBlocklyNode(lastBlock);
      if (newBlock !== null){ // handle the fact that there could be null-producing nodes in the middle, and need to connect around those
        lastBlock = newBlock;
        // also, if this is our first non-null block it's the one we'll want to return
        if (!foundFirstNonNull){
          foundFirstNonNull = newBlock;
        }
      }
    }
    return foundFirstNonNull;
  }


  function getLoopIterationCountersHelper(s, acc){
    if (s === null || s === undefined){
      return acc;
    }
    if (s instanceof WebAutomationLanguage.LoopStatement){
      acc.unshift(s.rowsSoFar);
    }
    return getLoopIterationCountersHelper(s.parent, acc);
  }

  function getLoopIterationCounters(s){
    return getLoopIterationCountersHelper(s, []);
  }

  // the actual statements

  pub.LoadStatement = function _LoadStatement(trace){
    Revival.addRevivalLabel(this);
    setBlocklyLabel(this, "load");
    if (trace){ // we will sometimes initialize with undefined, as when reviving a saved program
      this.trace = trace;

      // find the record-time constants that we'll turn into parameters
      var ev = firstVisibleEvent(trace);
      this.url = ev.data.url;
      this.outputPageVar = EventM.getLoadOutputPageVar(ev);
      this.outputPageVars = [this.outputPageVar]; // this will make it easier to work with for other parts of the code
      // for now, assume the ones we saw at record time are the ones we'll want at replay
      this.currentUrl = this.url;

      // usually 'completed' events actually don't affect replayer -- won't load a new page in a new tab just because we have one.  want to tell replayer to actually do a load
      ev.forceReplay = true;

      this.cleanTrace = cleanTrace(trace);    
    }

    this.remove = function _remove(){
      this.parent.removeChild(this);
    }

    this.prepareToRun = function _prepareToRun(){
      return;
    };
    this.clearRunningState = function _clearRunningState(){
      return;
    }

    this.cUrl = function _cUrl(environment){
      if (this.currentUrl instanceof WebAutomationLanguage.NodeVariable){
        return this.currentUrl.currentText(environment);
      }
      else {
        // else it's a string
        return this.currentUrl;
      }
    }

    this.cUrlString = function _cUrlString(){
      if (this.currentUrl instanceof WebAutomationLanguage.NodeVariable){
        return this.currentUrl.toString();
      }
      else {
        // else it's a string
        return '"'+this.currentUrl+'"';
      }
    }

    this.toStringLines = function _toStringLines(){
      var cUrl = this.cUrlString();
      return [this.outputPageVar.toString()+" = load("+cUrl+")"];
    };

    this.updateBlocklyBlock = function _updateBlocklyBlock(pageVars, relations){
      addToolboxLabel(this.blocklyLabel);
      var pageVarsDropDown = makePageVarsDropdown(pageVars);
      Blockly.Blocks[this.blocklyLabel] = {
        init: function() {
          this.appendDummyInput()
              .appendField("load")
              .appendField(new Blockly.FieldTextInput("URL"), "url")
              .appendField("in")
              .appendField(new Blockly.FieldDropdown(pageVarsDropDown), "page");
          this.setPreviousStatement(true, null);
          this.setNextStatement(true, null);
          this.setColour(280);
        }
      };
    };

    this.genBlocklyNode = function _genBlocklyNode(prevBlock){
      this.block = workspace.newBlock(this.blocklyLabel);
      this.block.setFieldValue(encodeURIComponent(this.cUrlString()), "url");
      this.block.setFieldValue(this.outputPageVar.toString(), "page");
      attachToPrevBlock(this.block, prevBlock);
      this.block.WALStatement = this;
      return this.block;
    };

    this.traverse = function _traverse(fn, fn2){
      fn(this);
      fn2(this);
    };

    this.pbvs = function _pbvs(){
      var pbvs = [];
      if (this.url !== this.currentUrl){
        pbvs.push({type:"url", value: this.url});
      }
      return pbvs;
    };

    this.parameterizeForRelation = function _parameterizeForRelation(relation){
      // ok!  loads can now get changed based on relations!
      // what we want to do is load a different url if we have a relation that includes the url
      var columns = relation.columns;
      var firstRowNodeRepresentations = relation.firstRowNodeRepresentations();
      // again, must have columns and firstRowNodeRepresentations aligned.  should be a better way
      for (var i = 0; i < columns.length; i++){
        var text = columns[i].firstRowText;
        if (text === null || text === undefined){
          // can't parameterize for a cell that has null text
          continue;
        }
        if (text === this.url){
          // ok, we want to parameterize
          this.relation = relation;
          var name = relation.columns[i].name;
          this.currentUrl = new WebAutomationLanguage.NodeVariable(name, firstRowNodeRepresentations[i], null, null, NodeSources.RELATIONEXTRACTOR);
          return relation.columns[i];
        }
      }
    };
    this.unParameterizeForRelation = function _unParameterizeForRelation(relation){
      if (this.relation === relation){
        this.relation = null;
        this.currentUrl = this.url;
      }
      return;
    };

    this.args = function _args(environment){
      var args = [];
      if (this.currentUrl instanceof WebAutomationLanguage.NodeVariable){
        args.push({type:"url", value: this.currentUrl.currentText(environment)});
      }
      else{
        args.push({type:"url", value: this.currentUrl}); // if it's not a var use, it's just a string
      }
      return args;
    };

    this.postReplayProcessing = function _postReplayProcessing(runObject, trace, temporaryStatementIdentifier){
      return;
    };
  };
  pub.ClickStatement = function _ClickStatement(trace){
    Revival.addRevivalLabel(this);
    setBlocklyLabel(this, "click");
    if (trace){ // we will sometimes initialize with undefined, as when reviving a saved program
      this.trace = trace;

      // find the record-time constants that we'll turn into parameters
      var ev = firstVisibleEvent(trace);
      this.pageVar = EventM.getDOMInputPageVar(ev);
      this.pageUrl = ev.frame.topURL;
      this.node = ev.target.xpath;
      var domEvents = _.filter(trace, function(ev){return ev.type === "dom";}); // any event in the segment may have triggered a load
      var outputLoads = _.reduce(domEvents, function(acc, ev){return acc.concat(EventM.getDOMOutputLoadEvents(ev));}, []);
      this.outputPageVars = _.map(outputLoads, function(ev){return EventM.getLoadOutputPageVar(ev);});
      // for now, assume the ones we saw at record time are the ones we'll want at replay
      // this.currentNode = this.node;
      this.origNode = this.node;

      // we may do clicks that should open pages in new tabs but didn't open new tabs during recording
      // todo: may be worth going back to the ctrl approach, but there are links that refuse to open that way, so for now let's try back buttons
      // proposeCtrlAdditions(this);
      this.cleanTrace = cleanTrace(this.trace);

      // actually we want the currentNode to be a nodeVariable so we have a name for the scraped node
      this.currentNode = makeNodeVariableForTrace(trace);
    }

    this.remove = function _remove(){
      this.parent.removeChild(this);
    }

    this.prepareToRun = function _prepareToRun(){
      if (this.currentNode instanceof WebAutomationLanguage.NodeVariable){
        var feats = this.currentNode.getRequiredFeatures();
        requireFeatures(this, feats);
      }
    };
    this.clearRunningState = function _clearRunningState(){
      return;
    }

    this.toStringLines = function _toStringLines(){
      var nodeRep = nodeRepresentation(this);
      return [outputPagesRepresentation(this)+"click("+nodeRep+")"];
    };

    this.updateBlocklyBlock = function _updateBlocklyBlock(pageVars, relations){
      addToolboxLabel(this.blocklyLabel);
      var pageVarsDropDown = makePageVarsDropdown(pageVars);
      Blockly.Blocks[this.blocklyLabel] = {
        init: function() {
          this.appendDummyInput()
              .appendField("click")
              .appendField(new Blockly.FieldTextInput("node"), "node") // switch to pulldown
              .appendField("in")
              .appendField(new Blockly.FieldDropdown(pageVarsDropDown), "page");
          this.setPreviousStatement(true, null);
          this.setNextStatement(true, null);
          this.setColour(280);
        }
      };
    };

    this.genBlocklyNode = function _genBlocklyNode(prevBlock){
      this.block = workspace.newBlock(this.blocklyLabel);
      this.block.setFieldValue(nodeRepresentation(this), "node");
      this.block.setFieldValue(this.pageVar.toString(), "page");
      attachToPrevBlock(this.block, prevBlock);
      this.block.WALStatement = this;
      return this.block;
    };

    this.traverse = function _traverse(fn, fn2){
      fn(this);
      fn2(this);
    };

    this.pbvs = function _pbvs(){
      var pbvs = [];
      if (currentTab(this)){
        // do we actually know the target tab already?  if yes, go ahead and paremterize that
        pbvs.push({type:"tab", value: originalTab(this)});
      }
      if (this.currentNode instanceof WebAutomationLanguage.NodeVariable && this.currentNode.getSource() === NodeSources.RELATIONEXTRACTOR){ // we only want to pbv for things that must already have been extracted by relation extractor
        pbvs.push({type:"node", value: this.node});
      }
      return pbvs;
    };

    this.parameterizeForRelation = function _parameterizeForRelation(relation){
      return [parameterizeNodeWithRelation(this, relation, this.pageVar)];
    };
    this.unParameterizeForRelation = function _unParameterizeForRelation(relation){
      unParameterizeNodeWithRelation(this, relation);
    };

    this.args = function _args(environment){
      var args = [];
      args.push({type:"tab", value: currentTab(this)});
      if (this.currentNode instanceof WebAutomationLanguage.NodeVariable && this.currentNode.getSource() === NodeSources.RELATIONEXTRACTOR){ // we only want to pbv for things that must already have been extracted by relation extractor
        args.push({type:"node", value: currentNodeXpath(this, environment)});
      }
      return args;
    };

    this.postReplayProcessing = function _postReplayProcessing(runObject, trace, temporaryStatementIdentifier){
      return;
    };

    this.currentRelation = function _currentRelation(){
      return this.relation;
    };

    this.currentColumnObj = function _currentColumnObj(){
      return this.columnObj;
    };
  };

  pub.ScrapeStatementFromRelationCol = function _ScrapeStatementFromRelationCol(relation, colObj, pageVar){
    var statement = new pub.ScrapeStatement([]);
    statement.currentNode = new WebAutomationLanguage.NodeVariable(colObj.name, relation.firstRowNodeRepresentation(colObj), null, null, NodeSources.RELATIONEXTRACTOR);
    statement.pageVar = pageVar;
    statement.relation = relation;
    statement.columnObj = colObj;
    return statement;
  }

  pub.ScrapeStatement = function _ScrapeStatement(trace){
    Revival.addRevivalLabel(this);
    setBlocklyLabel(this, "scrape");

    this.associatedOutputStatements = [];

    if (trace){ // we will sometimes initialize with undefined, as when reviving a saved program
      this.trace = trace;
      this.cleanTrace = cleanTrace(this.trace);

      if (trace.length > 0){ // may get 0-length trace if we're just adding a scrape statement by editing (as for a known column in a relation)
        // find the record-time constants that we'll turn into parameters
        var ev = firstVisibleEvent(trace);
        this.pageVar = EventM.getDOMInputPageVar(ev);
        this.node = ev.target.xpath;
        this.pageUrl = ev.frame.topURL;
        // for now, assume the ones we saw at record time are the ones we'll want at replay
        //this.currentNode = this.node;
        this.origNode = this.node;

        // are we scraping a link or just the text?
        this.scrapeLink = false;
        for (var i = 0; i <  trace.length; i++){
          if (trace[i].additional && trace[i].additional.scrape){
            if (trace[i].additional.scrape.linkScraping){
              this.scrapeLink = true;
              break;
            }
          }
        }
      }

      // actually we want the currentNode to be a nodeVariable so we have a name for the scraped node
      this.currentNode = makeNodeVariableForTrace(trace);
      this.varName = this.currentNode.getName();
      this.defaultVarNameText = this.varName;
    }

    this.remove = function _remove(){
      this.parent.removeChild(this);
      for (var i = 0; i < this.associatedOutputStatements.length; i++){
        this.associatedOutputStatements[i].removeAssociatedScrapeStatement(this);
      }
    }

    this.prepareToRun = function _prepareToRun(){
      if (this.currentNode instanceof WebAutomationLanguage.NodeVariable){
        var feats = this.currentNode.getRequiredFeatures();
        requireFeatures(this, feats);
      }
    };
    this.clearRunningState = function _clearRunningState(){
      this.xpaths = [];
      this.preferredXpath = null;
      return;
    }

    this.toStringLines = function _toStringLines(){
      var alreadyBound = this.currentNode instanceof WebAutomationLanguage.NodeVariable && this.currentNode.getSource === NodeSources.RELATIONEXTRACTOR; // todo: could be it's already bound even without being relation extracted, so should really handle that
      if (alreadyBound){
        return ["scrape(" + this.currentNode.getName() + ")"];
      }
      var nodeRep = nodeRepresentation(this, this.scrapeLink);
      var sString = "scrape(";
      //if (this.scrapeLink){
      //  sString = "scrapeLink(";
      //}
      return [sString + nodeRep+", "+this.currentNode.getName()+")"];
    };

    this.updateBlocklyBlock = function _updateBlocklyBlock(pageVars, relations){
      addToolboxLabel(this.blocklyLabel);
      var pageVarsDropDown = makePageVarsDropdown(pageVars);
      Blockly.Blocks[this.blocklyLabel] = {
        init: function() {
          this.appendDummyInput()
              .appendField("scrape")
              .appendField(new Blockly.FieldTextInput("node"), "node") // switch to pulldown
              .appendField("in")
              .appendField(new Blockly.FieldDropdown(pageVarsDropDown), "page");
          this.setPreviousStatement(true, null);
          this.setNextStatement(true, null);
          this.setColour(280);
        }
      };

      // now any blockly blocks we'll need but don't want to have in the toolbox for whatever reason
      // (usually because we can only get the statement from ringer)
      this.updateAlternativeBlocklyBlock(pageVars, relations);
    };

    this.alternativeBlocklyLabel = "scrape_ringer"
    this.updateAlternativeBlocklyBlock = function _updateBlocklyBlock(pageVars, relations){

      var pageVarsDropDown = makePageVarsDropdown(pageVars);
      Blockly.Blocks[this.alternativeBlocklyLabel] = {
        init: function() {
          this.appendDummyInput()
              .appendField("scrape")
              .appendField(new Blockly.FieldTextInput("node"), "node") // switch to pulldown
              .appendField("in")
              .appendField(new Blockly.FieldDropdown(pageVarsDropDown), "page")
              .appendField("and call it")
              .appendField(new Blockly.FieldTextInput("name"), "name");
          this.setPreviousStatement(true, null);
          this.setNextStatement(true, null);
          this.setColour(280);
        },
        onchange: function(ev) {
            var newName = this.getFieldValue("name");
            if (newName !== this.WALStatement.defaultVarNameText){
              this.WALStatement.varName = newName;
              this.WALStatement.currentNode.setName(newName);
              // new name so update all our program display stuff
              RecorderUI.updateDisplayedScript(false);
            }
        }
      };
    };

    this.genBlocklyNode = function _genBlocklyNode(prevBlock){
      if (this.relation){
        // scrapes a relation node, so don't let the user name the node here probably?
        this.block = workspace.newBlock(this.blocklyLabel);
      }
      else{
        // ah, a ringer-scraped node
        this.block = workspace.newBlock(this.alternativeBlocklyLabel);
        if (this.varName){
          this.block.setFieldValue(this.varName, "name")
        }
        else{
          this.block.setFieldValue(this.defaultVarNameText, "name");
        }
      }
      this.block.setFieldValue(nodeRepresentation(this), "node");
      this.block.setFieldValue(this.pageVar.toString(), "page");
      attachToPrevBlock(this.block, prevBlock);
      this.block.WALStatement = this;
      return this.block;
    };

    this.traverse = function _traverse(fn, fn2){
      fn(this);
      fn2(this);
    };

    this.scrapingRelationItem = function _scrapingRelationItem(){
      return this.relation !== null && this.relation !== undefined;
    };

    this.pbvs = function _pbvs(){
      var pbvs = [];
      if (this.trace.length > 0){ // no need to make pbvs based on this statement's parameterization if it doesn't have any events to parameterize anyway...
        if (currentTab(this)){
          // do we actually know the target tab already?  if yes, go ahead and paremterize that
          pbvs.push({type:"tab", value: originalTab(this)});
        }
        if (this.scrapingRelationItem()){
          pbvs.push({type:"node", value: this.node});
        }
        if (this.preferredXpath){
          // using the usual pbv process happens to be a convenient way to enforce a preferred xpath, since it sets it to prefer a given xpath
          // and replaces all uses in the trace of a given xpath with a preferred xpath
          // but may prefer to extract this non-relation based pbv process from the normal relation pbv.  we'll see
          // side note: the node pbv above will only appear if it's a use of a relation cell, and this one will only appear if it's not
          pbvs.push({type:"node", value: this.node});
        }
      }

      return pbvs;
    };

    this.parameterizeForRelation = function _parameterizeForRelation(relation){
      WALconsole.log("scraping cleantrace", this.cleanTrace);
      var relationColumnUsed = parameterizeNodeWithRelation(this, relation, this.pageVar); // this sets the currentNode
      if (relationColumnUsed){
        relationColumnUsed.scraped = true; // need the relation column to keep track of the fact that this is being scraped
        // this is cool because now we don't need to actually run scraping interactions to get the value, so let's update the cleanTrace to reflect that
        /*
        for (var i = this.cleanTrace.length - 1; i >= 0; i--){
          if (this.cleanTrace[i].additional && this.cleanTrace[i].additional.scrape && this.cleanTrace[i].data.type !== "focus"){
            // todo: do we need to add this to the above condition:
            // && !(["keyup", "keypress", "keydown"].indexOf(this.cleanTrace[i].data.type) > -1)
            // todo: the below is commented out for debugging;  fix it
            this.cleanTrace.splice(i, 1);
          }
        }
        WALconsole.log("shortened cleantrace", this.cleanTrace);
        */
        return [relationColumnUsed];
      }
      else {
        return [];
      }
    };
    this.unParameterizeForRelation = function _unParameterizeForRelation(relation){
      var columnObject = unParameterizeNodeWithRelation(this, relation);
      // todo: right now we're assuming we only scrape a given column once in a given script, so if we unparameterize here
      // we assume no where else is scraping this column, and we reset the column object's scraped value
      // but there's no reason for this assumption to be true.  it doesn't matter much, so not fixing it now.  but fix in future
      if (columnObject){ // will be null if we're not actually unparameterizing anything
        colObject.scraped = false; // should really do reference counting
      }

      // have to go back to actually running the scraping interactions...
      // note! right now unparameterizing a scrape statement adds back in all the removed scraping events, which won't always be necessary
      // should really do it on a relation by relation basis, only remove the ones related to the current relation
      this.cleanTrace = cleanTrace(this.trace);
    };

    this.args = function _args(environment){
      var args = [];
      if (this.trace.length > 0){ // no need to make pbvs based on this statement's parameterization if it doesn't have any events to parameterize anyway...
        if (this.scrapingRelationItem()){
          args.push({type:"node", value: currentNodeXpath(this, environment)});
        }
        args.push({type:"tab", value: currentTab(this)});
        if (this.preferredXpath){
          args.push({type:"node", value: this.preferredXpath});
        }
      }
      return args;
    };

    this.xpaths = [];
    this.postReplayProcessing = function _postReplayProcessing(runObject, trace, temporaryStatementIdentifier){

      if (!this.scrapingRelationItem()){
        // ok, this was a ringer-run scrape statement, so we have to grab the right node out of the trace

        // it's not just a relation item, so relation extraction hasn't extracted it, so we have to actually look at the trace
        // find the scrape that corresponds to this scrape statement based on temporarystatementidentifier
        var ourStatementTraceSegment = _.filter(trace, function(ev){return EventM.getTemporaryStatementIdentifier(ev) === temporaryStatementIdentifier;});
        var matchI = null;
        for (var i = 0; i < ourStatementTraceSegment.length; i++){
          if (ourStatementTraceSegment[i].additional && ourStatementTraceSegment[i].additional.scrape && ourStatementTraceSegment[i].additional.scrape.text){
            // for now, all scrape statements have a NodeVariable as currentNode, so can call setCurrentNodeRep to bind name in current environment
            this.currentNode.setCurrentNodeRep(runObject.environment, ourStatementTraceSegment[i].additional.scrape);
            matchI = i;
            break;
          }
        }
        if (matchI === null){
          this.currentNode.setCurrentNodeRep(runObject.environment, null);
        }

        // it's not a relation item, so let's start keeping track of the xpaths of the nodes we actually find, so we can figure out if we want to stop running full similarity
        // note, we could factor this out and let this apply to other statement types --- clicks, typing
        // but empirically, have mostly had this issue slowing down scraping, not clicks and the like, since there are usually few of those
        if (!this.preferredXpath){ // if we haven't yet picked a preferredXpath...
          if (matchI){
            var firstNodeUse = ourStatementTraceSegment[matchI];
            var xpath = firstNodeUse.target.xpath;
            this.xpaths.push(xpath);
            if (this.xpaths.length === 5){
              // ok, we have enough data now that we might be able to decide to do something smarter
              var uniqueXpaths = _.uniq(this.xpaths);
              if (uniqueXpaths.length === 1){
                // we've used the exact same one this whole time...  let's try using that as our preferred xpath
                this.preferredXpath = uniqueXpaths[0];
              }
            }
          }
        }
        else {
          // we've already decided we have a preferred xpath.  we should check and make sure we're still using it.  if we had to revert to using similarity
          // we should stop trying to use the current preferred xpath, start tracking again.  maybe the page has been redesigned and we can discover a new preferred xpath
          // so we'll enter that phase again
          if (matchI){ // only make this call if we actually have an event that aligns...
            var firstNodeUse = ourStatementTraceSegment[matchI]; 
            var xpath = firstNodeUse.target.xpath;
            if (xpath !== this.preferredXpath){
              this.preferredXpath = null;
              this.xpaths = [];
            }      
          }

        }
      }

      // and now get the answer in a way that works both for relation-scraped and ringer-scraped, because of using NodeVariable
      this.currentNodeCurrentValue = this.currentNode.currentNodeRep(runObject.environment);
      if (!this.currentNodeCurrentValue){
        this.currentNodeCurrentValue = {}; // todo: is it ok to just use an empty entry as a cell when we find none?
      }

      if (this.scrapeLink){
        this.currentNodeCurrentValue.scraped_attribute = "LINK";
      }
      else{
        this.currentNodeCurrentValue.scraped_attribute = "TEXT";
      }

    };

    this.addAssociatedOutputStatement = function _addAssociatedOutputStatement(outputStatement){
      this.associatedOutputStatements.push(outputStatement);
      this.associatedOutputStatements = _.uniq(this.associatedOutputStatements);
    };
    this.removeAssociatedOutputStatement = function _removeAssociatedOutputStatement(outputStatement){
      this.associatedOutputStatements = _.without(this.associatedOutputStatements, outputStatement);
    }

    this.currentRelation = function _currentRelation(){
      return this.relation;
    };

    this.currentColumnObj = function _currentColumnObj(){
      return this.columnObj;
    };   
  };

  pub.TypeStatement = function _TypeStatement(trace){
    Revival.addRevivalLabel(this);
    setBlocklyLabel(this, "type");
    if (trace){ // we will sometimes initialize with undefined, as when reviving a saved program
      this.trace = trace;
      this.cleanTrace = cleanTrace(trace);

      // find the record-time constants that we'll turn into parameters
      var ev = firstVisibleEvent(trace);
      this.pageVar = EventM.getDOMInputPageVar(ev);
      this.node = ev.target.xpath;
      this.pageUrl = ev.frame.topURL;
      var acceptableEventTypes = statementToEventMapping.keyboard;
      var textEntryEvents = _.filter(trace, function(ev){var sType = WebAutomationLanguage.statementType(ev); return (sType === StatementTypes.KEYBOARD || sType === StatementTypes.KEYUP);});
      if (textEntryEvents.length > 0){
        var lastTextEntryEvent = textEntryEvents[textEntryEvents.length - 1];
        this.typedString = lastTextEntryEvent.target.snapshot.value;
        if (!this.typedString){
          this.typedString = "";
        }
        this.typedStringLower = this.typedString.toLowerCase(); 
      }

      var domEvents = _.filter(trace, function(ev){return ev.type === "dom";}); // any event in the segment may have triggered a load
      var outputLoads = _.reduce(domEvents, function(acc, ev){return acc.concat(EventM.getDOMOutputLoadEvents(ev));}, []);
      this.outputPageVars = _.map(outputLoads, function(ev){return EventM.getLoadOutputPageVar(ev);});
      // for now, assume the ones we saw at record time are the ones we'll want at replay
      this.currentNode = this.currentNode = makeNodeVariableForTrace(trace);
      this.origNode = this.node;
      this.currentTypedString = this.typedString;

      // we want to do slightly different things for cases where the typestatement only has keydowns or only has keyups (as when ctrl, shift, alt used)
      var onlyKeydowns = _.reduce(textEntryEvents, function(acc, e){return acc && e.data.type === "keydown"}, true);
      if (onlyKeydowns){
        this.onlyKeydowns = true;
      }
      var onlyKeyups = _.reduce(textEntryEvents, function(acc, e){return acc && e.data.type === "keyup"}, true);
      if (onlyKeyups){
        this.onlyKeyups = true;
      }
      if (onlyKeydowns || onlyKeyups){
        this.keyEvents = textEntryEvents;
        this.keyCodes = _.map(this.keyEvents, function(ev){ return ev.data.keyCode; });
      }
    };


    this.remove = function _remove(){
      this.parent.removeChild(this);
    };

    this.prepareToRun = function _prepareToRun(){
      if (this.currentNode instanceof WebAutomationLanguage.NodeVariable){
        var feats = this.currentNode.getRequiredFeatures();
        requireFeatures(this, feats);
      }
    };
    this.clearRunningState = function _clearRunningState(){
      return;
    };

    this.stringRep = function _typedString(){
      var stringRep = "";
      if (this.currentTypedString instanceof WebAutomationLanguage.Concatenate){
        stringRep = this.currentTypedString.toString();
      }
      else{
        stringRep = "'"+this.currentTypedString+"'";
      }
      return stringRep;
    };

    this.toStringLines = function _toStringLines(){
      if (!this.onlyKeyups && !this.onlyKeydowns){
        // normal processing, for when there's actually a typed string
        var stringRep = this.stringRep();
        return [outputPagesRepresentation(this)+"type("+this.pageVar.toString()+", "+stringRep+")"];
      }
      else{
        return [];
        /*
        var charsDict = {16: "SHIFT", 17: "CTRL", 18: "ALT", 91: "CMD"}; // note that 91 is the command key in Mac; on Windows, I think it's the Windows key; probably ok to use cmd for both
        var chars = [];
        _.each(this.keyEvents, function(ev){
          if (ev.data.keyCode in charsDict){
            chars.push(charsDict[ev.data.keyCode]);
          }
        });
        var charsString = chars.join(", ");
        var act = "press"
        if (this.onlyKeyups){
          act = "let up"
        }
        return [act + " " + charsString + " on " + this.pageVar.toString()];
        */
      }
    };


    this.updateBlocklyBlock = function _updateBlocklyBlock(pageVars, relations){
      addToolboxLabel(this.blocklyLabel);
      var pageVarsDropDown = makePageVarsDropdown(pageVars);
      Blockly.Blocks[this.blocklyLabel] = {
        init: function() {
          this.appendDummyInput()
              .appendField("type")
              .appendField(new Blockly.FieldTextInput("text"), "text")
              .appendField("in")
              .appendField(new Blockly.FieldDropdown(pageVarsDropDown), "page");
          this.setPreviousStatement(true, null);
          this.setNextStatement(true, null);
          this.setColour(280);
        }
      };
    };

    this.genBlocklyNode = function _genBlocklyNode(prevBlock){
      if (!this.onlyKeyups && !this.onlyKeydowns){
        this.block = workspace.newBlock(this.blocklyLabel);
        this.block.setFieldValue(this.stringRep(), "text");
        this.block.setFieldValue(this.pageVar.toString(), "page");
        attachToPrevBlock(this.block, prevBlock);
        this.block.WALStatement = this;
        return this.block;
      }
      return null;
    };

    this.traverse = function _traverse(fn, fn2){
      fn(this);
      fn2(this);
    };

    this.pbvs = function _pbvs(){
      var pbvs = [];
      if (currentTab(this)){
        // do we actually know the target tab already?  if yes, go ahead and paremterize that
        pbvs.push({type:"tab", value: originalTab(this)});
      }
      if (this.currentNode instanceof WebAutomationLanguage.NodeVariable && this.currentNode.getSource() === NodeSources.RELATIONEXTRACTOR){ // we only want to pbv for things that must already have been extracted by relation extractor
        pbvs.push({type:"node", value: this.node});
      }
      if (this.typedString !== this.currentTypedString){
        pbvs.push({type:"typedString", value: this.typedString});
      }
      return pbvs;
    };

    this.parameterizeForRelation = function _parameterizeForRelation(relation){
      var relationColumnUsed = parameterizeNodeWithRelation(this, relation, this.pageVar);

      if (!this.onlyKeydowns && !this.onlyKeyups){
        // now let's also parameterize the text
        var columns = relation.columns;
        var firstRowNodeRepresentations = relation.firstRowNodeRepresentations();
        for (var i = 0; i < columns.length; i++){
          var text = columns[i].firstRowText;
          if (text === null || text === undefined){
            // can't parameterize for a cell that has null text
            continue;
          }
          var textLower = text.toLowerCase();
          var startIndex = this.typedStringLower.indexOf(textLower);
          if (startIndex > -1){
            // cool, this is the column for us then
            var components = [];
            var left = text.slice(0, startIndex);
            if (left.length > 0){
              components.push(left)
            }
            components.push(new WebAutomationLanguage.NodeVariable(columns[i].name, firstRowNodeRepresentations[i], null, null, NodeSources.RELATIONEXTRACTOR));
            var right = text.slice(startIndex + this.typedString.length, text.length);
            if (right.length > 0){
              components.push(right)
            }
            this.currentTypedString = new WebAutomationLanguage.Concatenate(components);
            this.typedStringParameterizationRelation = relation;
            return [relationColumnUsed, columns[i]];
          }
        }
      }

      return [relationColumnUsed];
    };
    this.unParameterizeForRelation = function _unParameterizeForRelation(relation){
      unParameterizeNodeWithRelation(this, relation);
      if (this.typedStringParameterizationRelation === relation){
        this.currentTypedString = this.typedString;
      }
    };

    function currentNodeText(statement, environment){
      if (statement.currentTypedString instanceof WebAutomationLanguage.Concatenate){
        return statement.currentTypedString.currentText(environment);
      }
      return statement.currentTypedString; // this means currentNode better be a string if it's not a concatenate node
    }

    this.args = function _args(environment){
      var args = [];
      if (this.currentNode instanceof WebAutomationLanguage.NodeVariable && this.currentNode.getSource() === NodeSources.RELATIONEXTRACTOR){ // we only want to pbv for things that must already have been extracted by relation extractor
        args.push({type:"node", value: currentNodeXpath(this, environment)});
      }
      args.push({type:"typedString", value: currentNodeText(this, environment)});
      args.push({type:"tab", value: currentTab(this)});
      return args;
    };

    this.postReplayProcessing = function _postReplayProcessing(runObject, trace, temporaryStatementIdentifier){
      return;
    };

    this.currentRelation = function _currentRelation(){
      return this.relation;
    };

    this.currentColumnObj = function _currentColumnObj(){
      return this.columnObj;
    };

  };

  pub.OutputRowStatement = function _OutputRowStatement(scrapeStatements){
    Revival.addRevivalLabel(this);
    setBlocklyLabel(this, "output");

    var doInitialize = scrapeStatements; // we will sometimes initialize with undefined, as when reviving a saved program

    this.initialize = function _initialize(){
      this.trace = []; // no extra work to do in r+r layer for this
      this.cleanTrace = [];
      this.scrapeStatements = [];
      for (var i = 0; i < scrapeStatements.length; i++){
        this.addAssociatedScrapeStatement(scrapeStatements[i]);
      }
      this.relations = [];
    }

    this.remove = function _remove(){
      this.parent.removeChild(this);
      for (var i = 0; i < this.scrapeStatements.length; i++){
        this.scrapeStatements[i].removeAssociatedOutputStatement(this);
      }
    }

    this.addAssociatedScrapeStatement = function _addAssociatedScrapeStatement(scrapeStatement){
      this.scrapeStatements.push(scrapeStatement);
      scrapeStatement.addAssociatedOutputStatement(this);
    }
    this.removeAssociatedScrapeStatement = function _removeAssociatedScrapeStatement(scrapeStatement){
      this.scrapeStatements = _.without(this.scrapeStatements, scrapeStatement);
    }

    this.prepareToRun = function _prepareToRun(){
      return;
    };
    this.clearRunningState = function _clearRunningState(){
      return;
    }

    this.toStringLines = function _toStringLines(){
      var textRelationRepLs = _.reduce(this.relations, function(acc,relation){return acc.concat(relation.scrapedColumnNames());}, []);
      var nodeRepLs = _.map(this.scrapeStatements, function(statement){return statement.currentNode.toString(true);});
      var allNames = textRelationRepLs.concat(nodeRepLs);
      WALconsole.log("outputRowStatement", textRelationRepLs, nodeRepLs);
      return ["addOutputRow(["+allNames.join(", ")+"])"];
    };

    this.updateBlocklyBlock = function _updateBlocklyBlock(pageVars, relations){
      addToolboxLabel(this.blocklyLabel);
      Blockly.Blocks[this.blocklyLabel] = {
        init: function() {
          this.appendDummyInput()
              .appendField("output");
          this.setPreviousStatement(true, null);
          this.setNextStatement(true, null);
          this.setColour(25);
        }
      };
    };

    this.genBlocklyNode = function _genBlocklyNode(prevBlock){
      this.block = workspace.newBlock(this.blocklyLabel);
      attachToPrevBlock(this.block, prevBlock);
      this.block.WALStatement = this;
      return this.block;
    };

    this.traverse = function _traverse(fn, fn2){
      fn(this);
      fn2(this);
    };

    this.pbvs = function _pbvs(){
      return [];
    };

    this.parameterizeForRelation = function _parameterizeForRelation(relation){
      if (relation instanceof WebAutomationLanguage.TextRelation){ // only for text relations!
        // the textrelation's own function for grabbing current texts will handle keeping track of whether a given col should be scraped
        // note that this currently doesn't handle well cases where multiple output statements would be trying to grab the contents of a textrelation...
        this.relations = _.union(this.relations, [relation]); // add relation if it's not already in there
        return relation.columns;
      }
      return [];
    };
    this.unParameterizeForRelation = function _unParameterizeForRelation(relation){
      this.relations = _.without(this.relations, relation);
    };
    this.args = function _args(environment){
      return [];
    };

    // todo: is this the best place for this?
    function textToMainpanelNodeRepresentation(text){
      return {
        text: text, 
        link: null, 
        xpath: null, 
        frame: null, 
        source_url: null,
        top_frame_source_url: null,
        date: null
      };
    }

    function convertTextArrayToArrayOfTextCells(textArray){
      newCells = _.map(textArray, textToMainpanelNodeRepresentation);
      _.each(newCells, function(cell){cell.scraped_attribute = "TEXT";})
      return newCells;
    }

    this.postReplayProcessing = function _postReplayProcessing(runObject, trace, temporaryStatementIdentifier){
      // we've 'executed' an output statement.  better send a new row to our output
      var cells = [];
      // get all the cells that we'll get from the text relations
      for (var i = 0; i < this.relations.length; i++){
        var relation = this.relations[i];
        var newCells = relation.getCurrentCellsText(runObject.environment);
        newCells = convertTextArrayToArrayOfTextCells(newCells);
        cells = cells.concat(newCells);
      }
      // get all the cells that we'll get from the scrape statements
      _.each(this.scrapeStatements, function(scrapeStatment){
        cells.push(scrapeStatment.currentNodeCurrentValue);
      });

      // for now we're assuming we always want to show the number of iterations of each loop as the final columns
      var loopIterationCounterTexts = _.map(getLoopIterationCounters(this), function(i){return i.toString();});
      var iterationCells = convertTextArrayToArrayOfTextCells(loopIterationCounterTexts);
      _.each(iterationCells, function(ic){cells.push(ic);});
      
	// todo: why are there undefined things in here!!!!????  get rid of them.  seriously, fix that
	cells = _.filter(cells, function(cell){return cell;});

      runObject.dataset.addRow(cells); // todo: is replayscript.prog really the best way to access the prog object so that we can get the current dataset object, save data to server?
      runObject.program.mostRecentRow = cells;

      var displayTextCells = _.map(cells, function(cell){if (!cell){return "NULL";} if (cell.scraped_attribute === "LINK"){return cell.link;} else {return cell.text;}});
      RecorderUI.addNewRowToOutput(runObject.tab, displayTextCells);
      RecorderUI.updateRowsSoFar(runObject.tab, runObject.dataset.fullDatasetLength);
    };

    if (doInitialize){
      this.initialize();
    }
  }

  /*
  Statements below here are no longer executed by Ringer but rather by their own run methods
  */

  pub.BackStatement = function _BackStatement(pageVarCurr, pageVarBack){
    Revival.addRevivalLabel(this);
    // setBlocklyLabel(this, "back");
    var backStatement = this;
    if (pageVarCurr){ // we will sometimes initialize with undefined, as when reviving a saved program
      this.pageVarCurr = pageVarCurr;
      this.pageVarBack = pageVarBack;
    }

    this.remove = function _remove(){
      this.parent.removeChild(this);
    }

    this.prepareToRun = function _prepareToRun(){
      return;
    };
    this.clearRunningState = function _clearRunningState(){
      return;
    }

    this.toStringLines = function _toStringLines(){
      // back statements are now invisible cleanup, not normal statements, so don't use the line below for now
      // return [this.pageVarBack.toString() + " = " + this.pageVarCurr.toString() + ".back()" ];
      return [];
    };

    this.updateBlocklyBlock = function _updateBlocklyBlock(pageVars, relations){
      // we don't display back presses for now
    };

    this.genBlocklyNode = function _genBlocklyNode(prevBlock){
      return null;
    };

    this.traverse = function _traverse(fn, fn2){
      fn(this);
      fn2(this);
    };

    this.run = function _run(runObject, rbbcontinuation, rbboptions){
      WALconsole.log("run back statement");

      // ok, the only thing we're doing right now is trying to run this back button, so the next time we see a tab ask for an id
      // it should be because of this -- yes, theoretically there could be a process we started earlier that *just* decided to load a new top-level page
      // but that should probably be rare.  todo: is that actually rare?
      utilities.listenForMessageOnce("content", "mainpanel", "requestTabID", function _backListener(data){
        WALconsole.log("back completed");
        backStatement.pageVarBack.setCurrentTabId(backStatement.pageVarCurr.tabId, function(){rbbcontinuation(rbboptions);});
      });

      // send a back message to pageVarCurr
      utilities.sendMessage("mainpanel", "content", "backButton", {}, null, null, [this.pageVarCurr.currentTabId()]);
      // todo: is it enough to just send this message and hope all goes well, or do we need some kind of acknowledgement?
      // update pageVarBack to make sure it has the right tab associated

      // todo: if we've been pressing next or more button within this loop, we might have to press back button a bunch of times!  or we might not if they chose not to make it a new page!  how to resolve????
    };

    this.parameterizeForRelation = function _parameterizeForRelation(relation){
      return [];
    };
    this.unParameterizeForRelation = function _unParameterizeForRelation(relation){
      return;
    };
  };

  pub.ClosePageStatement = function _ClosePageStatement(pageVarCurr){
    Revival.addRevivalLabel(this);
    // setBlocklyLabel(this, "close");
    if (pageVarCurr){ // we will sometimes initialize with undefined, as when reviving a saved program
      this.pageVarCurr = pageVarCurr;
    }
    var that = this;

    this.remove = function _remove(){
      this.parent.removeChild(this);
    }

    this.prepareToRun = function _prepareToRun(){
      return;
    };
    this.clearRunningState = function _clearRunningState(){
      return;
    }

    this.toStringLines = function _toStringLines(){
      // close statements are now invisible cleanup, not normal statements, so don't use the line below for now
      // return [this.pageVarCurr.toString() + ".close()" ];
      return [];
    };

    this.updateBlocklyBlock = function _updateBlocklyBlock(pageVars, relations){
      return;
    };

    this.genBlocklyNode = function _genBlocklyNode(prevBlock){
      // ok, we're not actually making a block
      return null;
    };

    this.traverse = function _traverse(fn, fn2){
      fn(this);
      fn2(this);
    };

    this.run = function _run(runObject, rbbcontinuation, rbboptions){
      console.log("run close statement");
      WALconsole.log("run close statement");

      var tabId = this.pageVarCurr.currentTabId();
      if (tabId !== undefined && tabId !== null){
        console.log("ClosePageStatement run removing tab", this.pageVarCurr.currentTabId());
        chrome.tabs.remove(this.pageVarCurr.currentTabId(), function(){
            that.pageVarCurr.clearCurrentTabId();
            rbbcontinuation(rbboptions);
          }); 
      }
      else{
        WALconsole.log("Warning: trying to close tab for pageVar that didn't have a tab associated at the moment.  Can happen after continue statement.");
        rbbcontinuation(rbboptions);
      }
    };

    this.parameterizeForRelation = function _parameterizeForRelation(relation){
      return [];
    };
    this.unParameterizeForRelation = function _unParameterizeForRelation(relation){
      return;
    };
  };

  pub.ContinueStatement = function _ContinueStatement(){
    Revival.addRevivalLabel(this);
    setBlocklyLabel(this, "continue");

    this.remove = function _remove(){
      this.parent.removeChild(this);
    }

    this.prepareToRun = function _prepareToRun(){
      return;
    };
    this.clearRunningState = function _clearRunningState(){
      return;
    }

    this.toStringLines = function _toStringLines(){
      return ["continue"];
    };

    this.updateBlocklyBlock = function _updateBlocklyBlock(pageVars, relations){
      addToolboxLabel(this.blocklyLabel);
      var pageVarsDropDown = makePageVarsDropdown(pageVars);
      Blockly.Blocks[this.blocklyLabel] = {
        init: function() {
          this.appendDummyInput()
              .appendField("skip");
          this.setPreviousStatement(true, null);
          this.setNextStatement(true, null);
          this.setColour(25);
        }
      };
    };

    this.genBlocklyNode = function _genBlocklyNode(prevBlock){
      this.block = workspace.newBlock(this.blocklyLabel);
      attachToPrevBlock(this.block, prevBlock);
      this.block.WALStatement = this;
      return this.block;
    };

    this.traverse = function _traverse(fn, fn2){
      fn(this);
      fn2(this);
    };

    this.run = function _run(runObject, rbbcontinuation, rbboptions){
      // fun stuff!  time to flip on the 'continue' flag in our continuations, which the for loop continuation will eventually consume and turn off
      rbboptions.skipMode = true;
      rbbcontinuation(rbboptions);
    };

    this.parameterizeForRelation = function _parameterizeForRelation(relation){
      return [];
    };
    this.unParameterizeForRelation = function _unParameterizeForRelation(relation){
      return;
    };
  };

  pub.IfStatement = function _IfStatement(bodyStatements){
    Revival.addRevivalLabel(this);
    setBlocklyLabel(this, "if");

    if (bodyStatements){ // we will sometimes initialize with undefined, as when reviving a saved program
      this.updateChildStatements(bodyStatements);
    }

    this.remove = function _remove(){
      this.parent.removeChild(this);
    }

    this.removeChild = function _removeChild(childStatement){
      this.bodyStatements = _.without(this.bodyStatements, childStatement);
    };
    this.removeChildren = function _removeChild(childStatements){
      this.bodyStatements = _.difference(this.bodyStatements, childStatements);
    };
    this.appendChild = function _appendChild(childStatement){
      var newChildStatements = this.bodyStatements;
      newChildStatements.push(childStatement);
      this.updateChildStatements(newChildStatements);
    };
    this.insertChild = function _appendChild(childStatement, index){
      var newChildStatements = this.bodyStatements;
      newChildStatements.splice(index, 0, childStatement);
      this.updateChildStatements(newChildStatements);
    };

    this.prepareToRun = function _prepareToRun(){
      return;
    };
    this.clearRunningState = function _clearRunningState(){
      return;
    }

    this.toStringLines = function _toStringLines(){
      return ["if"]; // todo: when we have the real if statements, do the right thing
    };

    this.updateBlocklyBlock = function _updateBlocklyBlock(pageVars, relations){
      addToolboxLabel(this.blocklyLabel);
      Blockly.Blocks[this.blocklyLabel] = {
        init: function() {
          this.appendDummyInput()
              .appendField("if");
          this.setPreviousStatement(true, null);
          this.setNextStatement(true, null);
          this.setColour(25);
        }
      };
    };

    this.genBlocklyNode = function _genBlocklyNode(prevBlock){
      this.block = workspace.newBlock(this.blocklyLabel);
      attachToPrevBlock(this.block, prevBlock);
      this.block.WALStatement = this;
      return this.block;
    };

    this.traverse = function _traverse(fn, fn2){
      fn(this);
      for (var i = 0; i < this.bodyStatements.length; i++){
        this.bodyStatements[i].traverse(fn, fn2);
      }
      fn2(this);
    };

    this.updateChildStatements = function _updateChildStatements(newChildStatements){
      this.bodyStatements = newChildStatements;
      for (var i = 0; i < this.bodyStatements.length; i++){
        this.bodyStatements[i].parent = this;
      }
    }

    this.run = function _run(runObject, rbbcontinuation, rbboptions){
      // todo: the condition is hard-coded for now, but obviously we should ultimately have real conds
      if (runObject.environment.envLookup("cases.case_id").indexOf("CVG") !== 0){ // todo: want to check if first scrape statement scrapes something with "CFG" in it
        if (this.bodyStatements.length < 1){
          // ok seriously, why'd you make an if with no body?  come on.
          rbbcontinuation(rbboptions);
          return;
        }
        // let's run the first body statement, make a continuation for running the remaining ones
        var bodyStatements = this.bodyStatements;
        var currBodyStatementsIndex = 1;
        var bodyStatmentsLength = this.bodyStatements.length;
        var newContinuation = function(rbboptions){ // remember that rbbcontinuations must always handle options.skipMode
          if (rbboptions.skipMode || rbboptions.breakMode){
            // executed a continue statement, so don't carry on with this if
            rbbcontinuation(rbboptions);
            return;
          }
          if (currBodyStatementsIndex === bodyStatmentsLength){
            // finished with the body statements, call original continuation
            rbbcontinuation(rbboptions);
            return;
          }
          else{
            // still working on the body of the current if statement, keep going
            currBodyStatementsIndex += 1;
            bodyStatements[currBodyStatementsIndex - 1].run(runObject, newContinuation);
          }
        }
        // actually run that first statement
        bodyStatements[0].run(runObject, newContinuation);
      }
      else{
        // for now we don't have else body statements for our ifs, so we should just carry on with execution
        rbbcontinuation(rbboptions);
      }

    }
    this.parameterizeForRelation = function _parameterizeForRelation(relation){
      // todo: once we have real conditions may need to do something here
      return [];
    };
    this.unParameterizeForRelation = function _unParameterizeForRelation(relation){
      return;
    };
  };

  var duplicateAnnotationCounter = 0;
  pub.DuplicateAnnotation = function _EntityScope(annotationItems, availableAnnotationItems, bodyStatements){
    Revival.addRevivalLabel(this);
    setBlocklyLabel(this, "duplicate_annotation");

    var entityScope = this;

    this.initialize = function(){
      this.annotationItems = annotationItems;
      this.availableAnnotationItems = availableAnnotationItems;
      this.ancestorAnnotations = [];
      this.requiredAncestorAnnotations = []; // we're also allowed to require that prior annotations match, as well as our own annotationItems
      duplicateAnnotationCounter += 1;
      this.name = "Entity" + duplicateAnnotationCounter;
      this.dataset_specific_id = duplicateAnnotationCounter;
      this.updateChildStatements(bodyStatements);
    }

    this.remove = function _remove(){
      this.parent.removeChild(this);
    };

    this.removeChild = function _removeChild(childStatement){
      this.bodyStatements = _.without(this.bodyStatements, childStatement);
    };
    this.removeChildren = function _removeChild(childStatements){
      this.bodyStatements = _.difference(this.bodyStatements, childStatements);
    };
    this.appendChild = function _appendChild(childStatement){
      var newChildStatements = this.bodyStatements;
      newChildStatements.push(childStatement);
      this.updateChildStatements(newChildStatements);
    };
    this.insertChild = function _appendChild(childStatement, index){
      var newChildStatements = this.bodyStatements;
      newChildStatements.splice(index, 0, childStatement);
      this.updateChildStatements(newChildStatements);
    };

    this.updateChildStatements = function _updateChildStatements(newChildStatements){
      this.bodyStatements = newChildStatements;
      for (var i = 0; i < this.bodyStatements.length; i++){
        this.bodyStatements[i].parent = this;
      }
    }

    this.prepareToRun = function _prepareToRun(){
      return;
    };
    this.clearRunningState = function _clearRunningState(){
      this.currentTransaction = null;
      this.duplicatesInARow = 0;
      return;
    }

    this.toStringLines = function _toStringLines(){
      var ancestorString = "";
      for (var i = 0; i < this.ancestorAnnotations.length; i++){
        ancestorString += ", " + ancestorAnnotations[i].name;
      }
      var annotationItemsStr = _.map(this.annotationItems, function(i){return annotationItemToString(i);}).join(", ");
      var prefix = "skipBlock("+this.name+"("+annotationItemsStr+")"+ancestorString+"){";
      var statementStrings = _.reduce(this.bodyStatements, function(acc, statement){return acc.concat(statement.toStringLines());}, []);
      statementStrings = _.map(statementStrings, function(line){return ("&nbsp&nbsp&nbsp&nbsp "+line);});
      return [prefix].concat(statementStrings).concat(["}"]);
    };

    function annotationItemToString(item){
      return item.nodeVar.toString() + "." + item.attr;
    }

    var color = 7;
    this.updateBlocklyBlock = function _updateBlocklyBlock(pageVars, relations){
    };

    this.genBlocklyNode = function _genBlocklyNode(prevBlock){
      var customBlocklyLabel = this.blocklyLabel + this.id;
      var name = this.name;
      var ancestorAnnotations = this.ancestorAnnotations;
      var requiredAncestorAnnotations = this.requiredAncestorAnnotations;
      var availableAnnotationItems = this.availableAnnotationItems;
      var annotationItems = this.annotationItems;
      console.log("in genBlocklyNode", this, this.name, ancestorAnnotations, requiredAncestorAnnotations);
      Blockly.Blocks[customBlocklyLabel] = {
        init: function() {
          console.log("in init", ancestorAnnotations, requiredAncestorAnnotations);
          var fieldsSoFar = this.appendDummyInput()
              .appendField("entity scope ")
              .appendField(new Blockly.FieldTextInput(name), "name");
          if (availableAnnotationItems.length > 0){
            fieldsSoFar = this.appendDummyInput().appendField("attributes: ");
          }
          for (var i = 0; i < availableAnnotationItems.length; i++){
            var onNow = annotationItems.indexOf(availableAnnotationItems[i]) > -1;
            onNow = MiscUtilities.toBlocklyBoolString(onNow);
            fieldsSoFar = fieldsSoFar.appendField(annotationItemToString(availableAnnotationItems[i]) + ":")
            .appendField(new Blockly.FieldCheckbox(onNow), annotationItemToString(availableAnnotationItems[i]));
          }
          if (ancestorAnnotations.length > 0){
            fieldsSoFar = this.appendDummyInput().appendField("other entitites: ");
          }
          for (var i = 0; i < ancestorAnnotations.length; i++){
            var onNow = requiredAncestorAnnotations.indexOf(ancestorAnnotations[i]) > -1;
            onNow = MiscUtilities.toBlocklyBoolString(onNow);
            fieldsSoFar = fieldsSoFar.appendField(ancestorAnnotations[i].name + ":")
            .appendField(new Blockly.FieldCheckbox(onNow), ancestorAnnotations[i].name);
          }

          this.appendStatementInput("statements")
              .setCheck(null)
              .appendField("do");
          
          this.setPreviousStatement(true, null);
          this.setNextStatement(true, null);
          this.setColour(color);
        },
        onchange: function(ev) {
            var newName = this.getFieldValue("name");
            if (newName !== this.WALStatement.name){
              this.WALStatement.name = newName;
            }
        }
      };
      this.block = workspace.newBlock(customBlocklyLabel);
      attachToPrevBlock(this.block, prevBlock);

      // handle the body statements
      var firstNestedBlock = genBlocklyBlocksSeq(this.bodyStatements);
      attachNestedBlocksToWrapper(this.block, firstNestedBlock);

      this.block.WALStatement = this;
      return this.block;
    };

    this.traverse = function _traverse(fn, fn2){
      fn(this);
      for (var i = 0; i < this.bodyStatements.length; i++){
        this.bodyStatements[i].traverse(fn, fn2);
      }
      fn2(this);
    };

    this.endOfLoopCleanup = function _endOfLoopCleanup(){
      this.currentTransaction = null;
      this.duplicatesInARow = 0;
    };

    this.currentTransaction = null;
    this.duplicatesInARow = 0; // make sure to set this to 0 at the beginning of a loop!
    this.run = function _run(runObject, rbbcontinuation, rbboptions){

      if (rbboptions.ignoreEntityScope){
        // this is the case where we just want to assume there's no duplicate because we're pretending the annotation isn't there
        runObject.program.runBasicBlock(runObject, entityScope.bodyStatements, rbbcontinuation, rbboptions);
        return;
      }

      // if we're not ignoring entityscope, we're in the case where choice depends on whether there's a saved duplicate on server
      this.currentTransaction = this.singleAnnotationItems(runObject.environment);
      // you only need to talk to the server if you're actually going to act (skip) now on the knowledge of the duplicate
      var msg = this.serverTransactionRepresentation(runObject);
      MiscUtilities.postAndRePostOnFailure('http://kaofang.cs.berkeley.edu:8080/transactionexists', msg, function(resp){
        if (resp.exists){
          // this is a duplicate, current loop iteration already done, so we're ready to skip to the next
          // so actually nothing should happen.  the whole entityscope should be a no-op
          entityScope.duplicatesInARow += 1;
          if (rbboptions.breakAfterXDuplicatesInARow && entityScope.duplicatesInARow >= rbboptions.breakAfterXDuplicatesInARow){
            // ok, we're actually in a special case, because not only are we not doing the body of the entityScope, we're actually breaking out of this loop
            rbboptions.breakMode = true;
          }
          rbbcontinuation(rbboptions);
        }
        else{
          entityScope.duplicatesInARow = 0;
          // no duplicate saved, so just carry on as usual
          runObject.program.runBasicBlock(runObject, entityScope.bodyStatements, function(){
            // and when we're done with processing the bodystatements, we'll want to commit
            // and then once we've committed, we can go ahead and do the original rbbcontinuation
            entityScope.commit(runObject, rbbcontinuation, rbboptions);
          }, rbboptions);
        }
      });
    };

    this.commit = function _commit(runObject, rbbcontinuation, rbboptions){
      if (!rbboptions.skipCommitInThisIteration){ // it could be that something has happened that will cause us to skip any commits that happen in a particular loop iteration (no node that has all required features, for example)
        var transactionMsg = this.serverTransactionRepresentation(runObject, new Date().getTime());
        var datasetSliceMsg = runObject.dataset.datasetSlice();
        var fullMsg = _.extend(transactionMsg, datasetSliceMsg);
        MiscUtilities.postAndRePostOnFailure('http://kaofang.cs.berkeley.edu:8080/newtransactionwithdata', fullMsg);
      }
      rbbcontinuation(rbboptions);
    };

    this.singleAnnotationItems = function _singleAnnotationItems(environment){
      var rep = [];
      for (var i = 0; i < this.annotationItems.length; i++){
        var item = this.annotationItems[i];
        var nodeVar = item.nodeVar;
        var val = null;
        if (item.attr === "TEXT"){
          val = nodeVar.currentText(environment);
        }
        else if (item.attr === "LINK") {
          val = nodeVar.currentLink(environment);
        }
        else { 
          WALconsole.warn("yo, we don't know what kind of attr we're looking for: ", item.attr);
        }
        rep.push({val:val, attr: item.attr});
      }
      return rep;
    }

    this.serverTransactionRepresentation = function _serverRepresentation(runObject, commitTime){
      var rep = [];
      // build up the whole set of attributes that we use to find a duplicate
      // some from this annotation, but some from any required ancestor annotations
      for (var i = 0; i < this.requiredAncestorAnnotations.length; i++){
        rep = rep.concat(this.requiredAncestorAnnotations[i].currentTransaction);
      }
      rep = rep.concat(this.currentTransaction);
      // todo: find better way to get prog or get dataset
      var rep = {program_run_id: runObject.dataset.getId(), program_id: runObject.program.id, transaction_attributes: encodeURIComponent(JSON.stringify(rep)), annotation_id: this.dataset_specific_id};
      if (commitTime){
        rep.commit_time = commitTime;
      }
      return rep;
    };

    this.parameterizeForRelation = function _parameterizeForRelation(relation){
      return [];
    };
    this.unParameterizeForRelation = function _unParameterizeForRelation(relation){
      return;
    };

    if (annotationItems){
      this.initialize();
    }

  };


  /*
  Loop statements not executed by run method, although may ultimately want to refactor to that
  */

  pub.LoopStatement = function _LoopStatement(relation, relationColumnsUsed, bodyStatements, cleanupStatements, pageVar){
    Revival.addRevivalLabel(this);
    setBlocklyLabel(this, "loop");

    var doInitialization = bodyStatements;
    var loopStatement = this;
    this.cleanupStatements = [];

    this.initialize = function _initialize(){
      this.relation = relation;
      this.relationColumnsUsed = relationColumnsUsed;
      this.updateChildStatements(bodyStatements);
      this.pageVar = pageVar;
      this.maxRows = null; // note: for now, can only be sat at js console.  todo: eventually should have ui interaction for this.
      this.rowsSoFar = 0; 
      this.cleanupStatements = cleanupStatements;
    }

    this.remove = function _remove(){
      this.parent.removeChild(this);
    }
    this.getChildren = function _getChildren(){
      return this.bodyStatements;
    }
    this.removeChild = function _removeChild(childStatement){
      this.bodyStatements = _.without(this.bodyStatements, childStatement);
    };
    this.removeChildren = function _removeChild(childStatements){
      this.bodyStatements = _.difference(this.bodyStatements, childStatements);
    };
    this.appendChild = function _appendChild(childStatement){
      var newChildStatements = this.bodyStatements;
      newChildStatements.push(childStatement);
      this.updateChildStatements(newChildStatements);
    };
    this.insertChild = function _insertChild(childStatement, index){
      var newChildStatements = this.bodyStatements;
      newChildStatements.splice(index, 0, childStatement);
      this.updateChildStatements(newChildStatements);
    };

    this.prepareToRun = function _prepareToRun(){
      return;
    };
    this.clearRunningState = function _clearRunningState(){
      this.rowsSoFar = 0;
      return;
    }

    this.toStringLines = function _toStringLines(){
      var relation = this.relation;
      var varNames = this.relation.scrapedColumnNames();
      var additionalVarNames = this.relation.columnNames(this.relationColumnUsed);
      varNames = _.union(varNames, additionalVarNames);
      WALconsole.log("loopstatement", varNames, additionalVarNames);
      var prefix = "";
      if (this.relation instanceof WebAutomationLanguage.TextRelation){
        var prefix = "for ("+varNames.join(", ")+" in "+this.relation.name+"){"; 
      }
      else{
        var prefix = "for ("+varNames.join(", ")+" in "+this.pageVar.toString()+"."+this.relation.name+"){"; 
      }
      var statementStrings = _.reduce(this.bodyStatements, function(acc, statement){return acc.concat(statement.toStringLines());}, []);
      statementStrings = _.map(statementStrings, function(line){return ("&nbsp&nbsp&nbsp&nbsp "+line);});
      return [prefix].concat(statementStrings).concat(["}"]);
    };

    this.updateBlocklyBlock = function _updateBlocklyBlock(pageVars, relations){
      if (relations.length < 1){
        WALconsole.log("no relations yet, so can't have any loops in blockly.");
        return;
      }

      addToolboxLabel(this.blocklyLabel);
      var pageVarsDropDown = makePageVarsDropdown(pageVars);
      var relationsDropDown = makeRelationsDropdown(relations);
      Blockly.Blocks[this.blocklyLabel] = {
        init: function() {
          this.appendDummyInput()
              .appendField("for each row in")
              .appendField(new Blockly.FieldDropdown(relationsDropDown), "list")        
              .appendField("in")
              .appendField(new Blockly.FieldDropdown(pageVarsDropDown), "page");
          this.appendStatementInput("statements")
              .setCheck(null)
              .appendField("do");
          this.setPreviousStatement(true, null);
          this.setNextStatement(true, null);
          this.setColour(44);
          this.setTooltip('');
          this.setHelpUrl('');
        }
      };
    };

    this.genBlocklyNode = function _genBlocklyNode(prevBlock){
      this.block = workspace.newBlock(this.blocklyLabel);
      this.block.setFieldValue(this.relation.name, "list");
      if (this.pageVar){
        this.block.setFieldValue(this.pageVar.toString(), "page");
      }
      attachToPrevBlock(this.block, prevBlock);

      // handle the body statements
      var firstNestedBlock = genBlocklyBlocksSeq(this.bodyStatements);
      attachNestedBlocksToWrapper(this.block, firstNestedBlock);

      this.block.WALStatement = this;
      return this.block;
    };

    this.traverse = function _traverse(fn, fn2){
      fn(this);
      for (var i = 0; i < this.bodyStatements.length; i++){
        this.bodyStatements[i].traverse(fn, fn2);
      }
      fn2(this);
    };

    function adjustAnnotationParents(){
      // go through the whole tree and make sure any nested annotations know all ancestor annotations
      // note that by default we're making all of them required for matches, not just available for matches
      // in future, if user has edited, we might want to let those edits stand...
      var ancestorAnnotations = [];
      ReplayScript.prog.traverse(function(statement){
        if (statement instanceof WebAutomationLanguage.DuplicateAnnotation){
          statement.ancestorAnnotations = ancestorAnnotations.slice();
          statement.requiredAncestorAnnotations = ancestorAnnotations.slice();
          ancestorAnnotations.push(statement);
        }
      },
      function(statement){
        if (statement instanceof WebAutomationLanguage.DuplicateAnnotation){
          // back out of this entity scope again, so pop it off
          ancestorAnnotations = _.without(ancestorAnnotations, statement);
        }
      });
    }

    function insertAnnotation(annotationItems, availableAnnotationItems, index){
      var loopBodyStatements = loopStatement.bodyStatements;
      var bodyStatements = loopBodyStatements.slice(index, loopBodyStatements.length);
      var annotation = new WebAutomationLanguage.DuplicateAnnotation(annotationItems, availableAnnotationItems, bodyStatements);
      loopStatement.removeChildren(bodyStatements); // now that they're the entityScope's children, shouldn't be loop's children anymore
      loopStatement.appendChild(annotation);
      adjustAnnotationParents();
      RecorderUI.updateDisplayedScript();
    }

    this.addAnnotation = function _addAnnotation(annotationItems, availableAnnotationItems){
      console.log("annotationItems", annotationItems);
      var notYetDefinedAnnotationItems = _.uniq(_.map(annotationItems.slice(), function(obj){return obj.nodeVar;})); // if have both text and link, may appear multiple times
      var alreadyDefinedAnnotationItems = this.relationNodeVariables();
      notYetDefinedAnnotationItems = _.difference(notYetDefinedAnnotationItems, alreadyDefinedAnnotationItems);
      if (notYetDefinedAnnotationItems.length <= 0){
        insertAnnotation(annotationItems, availableAnnotationItems, 0);
        return;
      }
      for (var i = 0; i < this.bodyStatements.length; i++){
        var bStatement = this.bodyStatements[i];
        if (bStatement instanceof WebAutomationLanguage.ScrapeStatement){
          notYetDefinedAnnotationItems = _.without(notYetDefinedAnnotationItems, _.findWhere(notYetDefinedAnnotationItems, {nodeVar:bStatement.currentNode}));
        }
        if (notYetDefinedAnnotationItems.length <= 0){
          insertAnnotation(annotationItems, availableAnnotationItems, i + 1);
          return;
        }
      }
    };

    this.relationNodeVariables = function _relationNodeVariables(){
      return this.relation.nodeVariables();
    }
    this.updateRelationNodeVariables = function _updateRelationNodeVariables(environment){
      WALconsole.log("updateRelationNodeVariables");
      this.relation.updateNodeVariables(environment, this.pageVar);
    }

    this.updateChildStatements = function _updateChildStatements(newChildStatements){
      this.bodyStatements = newChildStatements;
      for (var i = 0; i < this.bodyStatements.length; i++){
        this.bodyStatements[i].parent = this;
      }
    }

    this.parameterizeForRelation = function _parameterizeForRelation(relation){
      return _.flatten(_.map(this.bodyStatements, function(statement){return statement.parameterizeForRelation(relation);}));
    };
    this.unParameterizeForRelation = function _unParameterizeForRelation(relation){
      _.each(this.bodyStatements, function(statement){statement.unParameterizeForRelation(relation);});
    };

    if (doInitialization){
      this.initialize();
    }

  }

  function usedByTextStatement(statement, parameterizeableStrings){
    if (!(statement instanceof WebAutomationLanguage.TypeStatement || statement instanceof WebAutomationLanguage.LoadStatement)){
      return false;
    }
    for (var i = 0; i < parameterizeableStrings.length; i++){
      if (!parameterizeableStrings[i]){ continue;}
      var lowerString = parameterizeableStrings[i].toLowerCase();
      if (statement.typedStringLower && statement.typedStringLower.indexOf(lowerString) > -1){ // for typestatement
        return true;
      }
      if (statement.url && statement.url.toLowerCase() === lowerString) { // for loadstatement
        return true;
      }
    }
    return false;
  }

  // used for relations that only have text in cells, as when user uploads the relation
  pub.TextRelation = function _TextRelation(csvFileContents){
    Revival.addRevivalLabel(this);
    var doInitialization = csvFileContents;
    if (doInitialization){ // we will sometimes initialize with undefined, as when reviving a saved program
      this.relation = $.csv.toArrays(csvFileContents);
      this.firstRowTexts = this.relation[0];
    }

    this.scrapedColumnNames = function _scrapedColumnNames(){
      return _.map(_.filter(this.columns, function(colObj){return colObj.scraped;}), function(colObj){return colObj.name;});
    };

    this.columnNames = function _columnNames(colObj){
      return _.map(colObj, function(colObj){return colObj.name;});
    };

    this.demonstrationTimeRelationText = function _demonstrationTimeRelationText(){
      return this.relation;
    }

    this.firstRowNodeRepresentations = function _firstRowNodeRepresentations(){
      var toNodeRep = function(text){
        return {text: text};
      }
      var firstRowTexts = this.relation[0];
      return _.map(firstRowTexts, toNodeRep);
    };

    this.firstRowNodeRepresentation = function _firstRowNodeRepresentation(colObj){
      var firstRow = this.firstRowNodeRepresentations();
      return firstRow[colObj.index];
    };

    this.nodeVariables = function _nodeVariables(){
      var firstRowNodeReps = this.firstRowNodeRepresentations();
      if (!this.nodeVars){
        this.nodeVars = [];
        for (var i = 0; i < this.columns.length; i++){
          this.nodeVars.push(new WebAutomationLanguage.NodeVariable(this.columns[i].name, firstRowNodeReps[i], null, null, NodeSources.RELATIONEXTRACTOR));
        }
      }
      return this.nodeVars;
    }

    this.updateNodeVariables = function _updateNodeVariables(environment, pageVar){
      WALconsole.log("updateNodeVariables TextRelation");
      var nodeVariables = this.nodeVariables();
      var columns = this.columns; // again, nodeVariables and columns must be aligned
      for (var i = 0; i < columns.length; i++){
        var text = this.relation[currentRowsCounter][columns[i].index];
        var currNodeRep = {text: text};
        nodeVariables[i].setCurrentNodeRep(environment, currNodeRep);
      }
    }

    this.columns = [];
    this.processColumns = function _processColumns(){
      for (var i = 0; i < this.relation[0].length; i++){
        this.columns.push({index: i, name: "column_"+i, firstRowXpath: null, xpath: null, firstRowText: this.firstRowTexts[i], // todo: don't actually want to put filler here
          scraped: true}); // by default, assume we want to scrape all of a text relation's cols (or else, why are they even here?)
      }
    };
    if (doInitialization){
      this.processColumns();
    }

    this.getColumnObjectFromXpath = function _getColumnObjectFromXpath(xpath){
      for (var i = 0; i < this.columns.length; i++){
        if (this.columns[i].xpath === xpath){
          return this.columns[i];
        }
      }
      WALconsole.log("Ack!  No column object for that xpath: ", this.columns, xpath);
      return null;
    };

    // user can give us better names
    this.setColumnName = function _setColumnName(columnObj, v){
      columnObj.name = v;
    };

    this.usedByStatement = function _usedByStatement(statement){
      return usedByTextStatement(statement, this.relation[0]);
    };

    var currentRowsCounter = -1;

    this.getNextRow = function _getNextRow(pageVar, callback){ // has to be called on a page, to match the signature for the non-text relations, but we'll ignore the pagevar
      if (currentRowsCounter + 1 >= this.relation.length){
        callback(false); // no more rows -- let the callback know we're done
      }
      else{
        currentRowsCounter += 1;
        callback(true);
      }
    };


    this.getCurrentCellsText = function _getCurrentCellsText(){
      var cells = [];
      for (var i = 0; i < this.columns.length; i++){
        if (this.columns[i].scraped){
          var cellText = this.getCurrentText(this.columns[i]);
          cells.push(cellText);
        }
      }
      return cells;
    };

    this.getCurrentText = function _getCurrentText(columnObject){
      WALconsole.log(currentRowsCounter, "currentRowsCounter");
      return this.relation[currentRowsCounter][columnObject.index];
    };

    this.getCurrentLink = function _getCurrentLink(pageVar, columnObject){
      WALconsole.log("yo, why are you trying to get a link from a text relation???");
      return "";
    };

    this.clearRunningState = function _clearRunningState(){
      currentRowsCounter = -1;
    };

    this.isColumnUsed = function _isColumnUsed(colObject){
      return colObject.scraped;
    };

    this.setColumnUsed = function _setColumnUsed(colObject, val){
      colObject.scraped = val;
    };


    this.toggleColumnUsed = function _toggleColumnUsed(colObject){
      // if it was previously scraped, we must remove it from output statement
      if (colObject.scraped){
        colObject.scraped = false; // easy to remove, becuase getCurrentCellsText controls what gets scraped when a text relation included with an outputrowstatement, and just responds to whether .scraped is set
      }
      // if it was previously unscraped, we must add it to output statement
      else{
        colObject.scraped = true;
      }
    };
  }

  var relationCounter = 0;
  pub.Relation = function _Relation(relationId, name, selector, selectorVersion, excludeFirst, columns, demonstrationTimeRelation, numRowsInDemo, pageVarName, url, nextType, nextButtonSelector, frame){
    Revival.addRevivalLabel(this);
    var doInitialization = selector;
    if (doInitialization){ // we will sometimes initialize with undefined, as when reviving a saved program
      this.id = relationId;
      this.selector = selector;
      this.selectorVersion = selectorVersion;
      this.excludeFirst = excludeFirst;
      this.columns = columns;
      this.demonstrationTimeRelation = demonstrationTimeRelation;
      this.numRowsInDemo = numRowsInDemo;
      this.pageVarName = pageVarName;
      this.url = url;
      this.nextType = nextType;
      this.nextButtonSelector = nextButtonSelector;
      this.frame = frame; // note that right now this frame comes from our relation-finding stage.  might want it to come from record
      if (name === undefined || name === null){
        relationCounter += 1;
        this.name = "relation_"+relationCounter;
      }
      else{
        this.name = name;
      }
    }

    var relation = this;

    this.demonstrationTimeRelationText = function _demonstrationTimeRelationText(){
      return _.map(this.demonstrationTimeRelation, function(row){return _.map(row, function(cell){return cell.text;});});
    };

    this.firstRowNodeRepresentations = function _firstRowNodeRepresentations(){
      return this.demonstrationTimeRelation[0];
    };

    this.firstRowNodeRepresentation = function _firstRowNodeRepresentation(colObj){
      var allNodeReps = this.firstRowNodeRepresentations();
      var index = colObj.index; // must be agreement between demosntrationtimerelation indexes and actual colobject indexes
      return allNodeReps[index];
    };

    this.nodeVariables = function _NodeVariables(){
      if (!this.nodeVars){
        this.nodeVars = [];
        var nodeReps = this.firstRowNodeRepresentations();
        for (var i = 0; i < nodeReps.length; i++){
          var name = this.columns[i].name;
          this.nodeVars.push(new WebAutomationLanguage.NodeVariable(name, nodeReps[i], null, null, NodeSources.RELATIONEXTRACTOR));
        }
      }
      return this.nodeVars;
    }

    this.updateNodeVariables = function _updateNodeVariables(environment, pageVar){
      WALconsole.log("updateNodeVariables Relation");
      var nodeVariables = this.nodeVariables();
      var columns = this.columns; // again, nodeVariables and columns must be aligned
      for (var i = 0; i < columns.length; i++){
        var currNodeRep = this.getCurrentNodeRep(pageVar, columns[i]);
        nodeVariables[i].setCurrentNodeRep(environment, currNodeRep);
      }
      WALconsole.log("updateNodeVariables Relation completed");
    }

    this.scrapedColumnNames = function _scrapedColumnNames(){
      return _.map(_.filter(this.columns, function(colObj){return colObj.scraped;}), function(colObj){return colObj.name;});
    };

    this.columnNames = function _columnNames(colObj){
      return _.map(colObj, function(colObj){return colObj.name;});
    };

    function domain(url){
      var domain = "";
      // don't need http and so on
      if (url.indexOf("://") > -1) {
          domain = url.split('/')[2];
      }
      else {
          domain = url.split('/')[0];
      }
      domain = domain.split(':')[0]; // there can be site.com:1234 and we don't want that
      return domain;
    }

    this.processColumns = function _processColumns(oldColumns){
      for (var i = 0; i < relation.columns.length; i++){
        processColumn(relation.columns[i], i, oldColumns); // should later look at whether this index is good enough
      }
    };

    function processColumn(colObject, index, oldColObjects){
      if (colObject.name === null || colObject.name === undefined){
        if (oldColObjects){
          // let's search the old col objects, see if any share an xpath and have a name for us
          var oldColObject = findByXpath(oldColObjects, colObject.xpath);
          colObject.name = oldColObject.name;
        }
        else{
          colObject.name = relation.name+"_item_"+(index+1); // a filler name that we'll use for now
        }
      }
      // let's keep track of whether it's scraped by the current program
      if (colObject.scraped === undefined){
        if (oldColObject){
          colObject.scraped = oldColObject.scraped;
        }
        else {
          colObject.scraped = false;
        }
      }
      if (relation.demonstrationTimeRelation[0]){
        var firstRowCell = findByXpath(relation.demonstrationTimeRelation[0], colObject.xpath); // for now we're aligning the demonstration items with everything else via xpath.  may not always be best
        if (firstRowCell){
          colObject.firstRowXpath = firstRowCell.xpath;
          colObject.firstRowText = firstRowCell.text;
        }
      }
      colObject.index = index;
    };

    if (doInitialization){
      WALconsole.log(this);
      this.processColumns();
    }

    function initialize(){
      relation.firstRowXPaths = _.pluck(relation.demonstrationTimeRelation[0], "xpath");
      relation.firstRowTexts = _.pluck(relation.demonstrationTimeRelation[0], "text");
    }
    
    if (doInitialization){
      initialize();
    }

    this.toggleColumnUsed = function _toggleColumnUsed(colObject){
      // if it was previously scraped, we must remove any statements that scrape it
      if (colObject.scraped){
        colObject.scraped = false;
        ReplayScript.prog.traverse(function(statement){
          if (statement instanceof WebAutomationLanguage.ScrapeStatement){
            if (statement.currentRelation() === relation && statement.currentColumnObj() === colObject){
              // ok, this is a scrapestatement that has the target relation and columnobj.  let's delete it
              statement.remove();
            }
          }
        });
      }
      // if it was previously unscraped, we must add a scrape statement for it in the appropriate place
      else{
        colObject.scraped = true;
        var newScrapeStatement = null;
        var outputRowStatement = null;
        ReplayScript.prog.traverse(function(statement){
          if (statement instanceof WebAutomationLanguage.LoopStatement){
            if (statement.relation === relation){
              newScrapeStatement = WebAutomationLanguage.ScrapeStatementFromRelationCol(relation, colObject, statement.pageVar);
              statement.insertChild(newScrapeStatement,0);
            }
          }
          // ok, now we have the new scrape statement, which is great, but we also need to actually add it to output
          // so the next time we hit an outputrowstatement, let's add it in there.
          // this is not the way to do it, because really need to make sure that the outputrowstatement is in scope to see the new scrape statement
          // but this will work as long as the outputrowstatement is the last statement in a prog that just has a bunch of nested loops
          // todo: do this right
          if (statement instanceof WebAutomationLanguage.OutputRowStatement){
            if (newScrapeStatement !== null){
              statement.addAssociatedScrapeStatement(newScrapeStatement);
              outputRowStatement = statement;
            }
          }
        });
        if (outputRowStatement){
          // we may have actually added the new scraping statements after the output statement, so fix it
          outputRowStatement.parent.removeChild(outputRowStatement);
          outputRowStatement.parent.appendChild(outputRowStatement);
        }
      }
    };

    this.isColumnUsed = function _isColumnUsed(colObject){
      return colObject.scraped;
    };

    this.setColumnUsed = function _setColumnUsed(colObject, val){
      colObject.scraped = val;
    }

    this.setNewAttributes = function _setNewAttributes(selector, selectorVersion, excludeFirst, columns, demonstrationTimeRelation, numRowsInDemo, nextType, nextButtonSelector){
      this.selector = selector;
      this.selectorVersion = selectorVersion;
      this.excludeFirst = excludeFirst;
      this.demonstrationTimeRelation = demonstrationTimeRelation;
      this.numRowsInDemo = numRowsInDemo;
      this.nextType = nextType;
      this.nextButtonSelector = nextButtonSelector;

      initialize();

      // now let's deal with columns.  recall we need the old ones, since they might have names we need
      var oldColumns = this.columns;
      this.columns = columns;
      this.processColumns(oldColumns);
    };

    function findByXpath(objectList, xpath){
      var objs = _.filter(objectList, function(obj){return obj.xpath === xpath;});
      if (objs.length === 0){ return null; }
      return objs[0];
    }

    this.nameColumnsAndRelation = function _nameColumnsAndRelation(){
      // should eventually consider looking at existing columns to suggest columns names
    }
    this.nameColumnsAndRelation();

    this.getColumnObjectFromXpath = function _getColumnObjectFromXpath(xpath){
      for (var i = 0; i < this.columns.length; i++){
        if (this.columns[i].xpath === xpath){
          return this.columns[i];
        }
      }
      WALconsole.log("Ack!  No column object for that xpath: ", this.columns, xpath);
      return null;
    };

    // user can give us better names
    this.setColumnName = function _setColumnName(columnObj, v){
      columnObj.name = v;
    };

    this.usedByStatement = function _usedByStatement(statement){
      if (!((statement instanceof WebAutomationLanguage.ScrapeStatement) || (statement instanceof WebAutomationLanguage.ClickStatement) || (statement instanceof WebAutomationLanguage.TypeStatement) || (statement instanceof WebAutomationLanguage.LoadStatement))){
        return false;
      }
      if (statement.pageVar && this.pageVarName === statement.pageVar.name && this.firstRowXPaths.indexOf(statement.node) > -1){
        return true;
      }
      if (usedByTextStatement(statement, this.firstRowTexts)){
        return true;
      }
      // ok, neither the node nor the typed text looks like this relation's cells
      return false;
    };

    this.messageRelationRepresentation = function _messageRelationRepresentation(){
      return {id: this.id, name: this.name, selector: this.selector, selector_version: this.selectorVersion, exclude_first: this.excludeFirst, columns: this.columns, next_type: this.nextType, next_button_selector: this.nextButtonSelector, url: this.url, num_rows_in_demonstration: this.numRowsInDemo};
    };

    this.noMoreRows = function _noMoreRows(pageVar, callback, prinfo, allowMoreNextInteractions){
      // first let's see if we can try running the next interaction again to get some fresh stuff.  maybe that just didn't go through?
      if (allowMoreNextInteractions && prinfo.currentNextInteractionAttempts < 3){
        prinfo.runNextInteraction = true; // so that we don't fall back into trying to grab rows from current page when what we really want is to run the next interaction again.
        this.getNextRow(pageVar, callback);
      }
      else{
        // no more rows -- let the callback know we're done
        // clear the stored relation data also
        prinfo.currentRows = null;
        prinfo.currentRowsCounter = 0;
        prinfo.currentNextInteractionAttempts = 0;
        callback(false); 
      }
    };

    this.gotMoreRows = function _gotMoreRows(prinfo, callback, rel){
      prinfo.needNewRows = false; // so that we don't fall back into this same case even though we now have the items we want
      prinfo.currentRows = rel;
      prinfo.currentRowsCounter = 0;
      prinfo.currentNextInteractionAttempts = 0;
      callback(true);
    }

    function highestPercentOfHasXpathPerRow(relation, limitToSearch){
      if (relation.length < limitToSearch) {limitToSearch = relation.length;}
      var maxWithXpathsPercent = 0;
      for (var i = 0; i < limitToSearch; i++){
        var numWithXpaths = _.reduce(relation[i], function(acc, cell){if (cell.xpath) {return acc + 1;} else {return acc}}, 0);
        var percentWithXpaths = numWithXpaths / relation[i].length;
        if (percentWithXpaths > maxWithXpathsPercent){
          maxWithXpathsPercent = percentWithXpaths;
        }
      }
      return maxWithXpathsPercent;
    }

    var getRowsCounter = 0;
    var doneArray = [];
    var relationItemsRetrieved = {};
    var missesSoFar = {}; // may still be interesting to track misses.  may choose to send an extra next button press, something like that
    // the function that we'll call when we actually have to go back to a page for freshRelationItems
    function getRowsFromPageVar(pageVar, callback, prinfo){
      
      if (!pageVar.currentTabId()){ WALconsole.warn("Hey!  How'd you end up trying to find a relation on a page for which you don't have a current tab id??  That doesn't make sense.", pageVar); }
  
      getRowsCounter += 1;
      doneArray.push(false);
      // once we've gotten data from any frame, this is the function we'll call to process all the results
      var handleNewRelationItemsFromFrame = function(data, frameId){
        var currentGetRowsCounter = getRowsCounter;
        if (doneArray[currentGetRowsCounter]){
          return;
        }

        if (relationItemsRetrieved[frameId]){
          // we actually already have data from this frame.  this can happen because pages are still updating what they're showing
          // but it's a bit of a concern.  let's see what the data actually is, 
          // todo: we should make sure we're not totally losing data because of
          // overwriting old data with new data, then only processing the new data...
          WALconsole.namedLog("getRelationItems", "Got data from a frame for which we already have data", getRowsCounter);
          WALconsole.namedLog("getRelationItems", _.isEqual(data, relationItemsRetrieved[frameId]), data, relationItemsRetrieved[frameId]);
          // we definitely don't want to clobber real new items with anything that's not new items, so let's make sure we don't
          if (relationItemsRetrieved[frameId].type === RelationItemsOutputs.NEWITEMS && data.type !== RelationItemsOutputs.NEWITEMS){
            return;
          }
          // we also don't want to clobber if the old data is actually longer than the new data...
          // if we have long data, it's a little weird that we wouldn't just have accepted it and moved on, but it does happen...
          if (relationItemsRetrieved[frameId].type === RelationItemsOutputs.NEWITEMS && data.type === RelationItemsOutputs.NEWITEMS && relationItemsRetrieved[frameId].relation.length > data.relation.length){
            WALconsole.namedLog("getRelationItems", "The new data is also new items, but it's shorter than the others, so we're actually going to throw it away for now.  May be something to change later.");
            return;
          }
        }

        WALconsole.log("data", data);
        if (data.type === RelationItemsOutputs.NOMOREITEMS){
          // NOMOREITEMS -> definitively out of items.  this frame says this relation is done
          relationItemsRetrieved[frameId] = data; // to stop us from continuing to ask for freshitems
          WALconsole.namedLog("getRelationItems", "We're giving up on asking for new items for one of ", Object.keys(relationItemsRetrieved).length, " frames. frameId: ", frameId, relationItemsRetrieved, missesSoFar);
        }
        else if (data.type === RelationItemsOutputs.NONEWITEMSYET || (data.type === RelationItemsOutputs.NEWITEMS && data.relation.length === 0)){
          // todo: currently if we get data but it's only 0 rows, it goes here.  is that just an unnecessary delay?  should we just believe that that's the final answer?
          missesSoFar[frameId] += 1;
        }
        else if (data.type === RelationItemsOutputs.NEWITEMS){
          // yay, we have real data!

          // ok, the content script is supposed to prevent us from getting the same thing that it already sent before
          // but to be on the safe side, let's put in some extra protections so we don't try to advance too early
          // and also so we don't get into a case where we keep getting the same thing over and over and should decide we're done but instead loop forever
          
          function extractUserVisibleAttributesFromRelation(rel){
            return _.map(rel, function(row){ return _.map(row, function(d){return [d.text, d.link];})});
          }

          if (prinfo.currentRows && _.isEqual(extractUserVisibleAttributesFromRelation(prinfo.currentRows), 
                                              extractUserVisibleAttributesFromRelation(data.relation))){
            WALconsole.namedLog("getRelationItems", "This really shouldn't happen.  We got the same relation back from the content script that we'd already gotten.");
            WALconsole.namedLog("getRelationItems", prinfo.currentRows);
            missesSoFar[frameId] += 1;
          }
          else{
            WALconsole.log("The relations are different.");
            WALconsole.log(prinfo.currentRows, data.relation);
            WALconsole.namedLog("getRelationItems", currentGetRowsCounter, data.relation.length);

            relationItemsRetrieved[frameId] = data; // to stop us from continuing to ask for freshitems

            // let's see if this one has xpaths for all of a row in the first few
            var aRowWithAllXpaths = highestPercentOfHasXpathPerRow(data.relation, 20) === 1;
            // and then see if the difference between the num rows and the target num rows is less than 90% of the target num rows 
            var targetNumRows = relation.demonstrationTimeRelation.length;
            var diffPercent = Math.abs(data.relation.length - targetNumRows) / targetNumRows;
            
            // only want to do the below if we've decided this is the actual data...
            // if this is the only frame, then it's definitely the data
            if (Object.keys(relationItemsRetrieved).length == 1 || (aRowWithAllXpaths && diffPercent < .9 )){
              doneArray[getRowsCounter] = true;
              relation.gotMoreRows(prinfo, callback, data.relation);
              return;
            }
          }
        }
        else{
          WALconsole.log("woaaaaaah freak out, there's freshRelationItems that have an unknown type.");
        }

        // so?  are we done?  if all frames indicated that there are no more, then we just need to stop because the page tried using a next button,
        // couldn't find one, and just won't be getting us more data
        var stillPossibleMoreItems = false; // this should be the value if all frames said NOMOREITEMS
        for (var key in relationItemsRetrieved){
          var obj = relationItemsRetrieved[key];
          if (!obj || obj.type !== RelationItemsOutputs.NOMOREITEMS){
            // ok, there's some reason to think it might be ok, so let's actually go ahead and try again
            stillPossibleMoreItems = true;
          }
        }
        if (!stillPossibleMoreItems){
          WALconsole.namedLog("getRelationItems", "all frames say we're done", getRowsCounter);
          doneArray[getRowsCounter] = true;
          relation.noMoreRows(pageVar, callback, prinfo, false); // false because shouldn't try pressing the next button
        }

      };

      function processEndOfCurrentGetRows(pageVar, callback, prinfo){
        WALconsole.namedLog("getRelationItems", "processEndOfCurrentGetRows", getRowsCounter);
        // ok, we have 'real' (NEWITEMS or decided we're done) data for all of them, we won't be getting anything new, better just pick the best one
        doneArray[getRowsCounter] = true;
        var dataObjs = _.map(Object.keys(relationItemsRetrieved), function(key){return relationItemsRetrieved[key];});
        var dataObjsFiltered = _.filter(dataObjs, function(data){return data.type === RelationItemsOutputs.NEWITEMS;});
        // ok, let's see whether any is close in length to our original one. otherwise have to give up
        // how should we decide whether to accept something close or to believe it's just done???

        for (var i = 0; i < dataObjsFiltered.length; i++){
          var data = dataObjsFiltered[i];
          // let's see if this one has xpaths for all of a row in the first few
          var percentColumns = highestPercentOfHasXpathPerRow(data.relation, 20);
          // and then see if the difference between the num rows and the target num rows is less than 20% of the target num rows 
          var targetNumRows = relation.demonstrationTimeRelation.length;
          var diffPercent = Math.abs(data.relation.length - targetNumRows) / targetNumRows;
          if (percentColumns > .5 && diffPercent < .3){
            WALconsole.namedLog("getRelationItems", "all defined and found new items", getRowsCounter);
            doneArray[getRowsCounter] = true;
            relation.gotMoreRows(prinfo, callback, data.relation);
            return;
          }
        }

        // drat, even with our more flexible requirements, still didn't find one that works.  guess we're done?

        WALconsole.namedLog("getRelationItems", "all defined and couldn't find any relation items from any frames", getRowsCounter);
        doneArray[getRowsCounter] = true;
        relation.noMoreRows(pageVar, callback, prinfo, true); // true because should allow trying the next button
      }

      // let's go ask all the frames to give us relation items for the relation
      var tabId = pageVar.currentTabId();
      WALconsole.log("pageVar.currentTabId()", pageVar.currentTabId());

      function requestFreshRelationItems(frames){
        var currentGetRowsCounter = getRowsCounter;
        relationItemsRetrieved = {};
        missesSoFar = {};
        frames.forEach(function(frame){
          // keep track of which frames need to respond before we'll be ready to advance
          relationItemsRetrieved[frame] = false;
          missesSoFar[frame] = 0;
        });
        frames.forEach(function(frame) {
          // for each frame in the target tab, we want to see if the frame retrieves good relation items
          // we'll pick the one we like best
          // todo: is there a better way?  after all, we do know the frame in which the user interacted with the first page at original record-time.  if we have next stuff happening, we might even know the exact frameId on this exact page
          
          // here's the function for sending the message once
          var msg = relation.messageRelationRepresentation();
          msg.msgType = "getFreshRelationItems";
          var sendGetRelationItems = function(){
            WALconsole.namedLog("getRelationItems", "requesting relation items", currentGetRowsCounter);
            utilities.sendFrameSpecificMessage("mainpanel", "content", "getFreshRelationItems", 
                                                relation.messageRelationRepresentation(), 
                                                tabId, frame, 
                                                // question: is it ok to insist that every single frame returns a non-null one?  maybe have a timeout?  maybe accept once we have at least one good response from one of the frames?
                                                function _getRelationItemsHandler(response) { WALconsole.log("Receiving response: ", frame, response); if (response !== null && response !== undefined) {handleNewRelationItemsFromFrame(response, frame);}}); // when get response, call handleNewRelationItemsFromFrame (defined above) to pick from the frames' answers
          };
          // here's the function for sending the message until we decide we're done with the current attempt to get new rows, or until actually get the answer
          MiscUtilities.repeatUntil(sendGetRelationItems, function _checkDone(){return doneArray[currentGetRowsCounter] || relationItemsRetrieved[frame];},function(){}, 1000, true);
        });
        // and let's make sure that after our chosen timeout, we'll stop and just process whatever we have
        var desiredTimeout = 90000;
        setTimeout(
          function _reachedTimeoutHandler(){
            WALconsole.namedLog("getRelationItems", "Reached timeout", currentGetRowsCounter);
            if (!doneArray[currentGetRowsCounter]){
              doneArray[currentGetRowsCounter] = false;
              processEndOfCurrentGetRows(pageVar, callback, prinfo);
            }
          },
          desiredTimeout
        );
      };

      // ok, let's figure out whether to send the message to all frames in the tab or only the top frame
      if (relation.frame === 0){
        // for now, it's only when the frame index is 0, meaning it's the top-level frame, that we decide on using a single frame ahead of time
        var frames = [0];
        requestFreshRelationItems(frames);
      }
      else {
        chrome.webNavigation.getAllFrames({tabId: tabId}, function(details) {
          var frames = _.map(details, function(d){return d.frameId;});
          requestFreshRelationItems(frames);
        });
      }

    }


    var getNextRowCounter = 0;
    this.getNextRow = function _getNextRow(pageVar, callback){ // has to be called on a page, since a relation selector can be applied to many pages.  higher-level tool must control where to apply
      // todo: this is a very simplified version that assumes there's only one page of results.  add the rest soon.

      // ok, what's the page info on which we're manipulating this relation?
      WALconsole.log(pageVar.pageRelations);
      var prinfo = pageVar.pageRelations[this.name+"_"+this.id]; // separate relations can have same name (no rule against that) and same id (undefined if not yet saved to server), but since we assign unique names when not saved to server and unique ides when saved to server, should be rare to have same both.  todo: be more secure in future
      if (prinfo === undefined){ // if we haven't seen the frame currently associated with this pagevar, need to clear our state and start fresh
        prinfo = {currentRows: null, currentRowsCounter: 0, currentTabId: pageVar.currentTabId(), currentNextInteractionAttempts: 0};
        pageVar.pageRelations[this.name+"_"+this.id] = prinfo;
      }

      // now that we have the page info to manipulate, what do we need to do to get the next row?
      WALconsole.log("getnextrow", this, prinfo.currentRowsCounter);
      if ((prinfo.currentRows === null || prinfo.needNewRows) && !prinfo.runNextInteraction){
        // cool!  no data right now, so we have to go to the page and ask for some
        getRowsFromPageVar(pageVar, callback, prinfo);
      }
      else if ((prinfo.currentRows && prinfo.currentRowsCounter + 1 >= prinfo.currentRows.length) || prinfo.runNextInteraction){
        prinfo.runNextInteraction = false; // have to turn that flag back off so we don't fall back into here after running the next interaction
        getNextRowCounter += 1;
        // ok, we had some data but we've run out.  time to try running the next button interaction and see if we can retrieve some more

        // here's what we want to do once we've actually clicked on the next button, more button, etc
        // essentially, we want to run getNextRow again, ready to grab new data from the page that's now been loaded or updated
        var runningNextInteraction = false;
        utilities.listenForMessageOnce("content", "mainpanel", "runningNextInteraction", function _nextInteractionAck(data){
          var currentGetNextRowCounter = getNextRowCounter;
          WALconsole.namedLog("getRelationItems", currentGetNextRowCounter, "got nextinteraction ack");
          prinfo.currentNextInteractionAttempts += 1;
          runningNextInteraction = true;
          // cool, and now let's start the process of retrieving fresh items by calling this function again
          prinfo.needNewRows = true;
          relation.getNextRow(pageVar, callback);
        });

        // here's us telling the content script to take care of clicking on the next button, more button, etc
        if (!pageVar.currentTabId()){ WALconsole.log("Hey!  How'd you end up trying to click next button on a page for which you don't have a current tab id??  That doesn't make sense.", pageVar); }
        var sendRunNextInteraction = function(){
          var currentGetNextRowCounter = getNextRowCounter;
          WALconsole.namedLog("getRelationItems", currentGetNextRowCounter, "requestNext");
          utilities.sendMessage("mainpanel", "content", "runNextInteraction", relation.messageRelationRepresentation(), null, null, [pageVar.currentTabId()]);};
        MiscUtilities.repeatUntil(sendRunNextInteraction, function(){return runningNextInteraction;},function(){}, 1000, true);
      }
      else {
        // we still have local rows that we haven't used yet.  just advance the counter to change which is our current row
        // the easy case :)
        prinfo.currentRowsCounter += 1;
        callback(true);
      }
    }

    this.getCurrentNodeRep = function _getCurrentNodeRep(pageVar, columnObject){
      var prinfo = pageVar.pageRelations[this.name+"_"+this.id]
      if (prinfo === undefined){ WALconsole.log("Bad!  Shouldn't be calling getCurrentLink on a pageVar for which we haven't yet called getNextRow."); return null; }
      if (prinfo.currentRows === undefined) {WALconsole.log("Bad!  Shouldn't be calling getCurrentLink on a prinfo with no currentRows.", prinfo); return null;}
      if (prinfo.currentRows[prinfo.currentRowsCounter] === undefined) {WALconsole.log("Bad!  Shouldn't be calling getCurrentLink on a prinfo with a currentRowsCounter that doesn't correspond to a row in currentRows.", prinfo); return null;}
      return prinfo.currentRows[prinfo.currentRowsCounter][columnObject.index]; // in the current row, value at the index associated with nodeName
    }

    this.saveToServer = function _saveToServer(){
      // sample: $($.post('http://localhost:3000/saverelation', { relation: {name: "test", url: "www.test2.com/test-test2", selector: "test2", selector_version: 1, num_rows_in_demonstration: 10}, columns: [{name: "col1", xpath: "a[1]/div[1]", suffix: "div[1]"}] } ));
      var rel = ServerTranslationUtilities.JSONifyRelation(this); // note that JSONifyRelation does stable stringification
      $.post('http://kaofang.cs.berkeley.edu:8080/saverelation', {relation: rel});
    }

    var tabReached = false;
    var bestLengthSoFar = 0;
    this.editSelector = function _editSelector(){
      // show the UI for editing the selector
      // we need to open up the new tab that we'll use for showing and editing the relation, and we need to set up a listener to update the selector associated with this relation, based on changes the user makes over at the content script
      tabReached = false;
      bestLengthSoFar = 0;
      chrome.tabs.create({url: this.url, active: true}, function(tab){
        RecorderUI.showRelationEditor(relation, tab.id);
        var sendSelectorInfo = function(){utilities.sendMessage("mainpanel", "content", "editRelation", relation.messageRelationRepresentation(), null, null, [tab.id]);};
        var sendSelectorInfoUntilAnswer = function(){
          sendSelectorInfo(); 
          setTimeout(sendSelectorInfoUntilAnswer, 1000);
        }
        var div = $("#new_script_content");
        var button = $("#page_looks_right");
        button.button();
        button.click(sendSelectorInfoUntilAnswer);
      });
      // now we've sent over the current selector info.  let's set up the listener that will update the preview (and the object)
      utilities.listenForMessageWithKey("content", "mainpanel", "editRelation", "editRelation", function(data){relation.selectorFromContentScript(data)}); // remember this will overwrite previous editRelation listeners, since we're providing a key
    }

    this.selectorFromContentScript = function _selectorFromContentScript(msg){
      tabReached = true;
      if (msg.demonstration_time_relation.length >= bestLengthSoFar){
        bestLengthSoFar = msg.demonstration_time_relation.length;
        this.setNewAttributes(msg.selector, msg.selector_version, msg.exclude_first, msg.columns, msg.demonstration_time_relation, msg.num_rows_in_demo, msg.next_type, msg.next_button_selector);
        RecorderUI.updateDisplayedRelation(this);
        RecorderUI.setColumnColors(msg.colors, msg.columns, msg.tab_id);
      }
    };

    this.clearRunningState = function _clearRunningState(){
      // for relations retrieved from pages, all relation info is stored with pagevar variables, so don't need to do anything
    };
  }

  var NodeSources = {
    RELATIONEXTRACTOR: 1,
    RINGER: 2
  };

  var nodeVariablesCounter = 0;

  pub.NodeVariable = function _NodeVariable(name, recordedNodeRep, recordedNodeSnapshot, imgData, source){
    Revival.addRevivalLabel(this);

    if (!name){
      nodeVariablesCounter += 1;
      name = "thing_" + nodeVariablesCounter;
    }

    this.name = name;
    this.recordedNodeRep = recordedNodeRep;
    this.recordedNodeSnapshot = recordedNodeSnapshot;
    this.imgData = imgData;
    this.nodeSource = source;

    this.toString = function _toString(alreadyBound, pageVar){
      if (alreadyBound === undefined){ alreadyBound = true;} 
      if (alreadyBound){
        return this.name;
      }
      return pageVar.toString()+".<img src='"+this.imgData+"' style='max-height: 150px; max-width: 350px;'>";
    };

    this.getName = function _getName(){
      return this.name;
    }
    this.setName = function _setName(name){
      this.name = name;
    };

    this.recordTimeText = function _recordTimeText(){
      return this.recordedNodeRep.text;
    };
    this.recordTimeLink = function _recordTimeLink(){
      return this.recordedNodeRep.link;
    };
    this.recordTimeXPath = function _recordTimeXPath(){
      return this.recordedNodeRep.xpath;
    };
    this.recordTimeSnapshot = function _recordTimeSnapshot(){
      return this.recordedNodeSnapshot;
    }

    this.setCurrentNodeRep = function _setCurrentNodeRep(environment, nodeRep){
      // todo: should be a better way to get env
      WALconsole.log("setCurrentNodeRep", this.name, nodeRep);
      environment.envBind(this.name, nodeRep);
    };

    this.currentNodeRep = function _currentNodeRep(environment){
      return _.clone(environment.envLookup(this.name)); // don't want to let someone call this and start messing with the enviornment representation, so clone
    };

    this.currentText = function _currentText(environment){
      return this.currentNodeRep(environment).text;
    };
    this.currentLink = function _currentLink(environment){
      return this.currentNodeRep(environment).link;
    };
    this.currentXPath = function _currentXPath(environment){
      return this.currentNodeRep(environment).xpath;
    };

    this.getSource = function _getSource(){
      return this.nodeSource;
    };

    this.requiredFeatures = [];
    this.getRequiredFeatures = function _getRequiredFeatures(){
      return this.requiredFeatures;
    };
    this.setRequiredFeatures = function _setRequiredFeatures(featureSet){
      this.requiredFeatures = featureSet;
    };
    this.requireFeature = function _requireFeature(feature){
      this.requiredFeatures.push(feature);
    };
    this.unrequireFeature = function _unrequireFeature(feature){
      this.requiredFeatures = _.without(this.requiredFeatures, feature);
    };
  };

  function outlier(sortedList, potentialItem){ // note that first arg should be SortedArray not just sorted array
    // for now, difficult to deal with...
    return false;
    if (sortedList.length <= 10) {
      // it's just too soon to know if this is an outlier...
      return false;
    }
    // generous q1, q3
    var q1 = sortedList.get(Math.floor((sortedList.length() / 4)));
    var q3 = sortedList.get(Math.ceil((sortedList.length() * (3 / 4))));
    var iqr = q3 - q1;

    //var minValue = q1 - iqr * 1.5;
    //var maxValue = q3 + iqr * 1.5;
    var minValue = q1 - iqr * 3;
    var maxValue = q3 + iqr * 3;
    WALconsole.log("**************");
    WALconsole.log(sortedList.array);
    WALconsole.log(q1, q3, iqr);
    WALconsole.log(minValue, maxValue);
    WALconsole.log("**************");
    if (potentialItem < minValue || potentialItem > maxValue){
      return true;
    }
    return false;
  }

  pub.PageVariable = function _PageVariable(name, recordTimeUrl){
    Revival.addRevivalLabel(this);

    if (name){ // will sometimes call with undefined, as for revival
      this.name = name;
      this.recordTimeUrl = recordTimeUrl;
      this.pageRelations = {};
    }

    var that = this;

    function freshPageStats(){
      return {numNodes: new SortedArray([])};
    }

    this.setRecordTimeFrameData = function _setRecordTimeFrameData(frameData){
      this.recordTimeFrameData = frameData;
    };

    this.setCurrentTabId = function _setCurrentTabId(tabId, continuation){
      WALconsole.log("setCurrentTabId", tabId);
      this.tabId = tabId;
      this.currentTabIdPageStatsRetrieved = false;
      if (tabId !== undefined){
        utilities.listenForMessageOnce("content", "mainpanel", "pageStats", function(data){
          that.currentTabIdPageStatsRetrieved = true;
          if (that.pageOutlier(data)){
            WALconsole.log("This was an outlier page!");
            var dialogText = "Woah, this page looks very different from what we expected.  We thought we'd get a page that looked like this:";
            if (ReplayScript.prog.mostRecentRow){
              dialogText += "<br>If it's helpful, the last row we scraped looked like this:<br>";
              dialogText += DOMCreationUtilities.arrayOfArraysToTable([ReplayScript.prog.mostRecentRow]).html(); // todo: is this really the best way to acess the most recent row?
            }
            RecorderUI.addDialog("Weird Page", dialogText, 
              {"I've fixed it": function _fixedHandler(){WALconsole.log("I've fixed it."); that.setCurrentTabId(tabId, continuation);}, 
              "That's the right page": function _rightPageHandler(){/* bypass outlier checking */WALconsole.log("That's the right page."); that.nonOutlierProcessing(data, continuation);}});
          }
          else {
            that.nonOutlierProcessing(data, continuation);
          }
        });
        MiscUtilities.repeatUntil(
          function(){utilities.sendMessage("mainpanel", "content", "pageStats", {}, null, null, [tabId], null);}, 
          function(){return that.currentTabIdPageStatsRetrieved;},
	  function(){},
          1000, true);
      }
      else{
        continuation();
      }
    };

    this.clearCurrentTabId = function _clearCurrentTabId(){
      this.tabId = undefined;
    };

    this.nonOutlierProcessing = function _nonOutlierProcessing(pageData, continuation){
      // wasn't an outlier, so let's actually update the pageStats
      this.updatePageStats(pageData);
      continuation();
    }

    this.pageOutlier = function _pageOutlier(pageData){
      return outlier(this.pageStats.numNodes, pageData.numNodes); // in future, maybe just iterate through whatever attributes we have, but not sure yet
    }

    this.updatePageStats = function _updatePageStats(pageData){
      this.pageStats.numNodes.insert(pageData.numNodes); // it's sorted
    }
    
    this.clearRelationData = function _clearRelationData(){
      this.pageRelations = {};
    }

    this.originalTabId = function _originalTabId(){
      WALconsole.log(this.recordTimeFrameData);
      return this.recordTimeFrameData.tab;
    }

    this.currentTabId = function _currentTabId(){
      return this.tabId;
    }

    this.toString = function _toString(){
      return this.name;
    }

    this.clearRunningState = function _clearRunningState(){
      this.tabId = undefined;
      this.pageStats = freshPageStats();
      this.clearRelationData();
    };

    this.pageStats = freshPageStats();

  };

  pub.Concatenate = function _Concatenate(components){
    Revival.addRevivalLabel(this);

    if (components){ // will sometimes call with undefined, as for revival
      this.components = components;
    }

    this.currentText = function _currentText(enviornment){
      var output = "";
      _.each(this.components, function(component){
        if (component instanceof pub.NodeVariable){
          output += component.currentText(enviornment);
        }
        else{
          // this should be a string, since currently can only concat strings and variable uses
          output += component;
        }
      });
      return output;
    }

    this.toString = function _toString(){
      var outputComponents = [];
      _.each(this.components, function(component){
        if (component instanceof pub.NodeVariable){
          outputComponents.push(component.toString());
        }
        else{
          // this should be a string, since currently can only concat strings and variable uses
          outputComponents.push("'"+component+"'");
        }
      });
      return outputComponents.join("+"); 
    }

  }

  // the whole program

  pub.Program = function _Program(statements){
    Revival.addRevivalLabel(this);
    if (statements){ // for revival, statements will be undefined
      this.statements = statements;
      this.relations = [];
      this.pageVars = _.uniq(_.map(_.filter(statements, function(s){return s.pageVar;}), function(statement){return statement.pageVar;}));                                                                                                                                                                                 
      this.loopyStatements = [];  
    }

    var program = this;

    // add an output statement to the end if there are any scrape statements in the program.  should have a list of all scrape statements, treat them as cells in one row
    var scrapeStatements = _.filter(this.statements, function(statement){return statement instanceof WebAutomationLanguage.ScrapeStatement;});
    if (scrapeStatements.length > 0){ this.statements.push(new WebAutomationLanguage.OutputRowStatement(scrapeStatements));}

    this.removeChild = function _removeChild(childStatement){
      this.loopyStatements = _.without(this.loopyStatements, childStatement);
    };
    this.removeChildren = function _removeChild(childStatements){
      this.bodyStatements = _.difference(this.bodyStatements, childStatements);
    };
    this.appendChild = function _appendChild(childStatement){
      var newChildStatements = this.loopyStatements;
      newChildStatements.push(childStatement);
      this.updateChildStatements(newChildStatements);
    };
    this.insertChild = function _appendChild(childStatement, index){
      var newChildStatements = this.loopyStatements;
      newChildStatements.splice(index, 0, childStatement);
      this.updateChildStatements(newChildStatements);
    };

    this.toString = function _toString(){
      var statementLs = this.loopyStatements;
      if (this.loopyStatements.length === 0){
        statementLs = this.statements;
      }
      var scriptString = "";
      _.each(statementLs, function(statement){
        var strLines = statement.toStringLines();
        if (strLines.length > 0){
          scriptString += strLines.join("<br>") + "<br>";
        }});
      return scriptString;
    };

    this.updateBlocklyBlocks = function _updateBlocklyBlocks(){
      // have to update the current set of blocks based on our pageVars, relations, so on

      // this is silly, but just making a new object for each of our statements is an easy way to get access to
      // the updateBlocklyBlock function and still keep it an instance method/right next to the genBlockly function
      for (var prop in pub){
        if (typeof pub[prop] === "function"){
          try{
            var obj = new pub[prop]();
            if (obj.updateBlocklyBlock){
              obj.updateBlocklyBlock(program.pageVars, program.relations)
            };
          }
          catch(err){
            WALconsole.namedLog("updateblocklyblock func creation err", err);
          }
        }
      }

      return;

      WALconsole.log("Running updateBlocklyBlocks", this, this.loopyStatements);
      var updateFunc = function(statement){statement.updateBlocklyBlock(program.pageVars, program.relations);};
      if (this.loopyStatements.length > 0){
        this.traverse(updateFunc); // so let's call updateBlocklyBlock on all statements
      }
      else{
        _.each(this.statements, updateFunc);
      }
    };

    this.displayBlockly = function _displayBlockly(){
      var statementLs = this.loopyStatements;
      if (this.loopyStatements.length === 0){
        statementLs = this.statements;
      }

      // clear out whatever was in there before
      workspace.clear();

      // get the individual statements to produce their corresponding blockly blocks
      var lastBlock = null;
      for (var i = 0; i < statementLs.length; i++){
        var newBlock = statementLs[i].genBlocklyNode(lastBlock);
        if (newBlock !== null){ // handle the fact that there could be null-producing nodes in the middle, and need to connect around those
          lastBlock = newBlock;
        }
      }

      // now go through and actually display all those nodes
      this.traverse(function(statement){
        if (statement.block){
          statement.block.initSvg();
          statement.block.render();
        }
      });

    };

    // a convenient way to traverse the statements of a program
    // todo: currently no way to halt traversal, may ultimately want fn arg to return boolean to do that
    this.traverse = function _traverse(fn, fn2){
      if (fn2 === undefined){
        fn2 = function(){return;};
      }
      if (this.loopyStatements.length < 1){
        WALconsole.warn("Calling traverse on a program even though loopStatements is empty.");
      }
      for (var i = 0; i < this.loopyStatements.length; i++){
        this.loopyStatements[i].traverse(fn, fn2);
      }
    };

    this.getDuplicateDetectionData = function _getDuplicateDetectionData(){
      var loopData = [];
      this.traverse(function(statement){
        if (statement instanceof WebAutomationLanguage.LoopStatement){
          var newLoopItem = {}; // the data we're building up
          newLoopItem.loopStatement = statement;
          var nodeVars = statement.relationNodeVariables();
          var childStatements = statement.getChildren();
          var scrapeChildren = [];
          for (var i = 0; i < childStatements.length; i++){
            var s = childStatements[i];
            if (s instanceof WebAutomationLanguage.ScrapeStatement && !s.scrapingRelationItem()){
              scrapeChildren.push(s);
            }
            else if (s instanceof WebAutomationLanguage.LoopStatement){
              // convention right now, since duplicate detection is for avoiding repeat
              // of unnecessary work, is that we make the judgment based on variables available
              // before any nested loops
              break;
            }
          }
          var scrapeChildrenNodeVars = _.map(scrapeChildren, function(scrapeS){return scrapeS.currentNode;});
          nodeVars = nodeVars.concat(scrapeChildrenNodeVars); // ok, nodeVars now has all our nodes
          newLoopItem.nodeVariables = nodeVars;
          // in addition to just sending along the nodeVar objects, we also want to make the table of values
          var displayData = [[], []];
          for (var i = 0; i < nodeVars.length; i++){
            var nv = nodeVars[i];
            displayData[0].push(nv.getName() + " text");
            displayData[1].push(nv.recordTimeText());
            displayData[0].push(nv.getName() + " link");
            displayData[1].push(nv.recordTimeLink());
          }
          newLoopItem.displayData = displayData;
          loopData.push(newLoopItem);
        }
      });
      return loopData;
    };

    this.getNodesFoundWithSimilarity = function _getNodesFoundWithSimilarity(){
      var nodeData = [];
      this.traverse(function(statement){
        if (statement.currentNode && statement.currentNode instanceof WebAutomationLanguage.NodeVariable && statement.currentNode.getSource() === NodeSources.RINGER){
          //var statementData = {name: statement.currentNode}
          nodeData.push(statement.currentNode);
        }
      });
      return nodeData;
    };

    this.updateChildStatements = function _updateChildStatements(newChildStatements){
      this.loopyStatements = newChildStatements;
      for (var i = 0; i < this.loopyStatements.length; i++){
        this.loopyStatements[i].parent = this;
      }
    }

    // just for replaying the straight-line recording, primarily for debugging
    this.replayOriginal = function _replayOriginal(){
      var trace = [];
      _.each(this.statements, function(statement){trace = trace.concat(statement.cleanTrace);});
      _.each(trace, function(ev){EventM.clearDisplayInfo(ev);}); // strip the display info back out from the event objects

      SimpleRecord.replay(trace, null, function(){WALconsole.log("Done replaying.");});
    };

    function alignRecordTimeAndReplayTimeCompletedEvents(recordTimeTrace, replayTimeTrace){
      // we should see corresponding 'completed' events in the traces
      var recCompleted = _.filter(recordTimeTrace, function(ev){return ev.type === "completed" && ev.data.type === "main_frame" && ev.data.url.indexOf("kaofang.cs.berkeley.edu:8080") < 0;}); // now only doing this for top-level completed events.  will see if this is sufficient
      // have to check for kaofang presence, because otherwise user can screw it up by downloading data in the middle or something like that
      var repCompleted = _.filter(replayTimeTrace, function(ev){return ev.type === "completed" && ev.data.type === "main_frame" && ev.data.url.indexOf("kaofang.cs.berkeley.edu:8080") < 0;});
      WALconsole.log(recCompleted, repCompleted);
      // should have same number of top-level load events.  if not, might be trouble
      if (recCompleted.length !== repCompleted.length){
        WALconsole.log("Different numbers of completed events in record and replay: ", recCompleted, repCompleted);
      }
      // todo: for now aligning solely based on point at which the events appear in the trace.  if we get traces with many events, may need to do something more intelligent
      var smallerLength = recCompleted.length;
      if (repCompleted.length < smallerLength) { smallerLength = repCompleted.length;}
      return [recCompleted.slice(0, smallerLength), repCompleted.slice(0, smallerLength)];
    }

    function updatePageVars(recordTimeTrace, replayTimeTrace, continuation){
      // WALconsole.log("updatePageVars", recordTimeTrace, replayTimeTrace);
      var recordTimeCompletedToReplayTimeCompleted = alignRecordTimeAndReplayTimeCompletedEvents(recordTimeTrace, replayTimeTrace);
      var recEvents = recordTimeCompletedToReplayTimeCompleted[0];
      var repEvents = recordTimeCompletedToReplayTimeCompleted[1];
      // WALconsole.log("recEvents:", recEvents, "repEvents", repEvents);
      updatePageVarsHelper(recEvents, repEvents, 0, continuation);
    }

    function updatePageVarsHelper(recEvents, repEvents, i, continuation){
      if (i >= recEvents.length){
        continuation();
      }
      else{
        var pageVar = EventM.getLoadOutputPageVar(recEvents[i]);
        if (pageVar === undefined){
          updatePageVarsHelper(recEvents, repEvents, i + 1, continuation);
          return;
        }
        // WALconsole.log("Setting pagevar current tab id to:", repEvents[i].data.tabId);
        pageVar.setCurrentTabId(repEvents[i].data.tabId, function(){updatePageVarsHelper(recEvents, repEvents, i + 1, continuation);});
      }
    }

    function tabMappingFromTraces(recordTimeTrace, replayTimeTrace){
      var recordTimeCompletedToReplayTimeCompleted = alignRecordTimeAndReplayTimeCompletedEvents(recordTimeTrace, replayTimeTrace);
      var recEvents = recordTimeCompletedToReplayTimeCompleted[0];
      var repEvents = recordTimeCompletedToReplayTimeCompleted[1];
      var tabIdMapping = {};
      for (var i = 0; i < recEvents.length; i++){
        var recTabId = recEvents[i].data.tabId;
        var repTabId = repEvents[i].data.tabId;
        tabIdMapping[recTabId] = repTabId;
      }
      return tabIdMapping;
    }

/*
    function updatePageVars(recordTimeTrace, replayTimeTrace){
      // we should see corresponding 'completed' events in the traces
      var recCompleted = _.filter(recordTimeTrace, function(ev){return ev.type === "completed" && ev.data.type === "main_frame";}); // now only doing this for top-level completed events.  will see if this is sufficient
      var repCompleted = _.filter(replayTimeTrace, function(ev){return ev.type === "completed" && ev.data.type === "main_frame";});
      WALconsole.log(recCompleted, repCompleted);
      // should have same number of top-level load events.  if not, might be trouble
      if (recCompleted.length !== repCompleted.length){
        WALconsole.log("Different numbers of completed events in record and replay: ", recCompleted, repCompleted);
      }
      // todo: for now aligning solely based on point at which the events appear in the trace.  if we get traces with many events, may need to do something more intelligent
      var smallerLength = recCompleted.length;
      if (repCompleted.length < smallerLength) { smallerLength = repCompleted.length;}
      for (var i = 0; i < smallerLength; i++){
        var pageVar = EventM.getLoadOutputPageVar(recCompleted[i]);
        if (pageVar === undefined){
          continue;
        }
        pageVar.setCurrentTabId(repCompleted[i].data.tabId);
      }
    }
    */

    function ringerBased(statement){
      return (statement instanceof WebAutomationLanguage.LoadStatement
                || statement instanceof WebAutomationLanguage.ClickStatement
                || statement instanceof WebAutomationLanguage.ScrapeStatement
                || statement instanceof WebAutomationLanguage.TypeStatement
                || statement instanceof WebAutomationLanguage.OutputRowStatement);
    }

    this.runBasicBlock = function _runBasicBlock(runObject, loopyStatements, callback, options){
      if (options === undefined){options = {};}
      var skipMode = options.skipMode;
      if (skipMode === undefined){ skipMode = false; }
      var ignoreEntityScope = options.ignoreEntityScope;
      var breakMode = options.breakMode;
      if (breakMode === undefined){ breakMode = false; }
      if (ignoreEntityScope === undefined){ ignoreEntityScope = false; }
      WALconsole.namedLog("rbb", loopyStatements.length, loopyStatements);
      // first check if we're supposed to pause, stop execution if yes
      WALconsole.namedLog("rbb", "runObject.userPaused", runObject.userPaused);
      if (runObject.userPaused){
        runObject.resumeContinuation = function(){program.runBasicBlock(runObject, loopyStatements, callback, options);};
        WALconsole.log("paused");
        return;
      }
      WALconsole.log("runObject.userStopped", runObject.userStopped);
      if (runObject.userStopped){
        WALconsole.log("run stopped");
        runObject.userStopped = false; // set it back so that if the user goes to run again, everything will work
        return;
      }

      if (loopyStatements.length < 1){
        WALconsole.namedLog("rbb", "rbb: empty loopystatments.");
        callback(options);
        return;
      }
      // for now LoopStatement gets special processing
      else if (loopyStatements[0] instanceof WebAutomationLanguage.LoopStatement){
        if (skipMode){
          // in this case, when we're basically 'continue'ing, it's as if this loop is empty, so skip straight to that
          program.runBasicBlock(runObject, loopyStatements.slice(1, loopyStatements.length), callback, options);
          return;
        }
        WALconsole.namedLog("rbb", "rbb: loop.");

        var loopStatement = loopyStatements[0];
        var relation = loopStatement.relation;

        function cleanupAfterLoopEnd(){
          loopStatement.rowsSoFar = 0;

          // time to run end-of-loop-cleanup on the various bodyStatements
          loopStatement.traverse(function(statement){
            if (statement.endOfLoopCleanup){
              statement.endOfLoopCleanup();
            }
          }, function(){});
        }

        // are we actually breaking out of the loop?
        if (breakMode){
          WALconsole.warn("breaking out of the loop");
          options.breakMode = false; // if we were in break mode, we're done w loop, so turn off break mode
          cleanupAfterLoopEnd();
          // once we're done with the loop, have to replay the remainder of the script
          program.runBasicBlock(runObject, loopyStatements.slice(1, loopyStatements.length), callback, options);
          return;
        }

        // have we hit the maximum number of iterations we want to do?
        if (loopStatement.maxRows !== null && loopStatement.rowsSoFar >= loopStatement.maxRows){
          // hey, we're done!
          WALconsole.namedLog("rbb", "hit the row limit");
          cleanupAfterLoopEnd();
          // once we're done with the loop, have to replay the remainder of the script
          program.runBasicBlock(runObject, loopyStatements.slice(1, loopyStatements.length), callback, options);
          return;
        }

        // if we're going to simulate an error at any point, is this the point?
        if (options.simulateError){
          var targetIterations = options.simulateError;
          var currentIterations = getLoopIterationCounters(loopStatement); // gets the iterations of this loop and any ancestor loops
          // first make sure we're actually on the right loop.  no need to check if we're still on the outermost loop but breaking in the innermost
          if (currentIterations.length >= targetIterations.length){
            // ok, that last loop is the one we're about to run, including upping the rowsSoFar counter, so up that now.  no need to fetch row if we're supposed to error now
            currentIterations[currentIterations.length - 1] = currentIterations[currentIterations.length - 1] + 1;
            // now that we know we're at the right loop or deeper, let's check...
            var timeToError = true;
            for (var i = 0; i < targetIterations.length; i++){
              if (currentIterations[i] > targetIterations[i]){
                timeToError = true; // ok, it's time.  need this case if we never hit the iteration on an inner loop, so we do the error at the start of the next loop
                break;
              }
              if (currentIterations[i] < targetIterations[i]){
                timeToError = false; // ok, we're not there yet
                break;
              }
              // if it's equal, check the next nested loop
            }
            // at this point, only if all loops were greater than or equal to the target number of iterations will timeToError be true
            if (timeToError){
              // remember, when we rerun, don't error anymore!  don't want an infinite loop.
              options.simulateError = false;
              // first close the old dataset object in order to flush all its data to the server
              runObject.dataset.closeDataset();
              // now restart
              // all other options should be the same, except that we shouldn't simulate the error anymore and must make sure to use the same dataset
              options.dataset_id = runObject.dataset.id;
              runObject.program.run(options); 
              return; // don't run any of the callbacks for this old run!  we're done with it!
            }
          }
        }

        loopStatement.relation.getNextRow(loopStatement.pageVar, function(moreRows){
          if (!moreRows){
            // hey, we're done!
            WALconsole.namedLog("rbb", "no more rows");
            cleanupAfterLoopEnd();
            // once we're done with the loop, have to replay the remainder of the script
            program.runBasicBlock(runObject, loopyStatements.slice(1, loopyStatements.length), callback, options);
            return;
          }
          WALconsole.namedLog("rbb", "we have a row!  let's run");
          // otherwise, should actually run the body
          loopStatement.rowsSoFar += 1;
          // block scope.  let's add a new frame
          runObject.environment = runObject.environment.envExtend(); // add a new frame on there
          WALconsole.namedLog("rbb", "envExtend done");
          // and let's give us access to all the loop variables
          // note that for now loopVarsMap includes all columns of the relation.  may some day want to limit it to only the ones used...
          loopStatement.updateRelationNodeVariables(runObject.environment);
          WALconsole.namedLog("rbb", "loopyStatements", loopyStatements);
          program.runBasicBlock(runObject, loopStatement.bodyStatements, function(){ // running extra iterations of the for loop is the only time we change the callback
            // and once we've run the body, we should do the next iteration of the loop
            // but first let's get rid of that last environment frame
            WALconsole.namedLog("rbb", "rbb: preparing for next loop iteration, popping frame off environment.");
            runObject.environment = runObject.environment.parent;
            // for the next iteration, we'll be back out of skipMode if we were in skipMode
            // and let's run loop cleanup, since we actually ran the body statements
            // we don't skip things in the cleanup, so time to swap those off
            options.skipMode = false;
            options.skipCommitInThisIteration = false;

            // the main way we clean up is by running the cleanupStatements
            program.runBasicBlock(runObject, loopStatement.cleanupStatements, function(){
              // and once we've done that loop body cleanup, then let's finally go ahead and go back to do the loop again!
              WALconsole.namedLog("rbb", "Post-cleanupstatements.")
              program.runBasicBlock(runObject, loopyStatements, callback, options); 
            }, options);
          }, options);
        });
        return;
      }
      // also need special processing for back statements, if statements, continue statements, whatever isn't ringer-based
      else if (!ringerBased(loopyStatements[0])){
        WALconsole.namedLog("rbb", "rbb: non-Ringer-based statement.");

        if (skipMode || breakMode){
          // in this case, when we're basically 'continue'ing, we should do nothing
          program.runBasicBlock(runObject, loopyStatements.slice(1, loopyStatements.length), callback, options);
          return;
        }

        // normal execution, either because we're not in skipMode, or because we are but it's a back or a close
        var continuation = function(rbboptions){ 
        // remember that rbbcontinuations passed to run methods must always handle rbboptions
        // rbboptions includes skipMode to indicate whether we're continuing
          // once we're done with this statement running, have to replay the remainder of the script
          program.runBasicBlock(runObject, loopyStatements.slice(1, loopyStatements.length), callback, rbboptions);
        };
        loopyStatements[0].run(runObject, continuation, options);
        return;
      }
      else {
        WALconsole.namedLog("rbb", "rbb: r+r.");
        // the fun stuff!  we get to run a basic block with the r+r layer
        var basicBlockStatements = [];
        var nextBlockStartIndex = loopyStatements.length;
        for (var i = 0; i < loopyStatements.length; i++){
          if (!ringerBased(loopyStatements[i])){ // todo: is this the right condition?
            nextBlockStartIndex = i;
            break;
          }
          basicBlockStatements.push(loopyStatements[i]);
        }

        if (skipMode || breakMode){
          // in this case, when we're basically 'continue'ing, we should do nothing, so just go on to the next statement without doing anything else
          program.runBasicBlock(runObject, loopyStatements.slice(nextBlockStartIndex, loopyStatements.length), callback, options);
          return;
        }

        if (nextBlockStartIndex === 0){
          WALconsole.namedLog("rbb", "nextBlockStartIndex was 0!  this shouldn't happen!", loopyStatements);
          throw("nextBlockStartIndex 0");
        }

        basicBlockStatements = markNonTraceContributingStatements(basicBlockStatements);

        var haveAllNecessaryRelationNodes = doWeHaveRealRelationNodesWhereNecessary(basicBlockStatements, runObject.environment);
        if (!haveAllNecessaryRelationNodes){
          // ok, we're going to have to skip this iteration, because we're supposed to open a page and we just won't know how to
          WALconsole.warn("Had to skip an iteration because of lacking the node we'd need to open a new page");
          // todo: should probably also warn the contents of the various relation variables at this iteration that we're skipping

          // we're essentially done 'replaying', have to replay the remainder of the script
          // and we're doing continue, so set the continue flag to true
          options.skipMode = true;
          program.runBasicBlock(runObject, loopyStatements.slice(nextBlockStartIndex, loopyStatements.length), callback, options);
          return;
        }

        // make the trace we'll replay
        var trace = [];
        // label each trace item with the basicBlock statement being used
        var withinScrapeSection = false;
        for (var i = 0; i < basicBlockStatements.length; i++){

          var cleanTrace = basicBlockStatements[i].cleanTrace;

          // first let's figure out whether we're even doing anything with this statement
          if (basicBlockStatements[i].contributesTrace === TraceContributions.NONE){
            continue; // don't need this one.  just skip
          }
          else if (basicBlockStatements[i].contributesTrace === TraceContributions.FOCUS){
            // let's just change the cleanTrace so that it only grabs the focus events
            console.log("Warning: we're including a focus event, which might cause problems.  If you see weird behavior, check this first.");
            cleanTrace = _.filter(cleanTrace, function(ev){return ev.data.type === "focus";});
          }

          _.each(cleanTrace, function(ev){EventM.setTemporaryStatementIdentifier(ev, i);});

          // ok, now let's deal with speeding up the trace based on knowing that scraping shouldn't change stuff, so we don't need to wait after it
          if (withinScrapeSection){
            // don't need to wait after scraping.  scraping doesn't change stuff.
            if (cleanTrace.length > 0){
              cleanTrace[0].timing.ignoreWait = true;
            }
          }
          if (basicBlockStatements[i] instanceof WebAutomationLanguage.ScrapeStatement){
            withinScrapeSection = true;
            for (var j = 1; j < cleanTrace.length; j++){cleanTrace[j].timing.ignoreWait = true;} // the first event may need to wait after whatever came before
          }
          else{
            withinScrapeSection = false;
          }

          trace = trace.concat(cleanTrace);
        }

        if (trace.length < 1){
          // ok, no point actually running Ringer here...
          // console.log("no events for r+r to run in these loopyStatements: ", loopyStatements);
          // let's skip straight to the 'callback!'

          // statements may need to do something as post-processing, even without a replay so go ahead and do any extra processing
          for (var i = 0; i < basicBlockStatements.length; i++){
            WALconsole.namedLog("rbb", "calling postReplayProcessing on", basicBlockStatements[i]);
            basicBlockStatements[i].postReplayProcessing(runObject, [], i);
          }
          // once we're done replaying, have to replay the remainder of the script
          program.runBasicBlock(runObject, loopyStatements.slice(nextBlockStartIndex, loopyStatements.length), callback, options);
          return;
        }

        // now that we have the trace, let's figure out how to parameterize it
        // note that this should only be run once the current___ variables in the statements have been updated!  otherwise won't know what needs to be parameterized, will assume nothing
        // should see in future whether this is a reasonable way to do it
        WALconsole.namedLog("rbb", "trace", trace);
        var parameterizedTrace = pbv(trace, basicBlockStatements);
        // now that we've run parameterization-by-value, have a function, let's put in the arguments we need for the current run
        WALconsole.namedLog("rbb", "parameterizedTrace", parameterizedTrace);
        var runnableTrace = passArguments(parameterizedTrace, basicBlockStatements, runObject.environment);
        var config = parameterizedTrace.getConfig();
        WALconsole.namedLog("rbb", "runnableTrace", runnableTrace);

        // the above works because we've already put in VariableUses for statement arguments that use relation items, for all statements within a loop, so currNode for those statements will be a variableuse that uses the relation
        // however, because we're only running these basic blocks, any uses of relation items (in invisible events) that happen before the for loop will not get parameterized, 
        // since their statement arguments won't be changed, and they won't be part of the trace that does have statement arguments changed (and thus get the whole trace parameterized for that)
        // I don't see right now how this could cause issues, but it's worth thinking about

        WALconsole.namedLog("rbb", "runnableTrace", runnableTrace, config);

        config.targetWindowId = runObject.window;
        SimpleRecord.replay(runnableTrace, config, function(replayObject){
          // use what we've observed in the replay to update page variables
          WALconsole.namedLog("rbb", "replayObject", replayObject);

          // based on the replay object, we need to update any pagevars involved in the trace;
          var trace = [];
          _.each(basicBlockStatements, function(statement){trace = trace.concat(statement.trace);}); // want the trace with display data, not the clean trace
          
          //updatePageVars(trace, replayObject.record.events);
          // ok, it's time to update the pageVars, but remember that's going to involve checking whether we got a reasonable page
          var allPageVarsOk = function(){
            // statements may need to do something based on this trace, so go ahead and do any extra processing
            for (var i = 0; i < basicBlockStatements.length; i++){
              WALconsole.namedLog("rbb", "calling postReplayProcessing on", basicBlockStatements[i]);
              basicBlockStatements[i].postReplayProcessing(runObject, replayObject.record.events, i);
            }

            // once we're done replaying, have to replay the remainder of the script
            program.runBasicBlock(runObject, loopyStatements.slice(nextBlockStartIndex, loopyStatements.length), callback, options);
          };
          updatePageVars(trace, replayObject.record.events, allPageVarsOk);

        },
        // ok, we also want some error handling functions
        {
          nodeFindingWithUserRequiredFeaturesFailure: function(replayObject, ringerContinuation){
            // todo: note that continuation doesn't actually have a continuation yet because of Ringer-level implementation
            // if you decide to start using it, you'll have to go back and fix that.  see record-replay/mainpanel_main.js

            // for now, if we fail to find a node where the user has insisted it has a certain set of features, we want to just skip the row
            // essentially want the continue action, so we want the callback that's supposed to happen at the end of running the rest of the script for this iteration
            // so we'll skip doing  program.runBasicBlock(loopyStatements.slice(nextBlockStartIndex, loopyStatements.length), callback) (as above)
            // instead we'll just do the callback
            WALconsole.warn("rbb: couldn't find a node based on user-required features.  skipping the rest of this row.");

            // even though couldn't complete the whole trace, still need to do updatePageVars because that's how we figure out which
            // tab is associated with which pagevar, so that we can go ahead and do tab closing and back button pressing at the end
            
            var allPageVarsOk = function(){ // this is partly the same as the other allPageVarsOk
              // in the continuation, we'll do the actual move onto the next statement
              options.skipMode = true;
              //options.skipCommitInThisIteration = true; // for now we'll assume that this means we'd want to try again in future in case something new is added

              // once we're done replaying, have to replay the remainder of the script
              // want to skip the rest of the loop body, so go straight to callback
              callback();
            };

            var trace = [];
            _.each(basicBlockStatements, function(statement){trace = trace.concat(statement.trace);}); // want the trace with display data, not the clean trace
            updatePageVars(trace, replayObject.record.events, allPageVarsOk);
          },
          portFailure: function(replayObject, ringerContinuation){
            // for now I haven't seen enough of these failures in person to know a good way to fix them
            // for now just treat them like a node finding failure and continue

            WALconsole.warn("rbb: port failure.  ugh.");

            // even though couldn't complete the whole trace, still need to do updatePageVars because that's how we figure out which
            // tab is associated with which pagevar, so that we can go ahead and do tab closing and back button pressing at the end
            
            var allPageVarsOk = function(){ // this is partly the same as the other allPageVarsOk
              // in the continuation, we'll do the actual move onto the next statement
              options.skipMode = true;
              //options.skipCommitInThisIteration = true; // for now we'll assume that this means we'd want to try again in future in case something new is added

              // once we're done replaying, have to replay the remainder of the script
              // want to skip the rest of the loop body, so go straight to callback
              callback();
            };

            var trace = [];
            _.each(basicBlockStatements, function(statement){trace = trace.concat(statement.trace);}); // want the trace with display data, not the clean trace
            updatePageVars(trace, replayObject.record.events, allPageVarsOk);
          }
        }
        );
      }
    }

    function runInternals(program, dataset, options, continuation){

      // first let's make the runObject that we'll use for all the rest
      // for now the below is commented out to save memory, since only running one per instance
	    //var programCopy = Clone.cloneProgram(program); // must clone so that run-specific state can be saved with relations and so on
      var runObject = {program: program, dataset: dataset, environment: Environment.envRoot()};
      var tab = RecorderUI.newRunTab(runObject); // the mainpanel tab in which we'll preview stuff
      runObject.tab = tab;

      runObject.program.clearRunningState();
      runObject.program.prepareToRun();
      // ok let's do this in a fresh window
      MiscUtilities.makeNewRecordReplayWindow(function(windowId){
        // now let's actually run
        recordingWindowIds.push(windowId);
        runObject.window = windowId;
        datasetsScraped.push(runObject.dataset.id);
        runObject.program.runBasicBlock(runObject, runObject.program.loopyStatements, function(){
          runObject.dataset.closeDataset();

          function whatToDoWhenWereDone(){
            scrapingRunsCompleted += 1;
            console.log("scrapingRunsCompleted", scrapingRunsCompleted);
            WALconsole.log("Done with script execution.");
            var timeScraped = (new Date()).getTime() - parseInt(dataset.pass_start_time);
            console.log(runObject.dataset.id, timeScraped);
            recordingWindowIds = _.without(recordingWindowIds, windowId); // take that window back out of the allowable recording set
            // if there was a continuation provided for when we're done, do it
            if (continuation){
              continuation(runObject.dataset, timeScraped);
            }
          }

          // ok, now keep in mind we're not truly finished until all our data is stored, which means the dataset must have no outstanding requests
          runObject.dataset.outstandingDataSaveRequests
          MiscUtilities.repeatUntil(
            function(){}, // repeatFunc is nothing.  just wait
            function(){return runObject.dataset.outstandingDataSaveRequests === 0;}, 
            whatToDoWhenWereDone, 
            1000, false);

        }, options);
      });
    }

    function adjustDatasetNameForOptions(dataset, options){
      if (options.ignoreEntityScope){
        dataset.appendToName("_ignoreEntityScope");
      }
      if (options.nameAddition){
        dataset.appendToName(options.nameAddition); // just for scripts that want more control of how it's saved
      }
    }

    var internalOptions = ["skipMode", "breakMode", "skipCommitInThisIteration"]; // wonder if these shouldn't be moved to runObject instead of options.  yeah.  should do that.
    var recognizedOptions = ["dataset_id", "ignoreEntityScope", "breakAfterXDuplicatesInARow", "nameAddition", "simulateError"];
    this.run = function _run(options, continuation){
      if (options === undefined){options = {};}
      for (var prop in options){
        if (recognizedOptions.indexOf(prop) < 0){
          // woah, bad, someone thinks they're providing an option that will affect us, but we don't know what to do with it
          // don't let them think everything's ok, especially since they probably just mispelled
          WALconsole.warn("Woah, woah, woah.  Tried to provide option " + prop + " to program run, but we don't know what to do with it.");
          if (internalOptions.indexOf(prop) > -1){
            // ok, well an internal prop sneaking in is ok, so we'll just provide a warning.  otherwise we're actually going to stop
            WALconsole.warn("Ok, we're allowing it because it's an internal option, but we're not happy about it and we're setting it to false.");
	    options.prop = false;
          }
          else{
            return;
          }
        }
      }
      if (options.dataset_id){
        // no need to make a new dataset
        var dataset = new OutputHandler.Dataset(program, options.dataset_id);
        runInternals(this, dataset, options, continuation);
      }
      else{
        // ok, have to make a new dataset
        var dataset = new OutputHandler.Dataset(program);
        // it's really annoying to go on without having an id, so let's wait till we have one
        MiscUtilities.repeatUntil(
          function(){}, 
    		  function(){return dataset.isReady();},
    		  function(){
    		      adjustDatasetNameForOptions(dataset, options);
    		      runInternals(program, dataset, options, continuation);
    		  },
    		  1000, true
        );
      }
    };

    this.restartFromBeginning = function _restartFromBeginning(runObjectOld){
      // basically same as above, but store to the same dataset (for now, dataset id also controls which saved annotations we're looking at)
      runObjectOld.program.run({dataset_id: runObjectOld.dataset.id});
    };

    this.stopRunning = function _stopRunning(runObject){
      if (!runObject.userPaused){
        // don't need to stop continuation chain unless it's currently going; if paused, isn't going, stopping flag won't get turned off and will prevent us from replaying later
        runObject.userStopped = true; // this will stop the continuation chain
      }
      // should we even bother saving the data?
      runObject.dataset.closeDataset();
      this.clearRunningState();
      SimpleRecord.stopReplay(); // todo: is current (new) stopReplay enough to make sure that when we try to run the script again, it will start up correctly?
    };

    this.clearRunningState = function _clearRunningState(){
      _.each(this.relations, function(relation){relation.clearRunningState();});
      _.each(this.pageVars, function(pageVar){pageVar.clearRunningState();});
      this.traverse(function(statement){statement.clearRunningState();});
    };

    this.prepareToRun = function _prepareToRun(){
      this.traverse(function(statement){statement.prepareToRun();});
    };

    function paramName(statementIndex, paramType){ // assumes we can't have more than one of a single paramtype from a single statement.  should be true
      return "s"+statementIndex+"_"+paramType;
    }

    function pbv(trace, statements){
      var pTrace = new ParameterizedTrace(trace);

      for (var i = 0; i < statements.length; i++){
        var statement = statements[i];
        var pbvs = statement.pbvs();
        WALconsole.log("pbvs", pbvs);
        for (var j = 0; j < pbvs.length; j++){
          var currPbv = pbvs[j];
          var pname = paramName(i, currPbv.type);
          if (currPbv.type === "url"){
            pTrace.parameterizeUrl(pname, currPbv.value);
          }
          else if (currPbv.type === "node"){
            pTrace.parameterizeXpath(pname, currPbv.value);
          }
          else if (currPbv.type === "typedString"){
            pTrace.parameterizeTypedString(pname, currPbv.value);
          }
          else if (currPbv.type === "tab"){
            pTrace.parameterizeTab(pname, currPbv.value);
          }
          else if (currPbv.type === "frame"){
            pTrace.parameterizeFrame(pname, currPbv.value);
          }
          else{
            WALconsole.log("Tried to do pbv on a type we don't know.");
          }
        }
      }
      return pTrace;
    }

    var wrapperNodeCounter = 0;
    function parameterizeWrapperNodes(pTrace, origXpath, newXpath){
      // todo: should we do something to exempt xpaths that are already being parameterized based on other relation elements?
      // for now this is irrelevant because we'll come to the same conclusion  because of using fixed suffixes, but could imagine different approach later
      var origSegs = origXpath.split("/");
      var newSegs = newXpath.split("/");
      if (origSegs.length !== newSegs.length){ WALconsole.log("origSegs and newSegs different length!", origXpath, newXpath); }
      for (var i = 0; i < origSegs.length; i++){ // assumption: origSegs and newSegs have same length; we'll see
        if (origSegs[origSegs.length - 1 - i] === newSegs[newSegs.length - 1 - i]){
          // still match
          // we do need the last segment ot match, but the one that goes all the way to the last segment is the one that inspired this
          // so we don't need to param the last one again, but we do need to param the one prior, even if it doesn't match
          // (the first one that doesn't match should still be parameterized)
          // a1/b1/c1/a1/a1/a1 -> d1/e1/f1/a2/a1/a1 original already done;  we should do a1/b1/c1/a1/a1 -> d1/e1/f1/a2/a1, a1/b1/c1/a1 -> d1/e1/f1/a2
          var origXpathPrefix = origSegs.slice(0,origSegs.length - 1 - i).join("/");
          var newXpathPrefix = newSegs.slice(0,newSegs.length - 1 - i).join("/");
          var pname = "wrappernode_"+wrapperNodeCounter;
          wrapperNodeCounter += 1;
          pTrace.parameterizeXpath(pname, origXpathPrefix);
          pTrace.useXpath(pname, newXpathPrefix);
          WALconsole.log("Wrapper node correction:");
          WALconsole.log(origXpathPrefix);
          WALconsole.log(newXpathPrefix);
        }
        else {
          // this one is now diff, so shouldn't do replacement for the one further
          // (shouldn't do a1/b1/c1 -> d1/e1/f1 from example above)
          // I mean, maybe we actually should do this, but not currently a reason to think it will be useful.  worth considering though
          break;
        }
      }
    }

    function passArguments(pTrace, statements, environment){
      for (var i = 0; i < statements.length; i++){
        var statement = statements[i];
        var args = statement.args(environment);
        for (var j = 0; j < args.length; j++){
          var currArg = args[j];
          var pname = paramName(i, currArg.type);
          if (currArg.type === "url"){
            pTrace.useUrl(pname, currArg.value);
          }
          else if (currArg.type === "node"){
            pTrace.useXpath(pname, currArg.value);
            // the below is kind of gross and I don't know if this is really where it should happen, but we definitely want to parameterize wrapper nodes
            // todo: maybe find a cleaner, nice place to put this or write this.  for now this should do the trick
            parameterizeWrapperNodes(pTrace, statement.node, currArg.value);
          }
          else if (currArg.type === "typedString"){
            pTrace.useTypedString(pname, currArg.value);
          }
          else if (currArg.type === "tab"){
            pTrace.useTab(pname, currArg.value);
          }
          else if (currArg.type === "frame"){
            pTrace.useFrame(pname, currArg.value);
          }
          else{
            WALconsole.log("Tried to do pbv on a type we don't know. (Arg provision.)");
          }
        }
      }
      return pTrace.getStandardTrace();
    }

    function longestCommonPrefix(strings) {
      if (strings.length < 1) {
        return "";
      }
      if (strings.length == 1){
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
    }

    var pagesToNodes = {};
    var pagesToUrls = {};
    var pagesProcessed = {};
    var pagesToFrameUrls = {};
    var pagesToFrames = {};
    this.relevantRelations = function _relevantRelations(){
      // ok, at this point we know the urls we've used and the xpaths we've used on them
      // we should ask the server for relations that might help us out
      // when the server gets back to us, we should try those relations on the current page
      // we'll compare those against the best we can create on the page right now, pick the winner

      // get the xpaths used on the urls
      // todo: right now we're doing this on a page by page basis, splitting into assuming it's one first row per page (tab)...
      // but it should really probably be per-frame, not per tab
      for (var i = 0; i < this.statements.length; i++){
        var s = this.statements[i];
        if ( (s instanceof WebAutomationLanguage.ScrapeStatement) || (s instanceof WebAutomationLanguage.ClickStatement) ){
          var xpath = s.node; // todo: in future, should get the whole node info, not just the xpath, but this is sufficient for now
          var pageVarName = s.pageVar.name; // pagevar is better than url for helping us figure out what was on a given logical page
          var url = s.pageVar.recordTimeUrl;
          var frameUrl = s.trace[0].frame.URL;
          var frameId = s.trace[0].frame.iframeIndex;

          if (!(pageVarName in pagesToNodes)){ pagesToNodes[pageVarName] = []; }
          if (pagesToNodes[pageVarName].indexOf(xpath) === -1){ pagesToNodes[pageVarName].push(xpath); }

          if (!(pageVarName in pagesToFrameUrls)){ pagesToFrameUrls[pageVarName] = []; }
          pagesToFrameUrls[pageVarName].push(frameUrl);

          if (!(pageVarName in pagesToFrames)){ pagesToFrames[pageVarName] = []; }
          pagesToFrames[pageVarName].push(frameId);

          pagesToUrls[pageVarName] = url;
        }
      }
      // ask the server for relations
      // sample: $($.post('http://localhost:3000/retrieverelations', { pages: [{xpaths: ["a[1]/div[2]"], url: "www.test2.com/test-test"}] }, function(resp){ WALconsole.log(resp);} ));
      var reqList = [];
      for (var pageVarName in pagesToNodes){
        reqList.push({url: pagesToUrls[pageVarName], xpaths: pagesToNodes[pageVarName], page_var_name: pageVarName, frame_ids: pagesToFrames[pageVarName]});

      }
      var that = this;
      $.post('http://kaofang.cs.berkeley.edu:8080/retrieverelations', { pages: reqList }, function(resp){that.processServerRelations(resp);});
    }

    function isScrapingSet(keyCodes){
      var charsDict = {SHIFT: 16, CTRL: 17, ALT: 18, CMD: 91};
      keyCodes.sort();
      var acceptableSets = [
        [charsDict.ALT], // mac scraping
        [charsDict.CTRL, charsDict.ALT], // unix scraping
        [charsDict.ALT, charsDict.SHIFT], // mac link scraping
        [charsDict.CTRL, charsDict.ALT, charsDict.SHIFT] // unix link scraping
      ];
      for (var i = 0; i < acceptableSets.length; i++){
        acceptableSet = acceptableSets[i];
        acceptableSet.sort();
        if (_.isEqual(keyCodes, acceptableSet)){
          return true;
        }
      }
      // nope, none of them are the right set
      return false;
    }

    var TraceContributions = {
      NONE: 0,
      FOCUS: 1
    };

    function sameNodeIsNextUsed(statement, statements){
      WALconsole.log("sameNodeIsNextUsed", statement, statements);
      if (!statement.origNode){ // there's no node associated with the first arg
        console.log("Warning!  No node associated with the statement, which may mean there was an earlier statement that we should have called on.");
        return false;
      }
      for (var i = 0; i < statements.length; i++){
        if (statements[i].origNode === statement.origNode) {
          return true;
        }
        if (statements[i] instanceof WebAutomationLanguage.ClickStatement){ // || statements[i] instanceof WebAutomationLanguage.ScrapeStatement){
          // ok, we found another statement that focuses a node, but it's a different node
          // todo: is this the right condition?  certainly TypeStatements don't always have the same origNode as the focus event that came immediately before
          return false;
        }
      }
      // we've run out
      return false;
    }

    function doWeHaveRealRelationNodesWhereNecessary(statements, environment){
      for (var i = 0; i < statements.length; i++){
        var s = statements[i];
        if (s.outputPageVars && s.outputPageVars.length > 0){
          // ok, this is an interaction where we should be opening a new page based on the statement
          if (s.columnObj){
            // if the statement is parameterized with the column object of a given relation, this will be non-null
            // also, it means the statement's currentNode will be a NodeVariable, so we can call currentXPath
            // also it means we'll already have assigned to the node variable, so currentXPath should actually have a value
            var currentXpath = s.currentNode.currentXPath(environment);
            if (currentXpath){
              continue;
            }
            return false; // we've found a statement for which we'll want to use a node to produce a new page, but we won't have one
          }
        }
      }
      return true;
    }

    function markNonTraceContributingStatements(statements){
      // if we ever get a sequence within the statements that's a keydown statement, then only scraping statements, then a keyup, assume we can toss the keyup and keydown ones

      WALconsole.log("markNonTraceContributingStatements", statements);
      var keyIndexes = [];
      var keysdown = [];
      var keysup = [];
      var sets = [];
      for (var i = 0; i < statements.length; i++){
        if (statements[i] instanceof WebAutomationLanguage.TypeStatement && statements[i].onlyKeydowns){
          keyIndexes.push(i);
          keysdown = keysdown.concat(statements[i].keyCodes);
        }
        else if (keyIndexes.length > 0 && statements[i] instanceof WebAutomationLanguage.ScrapeStatement && statements[i].scrapingRelationItem()){
          continue;
        }
        else if (keyIndexes.length > 0 && statements[i] instanceof WebAutomationLanguage.TypeStatement && statements[i].onlyKeyups){
          keyIndexes.push(i);
          keysup = keysup.concat(statements[i].keyCodes);

          // ok, do the keysdown and keysup arrays have the same elements (possibly including repeats), just reordered?
          // todo: is this a strong enough condition?
          keysdown.sort();
          keysup.sort();
          if (_.isEqual(keysdown, keysup) && isScrapingSet(keysdown)) {
            WALconsole.log("decided to remove set", keyIndexes, keysdown);
            sets.push(keyIndexes);
            keyIndexes = [];
            keysdown = [];
            keysup = [];
          }
        }
        else if (keyIndexes.length > 0 && !(statements[i] instanceof WebAutomationLanguage.ScrapeStatement && statements[i].scrapingRelationItem())){
          keyIndexes = [];
          keysdown = [];
          keysup = [];
        }
      }
      // ok, for now we're only going to get rid of the keydown and keyup statements
      // they're in sets because may ultimately want to try manipulating scraping statements in the middle if they don't have dom events (as when relation parameterized)
      // but for now we'll stick with this

      for (var i = 0; i < sets.length; i++){
        var set = sets[i];

        // let's ignore the events associated with all of these statements!
        for (var j = set[0]; j < set[set.length -1] + 1; j++){
          var statement = statements[j];
          statement.contributesTrace = TraceContributions.NONE;
        }
        // ok, one exception.  sometimes the last relation scraping statement interacts with the same node that we'll use immediately after scraping stops
        // in these cases, during record, the focus was shifted to the correct node during scraping, but the replay won't shift focus unless we replay that focus event
        // so we'd better replay that focus event
        var keyupIndex = set[set.length - 1];
        if (sameNodeIsNextUsed(statements[keyupIndex - 1], statements.slice(keyupIndex + 1, statements.length))){
          // is it ok to restrict it to only statements replayed immediately after?  rather than in a for loop that's coming up or whatever?
          // it's definitely ok while we're only using our own inserted for loops, since those get inserted where we start using a new node
          var lastStatementBeforeKeyup = statements[keyupIndex - 1];
          WALconsole.log("lastStatementBeforeKeyup", lastStatementBeforeKeyup);
          lastStatementBeforeKeyup.contributesTrace = TraceContributions.FOCUS;
          // let's make sure to make the state match the state it should have, based on no longer having these keypresses around
          var cleanTrace = lastStatementBeforeKeyup.cleanTrace;
          _.each(cleanTrace, function(ev){if (ev.data.ctrlKey){ev.data.ctrlKey = false;}}); // right now hard coded to get rid of ctrl alt every time.  todo: fix
          _.each(cleanTrace, function(ev){if (ev.data.altKey){ev.data.altKey = false;}});
        }

        /* an alternative that removes keyup, keydown events instead of the whole statements
        for (var j = set.length - 1; j >= 0; j--){
          //statements.splice(set[j], 1);
          var statement = statements[set[j]];
          console.log("statement", statement);
          var cleanTrace = statement.cleanTrace;
          for (var l =  cleanTrace.length - 1; l >= 0; l--){
            if (cleanTrace[l].data.type === "keyup" || cleanTrace[l].data.type === "keydown"){
              cleanTrace.splice(l, 1);
            }
          }
        }
        */
        
      }
      
      WALconsole.log("markNonTraceContributingStatements", statements);
      return statements;
    }

    this.processServerRelations = function _processServerRelations(resp, currentStartIndex, tabsToCloseAfter, tabMapping){
      if (currentStartIndex === undefined){currentStartIndex = 0;}
      if (tabsToCloseAfter === undefined){tabsToCloseAfter = [];}
      if (tabMapping === undefined){tabMapping = {};}
      // we're ready to try these relations on the current pages
      // to do this, we'll have to actually replay the script

      var startIndex = currentStartIndex;

      // let's find all the statements that should open new pages (where we'll need to try relations)
      for (var i = currentStartIndex; i < program.statements.length; i++){
        if (program.statements[i].outputPageVars && program.statements[i].outputPageVars.length > 0){
          // todo: for now this code assumes there's exactly one outputPageVar.  this may not always be true!  but dealing with it now is a bad use of time
          var targetPageVar = program.statements[i].outputPageVars[0];
          WALconsole.log("processServerrelations going for index:", i, targetPageVar);

          // this is one of the points to which we'll have to replay
          var statementSlice = program.statements.slice(startIndex, i + 1);
          var trace = [];
          _.each(statementSlice, function(statement){trace = trace.concat(statement.cleanTrace);});
          //_.each(trace, function(ev){EventM.clearDisplayInfo(ev);}); // strip the display info back out from the event objects

          WALconsole.log("processServerrelations program: ", program);
          WALconsole.log("processServerrelations trace indexes: ", startIndex, i);
          WALconsole.log("processServerrelations trace:", trace.length);

          var nextIndex = i + 1;

          // ok, we have a slice of the statements that should produce one of our pages. let's replay
          SimpleRecord.replay(trace, {tabMapping: tabMapping}, function(replayObj){
            // continuation
            WALconsole.log("replayobj", replayObj);

            // what's the tab that now has the target page?
            var replayTrace = replayObj.record.events;
            var lastCompletedEvent = TraceManipulationUtilities.lastTopLevelCompletedEvent(replayTrace);
            var lastCompletedEventTabId = TraceManipulationUtilities.tabId(lastCompletedEvent);
            // what tabs did we make in the interaction in general?
            tabsToCloseAfter = tabsToCloseAfter.concat(TraceManipulationUtilities.tabsInTrace(replayTrace));

            // let's do some trace alignment to figure out a tab mapping
            var newMapping = tabMappingFromTraces(trace, replayTrace);
            tabMapping = _.extend(tabMapping, newMapping);
            WALconsole.log(newMapping, tabMapping);

            // and what are the server-suggested relations we want to send?
            var resps = resp.pages;
            var suggestedRelations = null;
            for (var i = 0; i < resps.length; i++){
              var pageVarName = resps[i].page_var_name;
              if (pageVarName === targetPageVar.name){
                suggestedRelations = [resps[i].relations.same_domain_best_relation, resps[i].relations.same_url_best_relation];
                for (var j = 0; j < suggestedRelations.length; j++){
                  if (suggestedRelations[j] === null){ continue; }
                    suggestedRelations[j] = ServerTranslationUtilities.unJSONifyRelation(suggestedRelations[j]); // is this the best place to deal with going between our object attributes and the server strings?
                }
              }
            }
            if (suggestedRelations === null){
              WALconsole.log("Panic!  We found a page in our outputPageVars that wasn't in our request to the server for relations that might be relevant on that page.");
            }

            var framesHandled = {};

            // we'll do a bunch of stuff to pick a relation, then we'll call this function
            var handleSelectedRelation = function(data){
              // handle the actual data the page sent us
              if (data){
                program.processLikelyRelation(data);
              }
              // update the control panel display
              RecorderUI.updateDisplayedRelations(true); // true because we're still unearthing interesting relations, so should indicate we're in progress
              // now let's go through this process all over again for the next page, if there is one
              WALconsole.log("going to processServerRelations with nextIndex: ", nextIndex);
              program.processServerRelations(resp, nextIndex, tabsToCloseAfter, tabMapping);
            };

            // this function will select the correct relation from amongst a bunch of frames' suggested relatoins
            var processedTheLikeliestRelation = false;
            var pickLikelyRelation = function(){
              if (processedTheLikeliestRelation){
                return; // already did this.  don't repeat
              }
              for (var key in framesHandled){
                if (framesHandled[key] === false){
                  return; // nope, not ready yet.  wait till all the frames have given answers
                }
              }
              WALconsole.log("framesHandled", framesHandled); // todo: this is just debugging

              var dataObjs = _.map(Object.keys(framesHandled), function(key){ return framesHandled[key]; });
              WALconsole.log("dataObjs", dataObjs);
              // todo: should probably do a fancy similarity thing here, but for now we'll be casual
              // we'll sort by number of cells, then return the first one that shares a url with our spec nodes, or the first one if none share that url
              dataObjs = _.filter(dataObjs, function(obj){return obj !== null && obj !== undefined;});
              var sortedDataObjs = _.sortBy(dataObjs, function(data){ if (!data || !data.first_page_relation || !data.first_page_relation[0]){return -1;} else {return data.first_page_relation.length * data.first_page_relation[0].length; }}); // ascending
	      sortedDataObjs = sortedDataObjs.reverse();
              WALconsole.log("sortedDataObjs", sortedDataObjs);
              var frameUrls = pagesToFrameUrls[targetPageVar.name];
              WALconsole.log("frameUrls", frameUrls, pagesToFrameUrls, targetPageVar.name);
              var mostFrequentFrameUrl = _.chain(frameUrls).countBy().pairs().max(_.last).head().value(); // a silly one-liner for getting the most freq
              _.each(sortedDataObjs, function(data){
                if (data.url === mostFrequentFrameUrl){
                  // ok, this is the one
                  // now that we've picked a particular relation, from a particular frame, actually process it
                  processedTheLikeliestRelation = true;
                  handleSelectedRelation(data);
                  return;
                }
              });
              // drat, none of them had the exact same url.  ok, let's just pick the first
              if (sortedDataObjs.length < 1){
                WALconsole.log("Aaaaaaaaaaah there aren't any frames that offer good relations!  Why???");
                return;
              }
              processedTheLikeliestRelation = true;
              handleSelectedRelation(sortedDataObjs[0]);
            };

            function sendMessageForFrames(frames){
              framesHandled = {};
                frames.forEach(function(frame){
                  // keep track of which frames need to respond before we'll be read to advance
                  WALconsole.log("frameId", frame);
                  framesHandled[frame] = false;
                });
                frames.forEach(function(frame) {
                    // for each frame in the target tab, we want to see if the frame suggests a good relation.  once they've all made their suggestions
                    // we'll pick the one we like best
                    // todo: is there a better way?  after all, we do know the frame in which the user interacted with the first page at original record-time
                    
                    // here's the function for sending the message once
                    var getLikelyRelationFunc = function(){
                      utilities.sendFrameSpecificMessage("mainpanel", "content", "likelyRelation", 
                                                          {xpaths: pagesToNodes[targetPageVar.name], pageVarName: targetPageVar.name, serverSuggestedRelations: suggestedRelations}, 
                                                          lastCompletedEventTabId, frame, 
                                                          // question: is it ok to insist that every single frame returns a non-null one?  maybe have a timeout?  maybe accept once we have at least one good response from one of the frames?
                                                          function(response) { response.frame = frame; framesHandled[frame] = response; pickLikelyRelation();}); // when get response, call pickLikelyRelation (defined above) to pick from the frames' answers
                    };

                    // here's the function for sending the message until we get the answer
                    var getLikelyRelationFuncUntilAnswer = function(){
                      if (framesHandled[frame]){ return; } // cool, already got the answer, stop asking
                      getLikelyRelationFunc(); // send that message
                      setTimeout(getLikelyRelationFuncUntilAnswer, 5000); // come back and send again if necessary
                    };

                    // actually call it
                    getLikelyRelationFuncUntilAnswer();

                });
            }

            var allFrames = pagesToFrames[targetPageVar.name];
            allFrames = _.uniq(allFrames);
            if (allFrames.length === 1 && allFrames[0] === -1){
              // cool, it's just the top-level frame
              // just do the top-level iframe, and that will be faster
              sendMessageForFrames([0]); // assumption: 0 is the id for the top-level frame
            }
            else{
              // ok, we'll have to ask the tab what frames are in it
              // let's get some info from the pages, and when we get that info back we can come back and deal with more script segments
              chrome.webNavigation.getAllFrames({tabId: lastCompletedEventTabId}, function(details) {
                console.log("about to send to frames, tabId", lastCompletedEventTabId);
                var frames = _.map(details, function(d){return d.frameId;});
                sendMessageForFrames(frames);
              });
            }

          });
          return; // all later indexes will be handled by the recursion instead of the rest of the loop
        }
      }
      // ok we hit the end of the loop without returning after finding a new page to work on.  time to close tabs
      tabsToCloseAfter = _.uniq(tabsToCloseAfter); 
      console.log("tabsToCloseAfter", tabsToCloseAfter);     
      for (var i = 0; i < tabsToCloseAfter.length; i++){
        console.log("processServerRelations removing tab", tabsToCloseAfter[i]);
        chrome.tabs.remove(tabsToCloseAfter[i], function(){
          // do we need to do anything?
        }); 
      }
      // let's also update the ui to indicate that we're no longer looking
      RecorderUI.updateDisplayedRelations(false);
      

    };

    var pagesToRelations = {};
    this.processLikelyRelation = function _processLikelyRelation(data){
      WALconsole.log(data);
      if (pagesProcessed[data.page_var_name]){
        // we already have an answer for this page.  must have gotten sent multiple times even though that shouldn't happen
        WALconsole.log("Alarming.  We received another likely relation for a given pageVar, even though content script should prevent this.");
        return this.relations;
      }
      pagesProcessed[data.page_var_name] = true;

      if (data.num_rows_in_demonstration < 2 && data.next_type === NextTypes.NONE){
        // what's the point of showing a relation with only one row?
        pagesToRelations[data.page_var_name] = null;
      }
      else{
        var rel = new WebAutomationLanguage.Relation(data.relation_id, data.name, data.selector, data.selector_version, data.exclude_first, data.columns, data.first_page_relation, data.num_rows_in_demonstration, data.page_var_name, data.url, data.next_type, data.next_button_selector, data.frame);
        pagesToRelations[data.page_var_name] = rel;
        this.relations.push(rel);
        this.relations = _.uniq(this.relations);
      }

      WALconsole.log(pagesToRelations, pagesToNodes);
      this.insertLoops();
      /*
      if (_.difference(_.keys(pagesToNodes), _.keys(pagesToRelations)).length === 0) { // pagesToRelations now has all the pages from pagesToNodes
        // awesome, all the pages have gotten back to us
        setTimeout(this.insertLoops.bind(this), 0); // bind this to this, since JS runs settimeout func with this pointing to global obj
      }
      */

      // give the text relations back to the UI-handling component so we can display to user
      return this.relations;
    };

    function parameterizeBodyStatementsForRelation(bodyStatementLs, relation){
      var relationColumnsUsed = [];
      for (var j = 0; j < bodyStatementLs.length; j++){
        relationColumnsUsed = relationColumnsUsed.concat(bodyStatementLs[j].parameterizeForRelation(relation));
      }
      relationColumnsUsed = _.uniq(relationColumnsUsed);
      relationColumnsUsed = _.without(relationColumnsUsed, null);
      return relationColumnsUsed;
    }

    function loopStatementFromBodyAndRelation(bodyStatementLs, relation, pageVar){
      // we want to parameterize the body for the relation
      var relationColumnsUsed = parameterizeBodyStatementsForRelation(bodyStatementLs, relation); 

      // ok, and any pages to which we travel within a loop's non-loop body nodes must be counteracted with back buttons at the end
      // todo: come back and make sure we only do this for pages that aren't being opened in new tabs already, and maybe ultimately for pages that we can't convert to open in new tabs
      var backStatements = [];
      for (var j = 0; j < bodyStatementLs.length; j++){
        var statement = bodyStatementLs[j];
        if (statement.outputPageVars && statement.outputPageVars.length > 0){
          // we're making that assumption again about just one outputpagevar.  also that everything is happening in one tab.  must come back and revisit this
          var currPage = statement.outputPageVars[0];
          var backPage = statement.pageVar;
          if (backPage && currPage.originalTabId() === backPage.originalTabId()){
            // only need to add back button if they're actually in the same tab (may be in diff tabs if CTRL+click, or popup, whatever)
            backStatements.push(new WebAutomationLanguage.BackStatement(currPage, backPage));
          }
          else{
            // we're going back to messing with an earlier page, so should close the current page
            // insert a statement that will do that
            backStatements.push(new WebAutomationLanguage.ClosePageStatement(currPage));
          }
        }
      }
      backStatements.reverse(); // must do the back button in reverse order

      cleanupStatementLs = backStatements;
      // todo: also, this is only one of the places we introduce loops.  should do this everywhere we introduce or adjust loops.  really need to deal with the fact those aren't aligned right now

      var loopStatement = new WebAutomationLanguage.LoopStatement(relation, relationColumnsUsed, bodyStatementLs, cleanupStatementLs, pageVar); 
      return loopStatement;
    }

    this.insertLoops = function _insertLoops(){
      var indexesToRelations = {}; // indexes into the statements mapped to the relations used by those statements
      for (var i = 0; i < this.relations.length; i++){
        var relation = this.relations[i];
        for (var j = 0; j < this.statements.length; j++){
          var statement = this.statements[j];
          if (relation.usedByStatement(statement)){
            var loopStartIndex = j;
            // let's do something a little  different in cases where there's a keydown right before the loop, since the keyups will definitely happen within
            // todo: may even need to look farther back for keydowns whose keyups happen within the loop body
            if (this.statements[j-1] instanceof WebAutomationLanguage.TypeStatement && this.statements[j-1].onlyKeydowns){
              loopStartIndex = j - 1;
            }
            indexesToRelations[loopStartIndex] = relation;
            break;
          }
        }
      }

      this.updateChildStatements(this.statements);
      var indexes = _.keys(indexesToRelations).sort(function(a, b){return b-a}); // start at end, work towards beginning
      for (var i = 0; i < indexes.length; i++){
        var index = indexes[i];
        // let's grab all the statements from the loop's start index to the end, put those in the loop body
        var bodyStatementLs = this.loopyStatements.slice(index, this.loopyStatements.length);
        var pageVar = bodyStatementLs[0].pageVar; // pageVar comes from first item because that's the one using the relation, since it's the one that made us decide to insert a new loop starting with that 
        var loopStatement = loopStatementFromBodyAndRelation(bodyStatementLs, indexesToRelations[index], pageVar); // let's use bodyStatementLs as our body, indexesToRelations[index] as our relation 
        
        var newChildStatements = this.loopyStatements.slice(0, index);
        newChildStatements.push(loopStatement);
        this.updateChildStatements(newChildStatements);
      }

      RecorderUI.updateDisplayedScript();
      // now that we know which columns are being scraped, we may also need to update how the relations are displayed
      RecorderUI.updateDisplayedRelations();
    };

    this.tryAddingRelation = function _tryAddingRelation(relation){
      var relationUsed = tryAddingRelationHelper(relation, this.loopyStatements, this);
      // for now we'll add it whether or not it actually get used, but this may not be the best way...
      this.relations.push(relation);
    }

    function tryAddingRelationHelper(relation, loopyStatements, parent){ // parent will be either the full program or a loop statement
      for (var i = 0; i < loopyStatements.length; i++){
        var statement = loopyStatements[i];
        if (statement instanceof WebAutomationLanguage.LoopStatement){
          var used = tryAddingRelationHelper(relation, statement.bodyStatements, statement);
          if (used) {return used;} // if we've already found a use for it, we won't try to use it twice.  so at least for now, as long as we only want one use, we should stop checking here, not continue
        }
        if (relation.usedByStatement(statement)){
          // ok, let's assume the rest of this loop's body should be nested
          var bodyStatementLs = loopyStatements.slice(i, loopyStatements.length);
          var loopStatement = loopStatementFromBodyAndRelation(bodyStatementLs, relation, statement.pageVar); // statement uses relation, so pick statement's pageVar
          // awesome, we have our new loop statement, which should now be the final statement in the parent
          var newStatements = loopyStatements.slice(0,i);
          newStatements.push(loopStatement);
          parent.updateChildStatements(newStatements);
          return true;
        }
      }
      return false;
    }

    this.removeRelation = function _removeRelation(relationObj){
      this.relations = _.without(this.relations, relationObj);

      // now let's actually remove any loops that were trying to use this relation
      newChildStatements = removeLoopsForRelation(this.loopyStatements, relationObj);
      this.updateChildStatements(newChildStatements);

      RecorderUI.updateDisplayedScript();
      RecorderUI.updateDisplayedRelations();
    };

    function removeLoopsForRelation(loopyStatements, relation){
      var outputStatements = [];
      for (var i = 0; i < loopyStatements.length; i++){
        if (loopyStatements[i] instanceof WebAutomationLanguage.LoopStatement){
          if (loopyStatements[i].relation === relation){
            // ok, we want to remove this loop; let's pop the body statements back out into our outputStatements
            var bodyStatements = removeLoopsForRelation(loopyStatements[i].bodyStatements, relation);
            outputStatements = outputStatements.concat(bodyStatements);
          }
          else{
            // we want to keep this loop, but we'd better descend and check the loop body still
            var newChildStatements = removeLoopsForRelation(loopyStatements[i].bodyStatements, relation);
            loopyStatements[i].updateChildStatements(newChildStatements);
            outputStatements.push(loopyStatements[i]);
          }
        }
        else{
          // not a loop statement
          loopyStatements[i].unParameterizeForRelation(relation);
          outputStatements.push(loopyStatements[i]);
        }
      }
      return outputStatements;
    }

  }

  // time to apply labels for revival purposes
  for (var prop in pub){
    if (typeof pub[prop] === "function"){
      WALconsole.log("making revival label for ", prop);
      Revival.introduceRevivalLabel(prop, pub[prop]);
    }
  }

  return pub;
}());
