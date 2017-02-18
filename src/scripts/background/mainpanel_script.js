function setUp(){

  //messages received by this component
  //utilities.listenForMessage("content", "mainpanel", "selectorAndListData", processSelectorAndListData);
  //utilities.listenForMessage("content", "mainpanel", "nextButtonData", processNextButtonData);
  //utilities.listenForMessage("content", "mainpanel", "moreItems", moreItems);
  utilities.listenForMessage("content", "mainpanel", "scrapedData", RecorderUI.processScrapedData);
  utilities.listenForMessage("content", "mainpanel", "requestCurrentRecordingWindow", RecorderUI.sendCurrentRecordingWindow);
  

  MiscUtilities.useCorrectScrapingConditionStrings("#scraping_instructions", "___SCRAPINGCONDITIONSTRING___", "___LINKSCRAPINGCONDITIONSTRING___"); // important to do this one first, what with everything going all stringy
  //handle user interactions with the mainpanel
  //$("button").button(); 
  $( "#tabs" ).tabs();
  RecorderUI.setUpRecordingUI();
}

$(setUp);


/**********************************************************************
 * Guide the user through making a demonstration recording
 **********************************************************************/

var RecorderUI = (function() {
  var pub = {};

  pub.setUpRecordingUI = function(){
    // we'll start on the first tab, our default, which gives user change to start a new recording
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

  var recordingWindowId = null;
  pub.getCurrentRecordingWindow = function(){
    return recordingWindowId;
  }

  var makeNewRecordReplayTab = function(cont){
    chrome.windows.getCurrent(function (currWindowInfo){
      var right = currWindowInfo.left + currWindowInfo.width;
      chrome.system.display.getInfo(function(displayInfoLs){
        for (var i = 0; i < displayInfoLs.length; i++){
          var bounds = displayInfoLs[i].bounds;
          bounds.right = bounds.left + bounds.width;
          console.log(bounds);
          if (bounds.left <= right && bounds.right >= right){
            // we've found the right display
            var top = currWindowInfo.top - 40; // - 40 because it doesn't seem to count the menu bar and I'm not looking for a more accurate solution at the moment
            var left = right; // let's have it adjacent to the control panel
            chrome.windows.create({url: "pages/newRecordingWindow.html", focused: true, left: left, top: top, width: (bounds.right - right), height: (bounds.top + bounds.height - top)}, function(win){
              recordingWindowId = win.id;
              pub.sendCurrentRecordingWindow();
              console.log("Only recording in window: ", recordingWindowId);
              cont();
            });
          }
        }
      });
    });
  };

  pub.startRecording = function(){
    var div = $("#new_script_content");
    DOMCreationUtilities.replaceContent(div, $("#recording"));
    div.find("#stop_recording").click(RecorderUI.stopRecording);

    makeNewRecordReplayTab(function(){
      SimpleRecord.startRecording();
    });
  };

  pub.sendCurrentRecordingWindow = function(){
    utilities.sendMessage("mainpanel", "content", "currentRecordingWindow", {window_id: recordingWindowId}); // the tabs will check whether they're in the window that's actually recording to figure out what UI stuff to show
  }

  function activateButton(div, selector, handler){
    var button = div.find(selector);
    button.button();
    button.click(handler);
  }

  pub.stopRecording = function(){
    var trace = SimpleRecord.stopRecording();
    var program = ReplayScript.setCurrentTrace(trace, recordingWindowId);
    program.relevantRelations(); // now that we have a script, let's set some processing in motion that will figure out likely relations
    pub.showProgramPreview(true); // true because we're currently processing the script, stuff is in progress
  };

  pub.showProgramPreview = function(inProgress){
    if (inProgress === undefined){ inProgress = false; }
    var div = $("#new_script_content");
    DOMCreationUtilities.replaceContent(div, $("#script_preview")); // let's put in the script_preview node
    activateButton(div, "#run", RecorderUI.run);
    activateButton(div, "#save", RecorderUI.save);
    activateButton(div, "#replay", RecorderUI.replayOriginal);
    activateButton(div, '#relation_upload', RecorderUI.uploadRelation);
    RecorderUI.updateDisplayedScript();
    RecorderUI.updateDisplayedRelations(inProgress);
  };

  pub.run = function(){
    // update the panel to show pause, resume buttons
    var div = $("#new_script_content");
    DOMCreationUtilities.replaceContent(div, $("#script_running"));

    activateButton(div, "#pause", RecorderUI.pauseRun);
    activateButton(div, "#resume", RecorderUI.resumeRun);
    div.find("#resume").button("option", "disabled", true); // shouldn't be able to resume before we even pause

    activateButton(div, "#download", function(){ReplayScript.prog.download();});

    var reset = function(){
      ReplayScript.prog.stopRunning();
      pub.showProgramPreview();
    }
    activateButton(div, "#cancelRun", reset);

    // let's do this in a fresh window
    makeNewRecordReplayTab(function(){
      // actually start the script running
      ReplayScript.prog.run();
    });

  };

  // for saving a program to the server
  pub.save = function(){
    var prog = ReplayScript.prog;
    var div = $("#new_script_content");
    var name = div.find("#program_name").get(0).value;
    prog.name = name;
    var relationObjsSerialized = _.map(prog.relations, ServerTranslationUtilities.JSONifyRelation);
    var serializedProg = ServerTranslationUtilities.JSONifyProgram(prog);
    var msg = {id: prog.id, serialized_program: serializedProg, relation_objects: relationObjsSerialized, name: name};
    $.post('http://kaofang.cs.berkeley.edu:8080/saveprogram', msg, function(response){
      var progId = response.program.id;
      prog.id = progId;
    });
  };

  pub.replayOriginal = function(){
    ReplayScript.prog.replayOriginal();
  };

  pub.pauseRun = function(){
    console.log("Setting pause flag.");
    pub.userPaused = true; // next runbasicblock call will handle saving a continuation
    var div = $("#new_script_content");
    div.find("#pause").button("option", "disabled", true); // can't pause while we're paused
    div.find("#resume").button("option", "disabled", false); // can now resume
  };

  pub.resumeRun = function(){
    pub.userPaused = false;
    var div = $("#new_script_content");
    div.find("#pause").button("option", "disabled", false);
    div.find("#resume").button("option", "disabled", true);
    pub.resumeContinuation();
  };

  // during recording, when user scrapes, show the text so user gets feedback on what's happening
  var scraped = {}; // dictionary based on xpath since we can get multiple DOM events that scrape same data from same node
  // todo: note that since we're indexing on xpath, if had same xpath on multiple different pages, this would fail to show us some data.  bad!
  // actually, I think this whole thing may be unnecessary.  we've just been adding in the same xpath to the xpaths list to control
  // how we display it anyway, so the indexing isn't really getting us anything, isn't eliminating anything, and we haven't had any trouble.
  // looks like an artifact of an old style.  todo: get rid of it when have a chance.
  var xpaths = []; // want to show texts in the right order
  pub.processScrapedData = function(data){
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

  pub.updateDisplayedRelations = function(currentlyUpdating){
    if (currentlyUpdating === undefined){ currentlyUpdating = false; }

    var relationObjects = ReplayScript.prog.relations;
    $div = $("#new_script_content").find("#status_message");
    $div.html("");
    if (currentlyUpdating){
      $div.html("Looking at webpages to find relevant tables.  Give us a moment.<br><center><img src='../icons/ajax-loader.gif'></center>");
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
      var $relDiv = $("<div class=relation_preview></div>");
      $div.append($relDiv);
      (function(){ // closure to save the relation object
        var relation = relationObjects[i];
        var textRelation = relation.demonstrationTimeRelationText();
        if (textRelation.length > 2){
          textRelation = textRelation.slice(0,2);
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
        editRelationButton.click(function(){relation.editSelector();});
        $relDiv.append(editRelationButton);
        var removeRelationButton = $("<button>This Table Is Not Relevant</button>");
        removeRelationButton.button();
        removeRelationButton.click(function(){ReplayScript.prog.removeRelation(relation);});
        $relDiv.append(removeRelationButton);
      })();
    }
  };

  pub.showRelationEditor = function(relation, tabId){
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
      RecorderUI.showProgramPreview();
      // we also want to close the tab...
      chrome.tabs.remove(tabId);
      // once ready button clicked, we'll already have updated the relation selector info based on messages the content panel has been sending, so we can just go back to looking at the program preview
      // the one thing we do need to change is there may now be nodes included in the relation (or excluded) that weren't before, so we should redo loop insertion
      ReplayScript.prog.insertLoops();
      // todo: maybe we also want to automatically save changes to server?  something to consider.  not yet sure
    });
  };

  pub.updateDisplayedRelation = function(relationObj){
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
        columnTitle.change(function(){console.log(columnTitle.val(), xpath); relationObj.setColumnName(columns[closJ], columnTitle.val()); RecorderUI.updateDisplayedScript();});
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

  pub.setColumnColors = function(colorLs, columnLs, tabid){
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

  pub.updateDisplayedScript = function(){
    var program = ReplayScript.prog;
    var scriptString = program.toString();
    var scriptPreviewDiv = $("#new_script_content").find("#program_representation");
    DOMCreationUtilities.replaceContent(scriptPreviewDiv, $("<div>"+scriptString+"</div>")); // let's put the script string in the script_preview node

    // first make sure we have all the up to date blocks.  for instance, if we have relations available, we'll add loops to toolbox
    pub.updateBlocklyToolbox();
    program.displayBlockly();

    // we also want to update the section that lets the user say what loop iterations are duplicates
    // used for data that changes alignment during scraping and for recovering from failures
    pub.updateDuplicateDetection();

    if (program.name){
      $("#new_script_content").find("#program_name").get(0).value = program.name;
    }
  };

  pub.updateDuplicateDetection = function _updateDuplicateDetection(){
    var duplicateDetectionData = ReplayScript.prog.getDuplicateDetectionData();

    $div = $("#new_script_content").find("#duplicates_container_content");
    $div.html("");
    for (var i = 0; i < duplicateDetectionData.length; i++){
      var oneLoopData = duplicateDetectionData[i];
      var table = DOMCreationUtilities.arrayOfArraysToTable(oneLoopData.displayData);
      var nodeVariables = oneLoopData.nodeVariables;
      var tr = $("<tr></tr>");
      for (var j = 0; j < nodeVariables.length; j++){
        
          var attributes = ["text", "link"];
          for (var k = 0; k < attributes.length; k++){
            (function(){
              var nodeVariable = nodeVariables[j];
              var attr = attributes[k];
              var atributeRequired = $("<input type='checkbox'>");
              atributeRequired.change(function(){
                console.log("toggling attribute required for", nodeVariable, attr);
                RecorderUI.updateDisplayedScript();});

              var td = $("<td></td>");
              td.append(atributeRequired);
              tr.append(td);
            })();
          }
      }
      table.prepend(tr);
      div.append(table);
    }
  };

  pub.addNewRowToOutput = function _addNewRowToOutput(listOfCellTexts){
    var div = $("#new_script_content").find("#output_preview").find("table").find("tbody");
    var l = div.children().length;
    var limit = 100;
    if (l === limit){
      if ($("#new_script_content").find("#output_preview").find("#data_too_big").length === 0){
        $("#new_script_content").find("#output_preview").append($("<div id='data_too_big'>This dataset is too big for us to display.  The preview here shows the first "+limit+" rows.  To see the whole dataset, just click the download button above.</div>"));  
      }
    }
    else if (l < limit){
      console.log("adding output row: ", l);
      div.append(DOMCreationUtilities.arrayOfTextsToTableRow(listOfCellTexts));
    }
  };

  var currentUploadRelation = null;
  pub.uploadRelation = function(){
    console.log("going to upload a relation.");
    var div = $("#new_script_content");
    DOMCreationUtilities.replaceContent(div, $("#upload_relation"));
    $('#upload_data').on("change", pub.handleNewUploadedRelation); // and let's actually process changes
    activateButton(div, "#upload_done", function(){if (currentUploadRelation !== null){ ReplayScript.prog.tryAddingRelation(currentUploadRelation);} RecorderUI.showProgramPreview();}); // ok, we're actually using this relation.  the program better get parameterized
    activateButton(div, "#upload_cancel", RecorderUI.showProgramPreview); // don't really need to do anything here
  };

  pub.handleNewUploadedRelation = function(event){
    console.log("New list uploaded.");
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

  pub.addDialog = function(title, dialogText, buttonTextToHandlers){
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

  pub.loadSavedScripts = function(){
    console.log("going to load saved scripts.");
    var savedScriptsDiv = $("#saved_script_list");
    $.get('http://kaofang.cs.berkeley.edu:8080/programs/', {}, function(response){
      console.log(response);
      var arrayOfArrays = _.map(response, function(prog){
        var date = $.format.date(prog.date * 1000, "dd/MM/yyyy HH:mm")
        return [prog.name, date];});
      var html = DOMCreationUtilities.arrayOfArraysToTable(arrayOfArrays);
      var trs = html.find("tr");
      for (var i = 0; i < trs.length; i++){
        (function(){
          var cI = i;
          console.log("adding handler", trs[i], response[i].id)
          $(trs[i]).click(function(){
            console.log(cI);
            var id = response[cI].id;
            pub.loadSavedProgram(id);
          });
          $(trs[i]).addClass("hoverable");
        })();
      }
      savedScriptsDiv.html(html);
    });
  };

  pub.loadSavedProgram = function(progId){
    console.log("loading program: ", progId);
    $.get('http://kaofang.cs.berkeley.edu:8080/programs/'+progId, {}, function(response){
      var revivedProgram = ServerTranslationUtilities.unJSONifyProgram(response.program.serialized_program);
      revivedProgram.id = response.program.id; // if id was only assigned when it was saved, serialized_prog might not have that info yet
      revivedProgram.name = response.program.name;
      ReplayScript.prog = revivedProgram;
      pub.showProgramPreview(false); // false because we're not currently processing the program (as in, finding relations, something like that)
      $("#tabs").tabs("option", "active", 0); // make that first tab (the program running tab) active again
    });
  }

  return pub;
}());

/**********************************************************************
 * Hiding the modifications to the internals of Ringer event objects
 **********************************************************************/

var EventM = (function() {
  var pub = {};

  pub.prepareForDisplay = function(ev){
    if (!ev.additionalDataTmp){ // this is where this tool chooses to store temporary data that we'll actually clear out before sending it back to r+r
      ev.additionalDataTmp = {};
    } 
    ev.additionalDataTmp.display = {};
  };

  pub.getLoadURL = function(ev){
    return ev.data.url;
  };

  pub.getDOMURL = function(ev){
    return ev.frame.topURL;
  };

  pub.getDOMPort = function(ev){
    return ev.frame.port;
  }

  pub.getVisible = function(ev){
    return ev.additionalDataTmp.display.visible;
  };
  pub.setVisible = function(ev, val){
    ev.additionalDataTmp.display.visible = val;
  };

  pub.getLoadOutputPageVar = function(ev){
    return ev.additionalDataTmp.display.pageVarId;
  };
  pub.setLoadOutputPageVar = function(ev, val){
    ev.additionalDataTmp.display.pageVarId = val;
  };

  pub.getDOMInputPageVar = function(ev){
    return ev.additionalDataTmp.display.inputPageVar;
  };
  pub.setDOMInputPageVar = function(ev, val){
    ev.additionalDataTmp.display.inputPageVar = val;
  };

  pub.getDOMOutputLoadEvents = function(ev){
    if (ev.type !== "dom") {return false;}
    return ev.additionalDataTmp.display.causesLoads;
  };
  pub.setDOMOutputLoadEvents = function(ev, val){
    if (ev.type !== "dom") {return false;}
    ev.additionalDataTmp.display.causesLoads = val;
  };
  pub.addDOMOutputLoadEvent = function(ev, val){
    ev.additionalDataTmp.display.causesLoads.push(val);
  };

  pub.getLoadCausedBy = function(ev){
    return ev.additionalDataTmp.display.causedBy;
  };
  pub.setLoadCausedBy = function(ev, val){
    ev.additionalDataTmp.display.causedBy = val;
  };

  pub.getDisplayInfo = function(ev){
    return ev.additionalDataTmp.display;
  }
  pub.clearDisplayInfo = function(ev){
    delete ev.additionalDataTmp.display;
  }
  pub.setDisplayInfo = function(ev, displayInfo){
    ev.additionalDataTmp.display = displayInfo;
  }

  pub.setTemporaryStatementIdentifier = function(ev, id){
    if (!ev.additional){
      // not a dom event, can't copy this stuff around
      return null;
    }
    ev.additional.___additionalData___.temporaryStatementIdentifier = id; // this is where the r+r layer lets us store data that will actually be copied over to the new events (for dom events);  recall that it's somewhat unreliable because of cascading events; sufficient for us because cascading events will appear in the same statement, so can have same statement id, but be careful
  }
  pub.getTemporaryStatementIdentifier = function(ev){
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

var ReplayScript = (function() {
  var pub = {};

  pub.trace = null;
  pub.prog = null;

  // controls the sequence of transformations we do when we get a trace

  pub.setCurrentTrace = function(trace, windowId){
    console.log(trace);
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
    console.log(trace);
    trace = sanitizeTrace(trace);
    console.log(trace);
    console.log(trace.length);
    trace = windowFilter(trace, windowId);
    console.log(trace);
    console.log(trace.length);
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
    //console.log("allowedInSameSegment", e1type, e2type);
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
        console.log(segment[0].target);
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
          console.log("stype(ev)", ev, WebAutomationLanguage.statementType(ev), currentSegmentVisibleEvent);
        }
        currentSegment.push(ev);
        if (currentSegmentVisibleEvent === null && WebAutomationLanguage.statementType(ev) !== null ){ // only relevant to first segment
          currentSegmentVisibleEvent = ev;
        }
      }
      else{
        // the current event isn't allowed in last segment -- maybe it's on a new node or a new type of action.  need a new segment
        console.log("making a new segment", currentSegmentVisibleEvent, ev, currentSegment, currentSegment.length);
        allSegments.push(currentSegment);
        currentSegment = [ev];
        currentSegmentVisibleEvent = ev; // if this were an invisible event, we wouldn't have needed to start a new block, so it's always ok to put this in for the current segment's visible event
      }});
    allSegments.push(currentSegment); // put in that last segment
    // allSegments = postSegmentationInvisibilityDetectionAndMerging(allSegments); // for now rather than this func, we'll try an alternative where we just show ctrl, alt, shift keypresses in a simpler way
    console.log("allSegments", allSegments, allSegments.length);
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

var WebAutomationLanguage = (function() {
  var pub = {};

  var statementToEventMapping = {
    mouse: ['click','dblclick','mousedown','mousemove','mouseout','mouseover','mouseup'],
    keyboard: ['keydown','keyup','keypress','textinput','paste','input']
  };

  // helper function.  returns the StatementType (see above) that we should associate with the argument event, or null if the event is invisible
  pub.statementType = function(ev){
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
        if (ev.data.type === "keyup"){
          return StatementTypes.KEYUP;
        }
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

  function nodeRepresentation(statement, linkScraping){
    if (linkScraping === undefined){ linkScraping = false; }
    if (statement.currentNode instanceof WebAutomationLanguage.VariableUse){
      return statement.currentNode.toString(linkScraping);
    }
    if (statement.trace[0].additional.visualization === "whole page"){
      return "whole page";
    }
    if (linkScraping){
      return statement.trace[0].additional.scrape.link; // we don't have a better way to visualize links than just giving text
    }
    return "<img src='"+statement.trace[0].additional.visualization+"' style='max-height: 150px; max-width: 350px;'>";
  }

  function outputPagesRepresentation(statement){
    var prefix = "";
    if (statement.outputPageVars.length > 0){
      prefix = _.map(statement.outputPageVars, function(pv){return pv.toString();}).join(", ")+" = ";
    }
    return prefix;
  }

  // returns true if we successfully parameterize this node with this relation, false if we can't
  function parameterizeNodeWithRelation(statement, relation, pageVar, link){
      if (link === undefined) {link = false;}
      // note: may be tempting to use the columns' xpath attributes to decide this, but this is not ok!  now that we can have
      // mutliple suffixes associated with a column, that xpath is not always correct
      // but we're in luck because we know the selector has just been applied to the relevant page (to produce relation.demonstrationTimeRelation and from that relation.firstRowXpaths)
      // so we can learn from those attributes which xpaths are relevant right now, and thus which ones the user would have produced in the current demo
      
      // if the relation is a text relation, we actually don't want to do the below, because it doesn't represent nodes, only texts
      if (relation instanceof WebAutomationLanguage.TextRelation){
        return null;
      }

      for (var i = 0; i < relation.firstRowXPaths.length; i++){
        var firstRowXpath = relation.firstRowXPaths[i];
        if (firstRowXpath === statement.currentNode){
          statement.relation = relation;
          statement.currentNode = new WebAutomationLanguage.VariableUse(relation.columns[i], relation, pageVar, link); // note that this means the elements in the firstRowXPaths and the elements in columns must be aligned!
          return relation.columns[i]; 
        }
      }
      return null;
  }

  function unParameterizeNodeWithRelation(statement, relation){
    if (statement.relation === relation){
      statement.relation = null;
      statement.currentNode = statement.origNode;
    }
  }

  function currentNodeXpath(statement){
    if (statement.currentNode instanceof WebAutomationLanguage.VariableUse){
      return statement.currentNode.currentXPath();
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

      console.log(ctrlUp, ctrlDown);

      for (var i = 0; i < lastIndex + 1; i++){ // lastIndex + 1 because we just added two new events!
        if (statement.trace[i].data){
          statement.trace[i].data.ctrlKey = true; // of course may already be true, which is fine
        }
      }
    }
  }

  function requireFeature(statement, featureName){
    ReplayTraceManipulation.requireFeature(statement.trace, statement.node, featureName); // note that statement.node stores the xpath of the original node
    ReplayTraceManipulation.requireFeature(statement.cleanTrace, statement.node, featureName);
  }

  // the actual statements

  pub.LoadStatement = function(trace){
    Revival.addRevivalLabel(this);
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


    this.clearRunningState = function(){
      return;
    }

    this.cUrl = function(){
      if (this.currentUrl instanceof WebAutomationLanguage.VariableUse){
        return this.currentUrl.currentText();
      }
      else {
        // else it's a string
        return this.currentUrl;
      }
    }

    this.cUrlString = function(){
      if (this.currentUrl instanceof WebAutomationLanguage.VariableUse){
        return this.currentUrl.toString();
      }
      else {
        // else it's a string
        return '"'+this.currentUrl+'"';
      }
    }

    this.toStringLines = function(){
      var cUrl = this.cUrlString();
      return [this.outputPageVar.toString()+" = load("+cUrl+")"];
    };

    this.pbvs = function(){
      var pbvs = [];
      if (this.url !== this.currentUrl){
        pbvs.push({type:"url", value: this.url});
      }
      return pbvs;
    };

    this.parameterizeForRelation = function(relation){
      // ok!  loads can now get changed based on relations!
      // what we want to do is load a different url if we have a relation that includes the url
      var columns = relation.columns;
      for (var i = 0; i < columns.length; i++){
        var text = columns[i].firstRowText;
        if (text === null || text === undefined){
          // can't parameterize for a cell that has null text
          continue;
        }
        if (text === this.url){
          // ok, we want to parameterize
          this.relation = relation;
          this.currentUrl = new WebAutomationLanguage.VariableUse(relation.columns[i], relation, null, false);
          return relation.columns[i];
        }
      }
    };
    this.unParameterizeForRelation = function(relation){
      if (this.relation === relation){
        this.relation = null;
        this.currentUrl = this.url;
      }
      return;
    };

    this.args = function(){
      var args = [];
      if (this.currentUrl instanceof WebAutomationLanguage.VariableUse){
        args.push({type:"url", value: this.currentUrl.currentText()});
      }
      else{
        args.push({type:"url", value: this.currentUrl}); // if it's not a var use, it's just a string
      }
      return args;
    };

    this.postReplayProcessing = function(trace, temporaryStatementIdentifier){
      return;
    };
  };
  pub.ClickStatement = function(trace){
    Revival.addRevivalLabel(this);
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
      this.currentNode = this.node;
      this.origNode = this.node;

      // we may do clicks that should open pages in new tabs but didn't open new tabs during recording
      // todo: may be worth going back to the ctrl approach, but there are links that refuse to open that way, so for now let's try back buttons
      // proposeCtrlAdditions(this);
      this.cleanTrace = cleanTrace(this.trace);
    }

    this.clearRunningState = function(){
      return;
    }

    this.toStringLines = function(){
      var nodeRep = nodeRepresentation(this);
      return [outputPagesRepresentation(this)+"click("+this.pageVar.toString()+", "+nodeRep+")"];
    };

    this.traverse = function(fn){
      fn(this);
    };

    this.pbvs = function(){
      var pbvs = [];
      if (currentTab(this)){
        // do we actually know the target tab already?  if yes, go ahead and paremterize that
        pbvs.push({type:"tab", value: originalTab(this)});
      }
      if (this.node !== this.currentNode){
        pbvs.push({type:"node", value: this.node});
      }
      return pbvs;
    };

    this.parameterizeForRelation = function(relation){
      return [parameterizeNodeWithRelation(this, relation, this.pageVar)];
    };
    this.unParameterizeForRelation = function(relation){
      unParameterizeNodeWithRelation(this, relation);
    };

    this.args = function(){
      var args = [];
      args.push({type:"tab", value: currentTab(this)});
      args.push({type:"node", value: currentNodeXpath(this)});
      return args;
    };

    this.postReplayProcessing = function(trace, temporaryStatementIdentifier){
      return;
    };

    this.requireFeature = function(featureName){
      requireFeature(this, featureName); // todo: put this method in all the other statements that have orig xpath in this.node
    };
  };
  pub.ScrapeStatement = function(trace){
    Revival.addRevivalLabel(this);
    if (trace){ // we will sometimes initialize with undefined, as when reviving a saved program
      this.trace = trace;
      this.cleanTrace = cleanTrace(this.trace);

      // find the record-time constants that we'll turn into parameters
      var ev = firstVisibleEvent(trace);
      this.pageVar = EventM.getDOMInputPageVar(ev);
      this.node = ev.target.xpath;
      this.pageUrl = ev.frame.topURL;
      // for now, assume the ones we saw at record time are the ones we'll want at replay
      this.currentNode = this.node;
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

    this.clearRunningState = function(){
      this.xpaths = [];
      this.preferredXpath = null;
      return;
    }

    this.toStringLines = function(){
      var nodeRep = nodeRepresentation(this, this.scrapeLink);
      var sString = "scrape(";
      //if (this.scrapeLink){
      //  sString = "scrapeLink(";
      //}
      return [sString+this.pageVar.toString()+", "+nodeRep+")"];
    };

    this.traverse = function(fn){
      fn(this);
    };

    this.pbvs = function(){
      var pbvs = [];
      if (currentTab(this)){
        // do we actually know the target tab already?  if yes, go ahead and paremterize that
        pbvs.push({type:"tab", value: originalTab(this)});
      }
      if (this.node !== this.currentNode){
        pbvs.push({type:"node", value: this.node});
      }
      if (this.preferredXpath){
        // using the usual pbv process happens to be a convenient way to enforce a preferred xpath, since it sets it to prefer a given xpath
        // and replaces all uses in the trace of a given xpath with a preferred xpath
        // but may prefer to extract this non-relation based pbv process from the normal relation pbv.  we'll see
        // side note: the node pbv above will only appear if it's a use of a relation cell, and this one will only appear if it's not
        pbvs.push({type:"node", value: this.node});
      }
      return pbvs;
    };

    this.parameterizeForRelation = function(relation){
      console.log("scraping cleantrace", this.cleanTrace);
      var relationColumnUsed = parameterizeNodeWithRelation(this, relation, this.pageVar, this.scrapeLink);
      if (relationColumnUsed){
        // this is cool because now we don't need to actually run scraping interactions to get the value, so let's update the cleanTrace to reflect that
        for (var i = this.cleanTrace.length - 1; i >= 0; i--){
          if (this.cleanTrace[i].additional && this.cleanTrace[i].additional.scrape){
            // todo: do we need to add this to the above condition:
            // && !(["keyup", "keypress", "keydown"].indexOf(this.cleanTrace[i].data.type) > -1)
            // todo: the below is commented out for debugging;  fix it
            this.cleanTrace.splice(i, 1);
          }
        }
        console.log("shortened cleantrace", this.cleanTrace);
        return [relationColumnUsed];
      }
      else {
        return [];
      }
    };
    this.unParameterizeForRelation = function(relation){
      unParameterizeNodeWithRelation(this, relation);
      // have to go back to actually running the scraping interactions...
      // note! right now unparameterizing a scrape statement adds back in all the removed scraping events, which won't always be necessary
      // should really do it on a relation by relation basis, only remove the ones related to the current relation
      this.cleanTrace = cleanTrace(this.trace);
    };

    this.args = function(){
      var args = [];
      args.push({type:"node", value: currentNodeXpath(this)});
      args.push({type:"tab", value: currentTab(this)});
      if (this.preferredXpath){
        args.push({type:"node", value: this.preferredXpath});
      }
      return args;
    };

    this.xpaths = [];
    this.postReplayProcessing = function(trace, temporaryStatementIdentifier){
      if (this.currentNode instanceof WebAutomationLanguage.VariableUse){
        // this scrape statement is parameterized, so we can just grab the current value from the node...
        if (this.scrapeLink){
          this.currentNodeCurrentValue = this.currentNode.currentLink();
        }
        else{
          this.currentNodeCurrentValue = this.currentNode.currentText();
        }
      }
      else{
        // it's not just a relation item, so relation extraction hasn't extracted it, so we have to actually look at the trace
        // find the scrape that corresponds to this scrape statement based on temporarystatementidentifier
        var ourStatementTraceSegment = _.filter(trace, function(ev){return EventM.getTemporaryStatementIdentifier(ev) === temporaryStatementIdentifier;});
        for (var i = 0; i < ourStatementTraceSegment.length; i++){
          if (ourStatementTraceSegment[i].additional && ourStatementTraceSegment[i].additional.scrape && ourStatementTraceSegment[i].additional.scrape.text){
            if (this.scrapeLink){
              this.currentNodeCurrentValue = ourStatementTraceSegment[i].additional.scrape.link;
            }
            else{
              this.currentNodeCurrentValue = ourStatementTraceSegment[i].additional.scrape.text;
            }
            break;
          }
        }

        // it's not a relation item, so let's start keeping track of the xpaths of the nodes we actually find, so we can figure out if we want to stop running full similarity
        // note, we could factor this out and let this apply to other statement types --- clicks, typing
        // but empirically, have mostly had this issue slowing down scraping, not clicks and the like, since there are usually few of those
        if (!this.preferredXpath){ // if we haven't yet picked a preferredXpath...
          var firstNodeUse = ourStatementTraceSegment[0]; // assumption: the first event is always going to be the interaction with the scraped item.  if break this, must change!
          var xpath = firstNodeUse.target.xpath;
          this.xpaths.push(xpath);
          console.log("this.xpaths", this.xpaths);
          if (this.xpaths.length === 5){ // todo: 3 is just for debugging!
            // ok, we have enough data now that we might be able to decide to do something smarter
            var uniqueXpaths = _.uniq(this.xpaths);
            if (uniqueXpaths.length === 1){
              // we've used the exact same one this whole time...  let's try using that as our preferred xpath
              this.preferredXpath = uniqueXpaths[0];
              console.log("chose preferredXpath", this.preferredXpath);
            }
          }
        }
        else {
          // we've already decided we have a preferred xpath.  we should check and make sure we're still using it.  if we had to revert to using similarity
          // we should stop trying to use the current preferred xpath, start tracking again.  maybe the page has been redesigned and we can discover a new preferred xpath
          // so we'll enter that phase again
          var firstNodeUse = ourStatementTraceSegment[0]; // assumption: the first event is always going to be the interaction with the scraped item.  if break this, must change!
          var xpath = firstNodeUse.target.xpath;
          if (xpath !== this.preferredXpath){
            this.preferredXpath = null;
            this.xpaths = [];
          }
        }
      }
    };
  };
  pub.TypeStatement = function(trace){
    Revival.addRevivalLabel(this);
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
      this.currentNode = this.node;
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
    }

    this.clearRunningState = function(){
      return;
    }

    this.toStringLines = function(){
      if (!this.onlyKeyups && !this.onlyKeydowns){
        // normal processing, for when there's actually a typed string
        var stringRep = "";
        if (this.currentTypedString instanceof WebAutomationLanguage.Concatenate){
          stringRep = this.currentTypedString.toString();
        }
        else{
          stringRep = "'"+this.currentTypedString+"'";
        }
        return [outputPagesRepresentation(this)+"type("+this.pageVar.toString()+", "+stringRep+")"];
      }
      else{
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
      }
    };

    this.traverse = function(fn){
      fn(this);
    };

    this.pbvs = function(){
      var pbvs = [];
      if (currentTab(this)){
        // do we actually know the target tab already?  if yes, go ahead and paremterize that
        pbvs.push({type:"tab", value: originalTab(this)});
      }
      if (this.node !== this.currentNode){
        pbvs.push({type:"node", value: this.node});
      }
      if (this.typedString !== this.currentTypedString){
        pbvs.push({type:"typedString", value: this.typedString});
      }
      return pbvs;
    };

    this.parameterizeForRelation = function(relation){
      var relationColumnUsed = parameterizeNodeWithRelation(this, relation, this.pageVar);

      if (!this.onlyKeydowns && !this.onlyKeyups){
        // now let's also parameterize the text
        var columns = relation.columns;
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
            components.push(new WebAutomationLanguage.VariableUse(columns[i], relation, this.pageVar));
            var right = text.slice(startIndex + this.typedString.length, text.length);
            if (right.length > 0){
              components.push(right)
            }
            this.currentTypedString = new WebAutomationLanguage.Concatenate(components);
            return [relationColumnUsed, columns[i]];
          }
        }
      }

      return [relationColumnUsed];
    };
    this.unParameterizeForRelation = function(relation){
      unParameterizeNodeWithRelation(this, relation);
    };

    function currentNodeText(statement){
      if (statement.currentTypedString instanceof WebAutomationLanguage.Concatenate){
        return statement.currentTypedString.currentText();
      }
      return statement.currentTypedString; // this means currentNode better be a string if it's not a concatenate node
    }

    this.args = function(){
      var args = [];
      args.push({type:"node", value: currentNodeXpath(this)});
      args.push({type:"typedString", value: currentNodeText(this)});
      args.push({type:"tab", value: currentTab(this)});
      return args;
    };

    this.postReplayProcessing = function(trace, temporaryStatementIdentifier){
      return;
    };
  };

  pub.OutputRowStatement = function(scrapeStatements){
    Revival.addRevivalLabel(this);

    if (scrapeStatements){ // we will sometimes initialize with undefined, as when reviving a saved program
      this.trace = []; // no extra work to do in r+r layer for this
      this.cleanTrace = [];
      this.scrapeStatements = scrapeStatements;
      this.relations = [];
    }

    this.clearRunningState = function(){
      return;
    }

    this.toStringLines = function(){
      var nodeRepLs = _.map(this.scrapeStatements, function(statement){return nodeRepresentation(statement, statement.scrapeLink);});
      return ["addOutputRow(["+nodeRepLs.join(",")+",time])"];
    };

    this.traverse = function(fn){
      fn(this);
    };

    this.pbvs = function(){
      return [];
    };

    this.parameterizeForRelation = function(relation){
      if (relation instanceof WebAutomationLanguage.TextRelation){
        // for now, we assume that we always want to include in our scraped data all cells of the text relation
        this.relations = _.union(this.relations, [relation]); // add relation if it's not already in there
        return relation.columns;
      }
      return [];
    };
    this.unParameterizeForRelation = function(relation){
      this.relations = _.without(this.relations, relation);
    };
    this.args = function(){
      return [];
    };
    this.postReplayProcessing = function(trace, temporaryStatementIdentifier){
      // we've 'executed' an output statement.  better send a new row to our output
      var cells = [];
      // get all the cells that we'll get from the text relations
      for (var i = 0; i < this.relations.length; i++){
        var relation = this.relations[i];
        var newCells = relation.getCurrentCellsText();
        cells = cells.concat(newCells);
      }
      // get all the cells that we'll get from the scrape statements
      _.each(this.scrapeStatements, function(scrapeStatment){
        cells.push(scrapeStatment.currentNodeCurrentValue);
      });
      cells.push(new Date().getTime()); // might be useful to know the current time.  although not sure if this is how we want to handle it.  todo: better way?
      RecorderUI.addNewRowToOutput(cells);
      ReplayScript.prog.currentDataset.addRow(cells); // todo: is replayscript.prog really the best way to access the prog object so that we can get the current dataset object, save data to server?
      ReplayScript.prog.mostRecentRow = cells;
    };
  }

  /*
  Statements below here are no longer executed by Ringer but rather by their own run methods
  */

  pub.BackStatement = function(pageVarCurr, pageVarBack){
    Revival.addRevivalLabel(this);
    var backStatement = this;
    if (pageVarCurr){ // we will sometimes initialize with undefined, as when reviving a saved program
      this.pageVarCurr = pageVarCurr;
      this.pageVarBack = pageVarBack;
    }

    this.clearRunningState = function(){
      return;
    }

    this.toStringLines = function(){
      // back statements are now invisible cleanup, not normal statements, so don't use the line below for now
      // return [this.pageVarBack.toString() + " = " + this.pageVarCurr.toString() + ".back()" ];
      return [];
    };

    this.traverse = function(fn){
      fn(this);
    };

    this.run = function(programObj, rbbcontinuation){
      console.log("run back statement");

      // ok, the only thing we're doing right now is trying to run this back button, so the next time we see a tab ask for an id
      // it should be because of this -- yes, theoretically there could be a process we started earlier that *just* decided to load a new top-level page
      // but that should probably be rare.  todo: is that actually rare?
      utilities.listenForMessageOnce("content", "mainpanel", "requestTabID", function(data){
        console.log("back completed");
        backStatement.pageVarBack.setCurrentTabId(backStatement.pageVarCurr.tabId, function(){rbbcontinuation(false);});
      });

      // send a back message to pageVarCurr
      utilities.sendMessage("mainpanel", "content", "backButton", {}, null, null, [this.pageVarCurr.currentTabId()]);
      // todo: is it enough to just send this message and hope all goes well, or do we need some kind of acknowledgement?
      // update pageVarBack to make sure it has the right tab associated

      // todo: if we've been pressing next or more button within this loop, we might have to press back button a bunch of times!  or we might not if they chose not to make it a new page!  how to resolve????
    };

    this.parameterizeForRelation = function(relation){
      return [];
    };
    this.unParameterizeForRelation = function(relation){
      return;
    };
  };

  pub.ClosePageStatement = function(pageVarCurr){
    Revival.addRevivalLabel(this);
    if (pageVarCurr){ // we will sometimes initialize with undefined, as when reviving a saved program
      this.pageVarCurr = pageVarCurr;
    }
    var that = this;

    this.clearRunningState = function(){
      return;
    }

    this.toStringLines = function(){
      // close statements are now invisible cleanup, not normal statements, so don't use the line below for now
      // return [this.pageVarCurr.toString() + ".close()" ];
      return [];
    };

    this.traverse = function(fn){
      fn(this);
    };

    this.run = function(programObj, rbbcontinuation){
      console.log("run close statement");

      var tabId = this.pageVarCurr.currentTabId();
      if (tabId !== undefined && tabId !== null){
        chrome.tabs.remove(this.pageVarCurr.currentTabId(), function(){
            that.pageVarCurr.clearCurrentTabId();
            rbbcontinuation();
          }); 
      }
      else{
        console.log("Warning: trying to close tab for pageVar that didn't have a tab associated at the moment.  Can happen after continue statement.");
        rbbcontinuation();
      }
    };

    this.parameterizeForRelation = function(relation){
      return [];
    };
    this.unParameterizeForRelation = function(relation){
      return;
    };
  };

  pub.ContinueStatement = function(){
    Revival.addRevivalLabel(this);

    this.clearRunningState = function(){
      return;
    }

    this.toStringLines = function(){
      return ["continue"];
    };

    this.traverse = function(fn){
      fn(this);
    };

    this.run = function(programObj, rbbcontinuation){
      // fun stuff!  time to flip on the 'continue' flag in our continuations, which the for loop continuation will eventually consume and turn off
      rbbcontinuation(true);
    };

    this.parameterizeForRelation = function(relation){
      return [];
    };
    this.unParameterizeForRelation = function(relation){
      return;
    };
  };

  pub.IfStatement = function(bodyStatements){
    Revival.addRevivalLabel(this);

    if (bodyStatements){ // we will sometimes initialize with undefined, as when reviving a saved program
      this.bodyStatements = bodyStatements;
    }

    this.clearRunningState = function(){
      return;
    }

    this.toStringLines = function(){
      return ["if"]; // todo: when we have the real if statements, do the right thing
    };

    this.traverse = function(fn){
      fn(this);
      for (var i = 0; i < this.bodyStatements.length; i++){
        this.bodyStatements[i].traverse(fn);
      }
    };

    this.run = function(programObj, rbbcontinuation){
      // todo: the condition is hard-coded for now, but obviously we should ultimately have real conds
      if (programObj.environment.envLookup("cases.case_id").indexOf("CVG") !== 0){ // todo: want to check if first scrape statement scrapes something with "CFG" in it
        if (this.bodyStatements.length < 1){
          // ok seriously, why'd you make an if with no body?  come on.
          rbbcontinuation(false);
          return;
        }
        // let's run the first body statement, make a continuation for running the remaining ones
        var bodyStatements = this.bodyStatements;
        var currBodyStatementsIndex = 1;
        var bodyStatmentsLength = this.bodyStatements.length;
        var newContinuation = function(continueflag){ // remember that rbbcontinuations must always handle continueflag
          if (continueflag){
            // executed a continue statement, so don't carry on with this if
            rbbcontinuation(true);
            return;
          }
          if (currBodyStatementsIndex === bodyStatmentsLength){
            // finished with the body statements, call original continuation
            rbbcontinuation(false);
            return;
          }
          else{
            // still working on the body of the current if statement, keep going
            currBodyStatementsIndex += 1;
            bodyStatements[currBodyStatementsIndex - 1].run(programObj, newContinuation);
          }
        }
        // actually run that first statement
        bodyStatements[0].run(programObj, newContinuation);
      }
      else{
        // for now we don't have else body statements for our ifs, so we should just carry on with execution
        rbbcontinuation(false);
      }

    }
    this.parameterizeForRelation = function(relation){
      // todo: once we have real conditions may need to do something here
      return [];
    };
    this.unParameterizeForRelation = function(relation){
      return;
    };
  };

  /*
  Loop statements not executed by run method, although may ultimately want to refactor to that
  */

  pub.LoopStatement = function(relation, relationColumnsUsed, bodyStatements, pageVar){
    Revival.addRevivalLabel(this);

    if (bodyStatements){ // we will sometimes initialize with undefined, as when reviving a saved program
      this.relation = relation;
      this.relationColumnsUsed = relationColumnsUsed;
      this.bodyStatements = bodyStatements;
      this.pageVar = pageVar;
      this.maxRows = null; // note: for now, can only be sat at js console.  todo: eventually should have ui interaction for this.
      this.rowsSoFar = 0;
    }

    this.clearRunningState = function(){
      this.rowsSoFar = 0;
      return;
    }

    this.toStringLines = function(){
      var relation = this.relation;
      var varNames = _.map(relationColumnsUsed, function(columnObject){return columnObject.name;});
      var prefix = "";
      if (this.relation instanceof WebAutomationLanguage.TextRelation){
        var prefix = "for "+varNames.join(", ")+" in "+this.relation.name+":"; 
      }
      else{
        var prefix = "for "+varNames.join(", ")+" in "+this.pageVar.toString()+"."+this.relation.name+":"; 
      }
      var statementStrings = _.reduce(this.bodyStatements, function(acc, statement){return acc.concat(statement.toStringLines());}, []);
      statementStrings = _.map(statementStrings, function(line){return ("&nbsp&nbsp&nbsp&nbsp "+line);});
      return [prefix].concat(statementStrings);
    };

    this.traverse = function(fn){
      fn(this);
      for (var i = 0; i < this.bodyStatements.length; i++){
        this.bodyStatements[i].traverse(fn);
      }
    };

    this.parameterizeForRelation = function(relation){
      return _.flatten(_.map(this.bodyStatements, function(statement){return statement.parameterizeForRelation(relation);}));
    };
    this.unParameterizeForRelation = function(relation){
      _.each(this.bodyStatements, function(statement){statement.unParameterizeForRelation(relation);});
    };
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
  pub.TextRelation = function(csvFileContents){
    Revival.addRevivalLabel(this);
    if (csvFileContents){ // we will sometimes initialize with undefined, as when reviving a saved program
      this.relation = $.csv.toArrays(csvFileContents);
      this.firstRowTexts = this.relation[0];
    }

    this.demonstrationTimeRelationText = function(){
      return this.relation;
    }

    this.columns = [];
    this.processColumns = function(){
      for (var i = 0; i < this.relation[0].length; i++){
        this.columns.push({index: i, name: "column_"+i, firstRowXpath: null, xpath: null, firstRowText: this.firstRowTexts[i]}); // todo: don't actually want to put filler here
      }
    };
    this.processColumns();

    this.getColumnObjectFromXpath = function(xpath){
      for (var i = 0; i < this.columns.length; i++){
        if (this.columns[i].xpath === xpath){
          return this.columns[i];
        }
      }
      console.log("Ack!  No column object for that xpath: ", this.columns, xpath);
      return null;
    };

    // user can give us better names
    this.setColumnName = function(columnObj, v){
      columnObj.name = v;
    };

    this.usedByStatement = function(statement){
      return usedByTextStatement(statement, this.relation[0]);
    };

    var currentRowsCounter = -1;
    var length = this.relation.length;

    this.getNextRow = function(pageVar, callback){ // has to be called on a page, to match the signature for the non-text relations, but we'll ignore the pagevar
      if (currentRowsCounter + 1 >= length){
        callback(false); // no more rows -- let the callback know we're done
      }
      else{
        currentRowsCounter += 1;
        callback(true);
      }
    }

    this.getCurrentCellsText = function(pageVar){
      var cells = [];
      for (var i = 0; i < this.columns.length; i++){
        var cellText = this.getCurrentText(pageVar, this.columns[i]);
        cells.push(cellText);
      }
      return cells;
    }

    this.getCurrentText = function(pageVar, columnObject){
      console.log(currentRowsCounter, "currentRowsCounter");
      return this.relation[currentRowsCounter][columnObject.index];
    }

    this.getCurrentLink = function(pageVar, columnObject){
      console.log("yo, why are you trying to get a link from a text relation???");
      return "";
    }

    this.getCurrentMappingFromVarNamesToValues = function(pageVar){
      var map = {};
      for (var i = 0; i < this.columns.length; i++){
        var name = this.columns[i].name; // todo: this is going to lead to a lot of shadowing if we have nested text relations!  really need to give text relations names...
        var value = this.getCurrentText(pageVar, this.columns[i]);
        map[name] = value;
      }
      return map;
    }

    this.clearRunningState = function(){
      currentRowsCounter = -1;
    };
  }

  var relationCounter = 0;
  pub.Relation = function(relationId, name, selector, selectorVersion, excludeFirst, columns, demonstrationTimeRelation, numRowsInDemo, pageVarName, url, nextType, nextButtonSelector){
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
      if (name === undefined || name === null){
        relationCounter += 1;
        this.name = "relation_"+relationCounter;
      }
      else{
        this.name = name;
      }
    }

    var relation = this;

    this.demonstrationTimeRelationText = function(){
      return _.map(this.demonstrationTimeRelation, function(row){return _.map(row, function(cell){return cell.text;});});
    }

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

    this.processColumns = function(oldColumns){
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
      console.log(this);
      this.processColumns();
    }

    function initialize(){
      relation.firstRowXPaths = _.pluck(relation.demonstrationTimeRelation[0], "xpath");
      relation.firstRowTexts = _.pluck(relation.demonstrationTimeRelation[0], "text");
    }
    
    if (doInitialization){
      initialize();
    }

    this.setNewAttributes = function(selector, selectorVersion, excludeFirst, columns, demonstrationTimeRelation, numRowsInDemo, nextType, nextButtonSelector){
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

    this.nameColumnsAndRelation = function(){
      // should eventually consider looking at existing columns to suggest columns names
    }
    this.nameColumnsAndRelation();

    this.getColumnObjectFromXpath = function(xpath){
      for (var i = 0; i < this.columns.length; i++){
        if (this.columns[i].xpath === xpath){
          return this.columns[i];
        }
      }
      console.log("Ack!  No column object for that xpath: ", this.columns, xpath);
      return null;
    };

    // user can give us better names
    this.setColumnName = function(columnObj, v){
      columnObj.name = v;
    };

    this.usedByStatement = function(statement){
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

    this.messageRelationRepresentation = function(){
      return {id: this.id, name: this.name, selector: this.selector, selector_version: this.selectorVersion, exclude_first: this.excludeFirst, columns: this.columns, next_type: this.nextType, next_button_selector: this.nextButtonSelector, url: this.url, num_rows_in_demonstration: this.numRowsInDemo};
    };

    this.noMoreRows = function(prinfo, callback){
      // no more rows -- let the callback know we're done
      // clear the stored relation data also
      prinfo.currentRows = null;
      prinfo.currentRowsCounter = 0;
      callback(false); 
    };

    this.gotMoreRows = function(prinfo, callback, rel){
      prinfo.needNewRows = false; // so that we don't fall back into this same case even though we now have the items we want
      prinfo.currentRows = rel;
      prinfo.currentRowsCounter = 0;
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

    // the funciton that we'll call when we actually have to go back to a page for freshRelationItems
    function getRowsFromPageVar(pageVar, callback, prinfo){
      
      if (!pageVar.currentTabId()){ console.log("Hey!  How'd you end up trying to find a relation on a page for which you don't have a current tab id??  That doesn't make sense.", pageVar); }
  
      var relationItemsRetrieved = {};
      var missesSoFar = {};

      var done = false;
      // once we've gotten data from any frame, this is the function we'll call to process all the results
      var handleNewRelationItemsFromFrame = function(data, frameId){
        if (done){
          return;
        }
        console.log("data", data);
        if (data.type === RelationItemsOutputs.NOMOREITEMS || (data.type === RelationItemsOutputs.NONEWITEMSYET && missesSoFar[frameId] > 40)){
          // NOMOREITEMS -> definitively out of items.  this relation is done
          // NONEWITEMSYET && missesSoFar > 60 -> ok, time to give up at this point...
          relationItemsRetrieved[frameId] = data; // to stop us from continuing to ask for freshitems
          // ????? done = true;
          // ????? relation.noMoreRows(prinfo, callback);
        }
        else if (data.type === RelationItemsOutputs.NONEWITEMSYET || (data.type === RelationItemsOutputs.NEWITEMS && data.relation.length === 0)){
          // todo: currently if we get data but it's only 0 rows, it goes here.  is that just an unnecessary delay?  should we just believe that that's the final answer?
          missesSoFar[frameId] += 1;
        }
        else if (data.type === RelationItemsOutputs.NEWITEMS){
          // yay, we have real data!

          // ok, the content script is supposed to prevent us from getting the same thing that it already sent before
          // but to be on the safe side, let's put in some extra protections so we don't try to advance too early
          if (prinfo.currentRows && _.isEqual(prinfo.currentRows, data.relation)){
            console.log("This really shouldn't happen.  We got the same relation back from the content script that we'd already gotten.");
            console.log(prinfo.currentRows);
            missesSoFar[frameId] += 1;
            return;
          }
          else{
            console.log("The relations are different.");
            console.log(prinfo.currentRows, data.relation);
          }

          relationItemsRetrieved[frameId] = data; // to stop us from continuing to ask for freshitems

          // let's see if this one has xpaths for all of a row in the first few
          var aRowWithAllXpaths = highestPercentOfHasXpathPerRow(data.relation, 20) === 1;
          // and then see if the difference between the num rows and the target num rows is less than 20% of the target num rows 
          var targetNumRows = relation.demonstrationTimeRelation.length;
          var diffPercent = Math.abs(data.relation.length - targetNumRows) / targetNumRows;
          
          // only want to do the below if we've decided this is the actual data...
          // if this is the only frame, then it's definitely the data
          if (Object.keys(relationItemsRetrieved).length == 1 || (aRowWithAllXpaths && diffPercent < .2 )){
            done = true;
            relation.gotMoreRows(prinfo, callback, data.relation);
            return;
          }
        }
        else{
          console.log("woaaaaaah freak out, there's freshRelationItems that have an unknown type.");
        }
        console.log("relationItemsRetrieved", relationItemsRetrieved);

        var allDefined = _.reduce(Object.keys(relationItemsRetrieved), function(acc, key){return acc && relationItemsRetrieved[key];}, true);
        if (allDefined){
          // ok, we have 'real' (NEWITEMS or decided we're done) data for all of them, we won't be getting anything new, better just pick the best one
          done = true;
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
              done = true;
              relation.gotMoreRows(prinfo, callback, data.relation);
              return;
            }
          }

          // drat, even with our more flexible requirements, still didn't find one that works.  guess we're done?
          done = true;
          relation.noMoreRows(prinfo, callback);
          return;
        }
      };

      // let's go ask all the frames to give us relation items for the relation
      var tabId = pageVar.currentTabId();
      chrome.webNavigation.getAllFrames({tabId: tabId}, function(details) {
          relationItemsRetrieved = {};
          missesSoFar = {};
          details.forEach(function(frame){
            // keep track of which frames need to respond before we'll be read to advance
            relationItemsRetrieved[frame.frameId] = false;
            missesSoFar[frame.frameId] = 0;
          });
          details.forEach(function(frame) {
            // for each frame in the target tab, we want to see if the frame retrieves good relation items
            // we'll pick the one we like best
            // todo: is there a better way?  after all, we do know the frame in which the user interacted with the first page at original record-time.  if we have next stuff happening, we might even know the exact frameId on this exact page
            
            // here's the function for sending the message once
            var msg = relation.messageRelationRepresentation();
            msg.msgType = "getFreshRelationItems";
            var sendGetRelationItems = function(){
              utilities.sendFrameSpecificMessage("mainpanel", "content", "getFreshRelationItems", 
                                                  relation.messageRelationRepresentation(), 
                                                  tabId, frame.frameId, 
                                                  // question: is it ok to insist that every single frame returns a non-null one?  maybe have a timeout?  maybe accept once we have at least one good response from one of the frames?
                                                  function(response) { if (response !== null) {handleNewRelationItemsFromFrame(response, frame.frameId);}}); // when get response, call handleNewRelationItemsFromFrame (defined above) to pick from the frames' answers
            };
            // here's the function for sending the message until we get the answer
            MiscUtilities.repeatUntil(sendGetRelationItems, function(){return relationItemsRetrieved[frame.frameId];}, 1000);
          });
      });

    }


    this.getNextRow = function(pageVar, callback){ // has to be called on a page, since a relation selector can be applied to many pages.  higher-level tool must control where to apply
      // todo: this is a very simplified version that assumes there's only one page of results.  add the rest soon.

      // ok, what's the page info on which we're manipulating this relation?
      console.log(pageVar.pageRelations);
      var prinfo = pageVar.pageRelations[this.name+"_"+this.id]; // separate relations can have same name (no rule against that) and same id (undefined if not yet saved to server), but since we assign unique names when not saved to server and unique ides when saved to server, should be rare to have same both.  todo: be more secure in future
      if (prinfo === undefined){ // if we haven't seen the frame currently associated with this pagevar, need to clear our state and start fresh
        prinfo = {currentRows: null, currentRowsCounter: 0, currentTabId: pageVar.currentTabId()};
        pageVar.pageRelations[this.name+"_"+this.id] = prinfo;
      }

      // now that we have the page info to manipulate, what do we need to do to get the next row?
      console.log("getnextrow", this, prinfo.currentRowsCounter);
      if (prinfo.currentRows === null || prinfo.needNewRows){
        // cool!  no data right now, so we have to go to the page and ask for some
        getRowsFromPageVar(pageVar, callback, prinfo);
      }
      else if (prinfo.currentRowsCounter + 1 >= prinfo.currentRows.length){
        // ok, we had some data but we've run out.  time to try running the next button interaction and see if we can retrieve some more

        // here's what we want to do once we've actually clicked on the next button, more button, etc
        // essentially, we want to run getNextRow again, ready to grab new data from the page that's now been loaded or updated
        var runningNextInteraction = false;
        utilities.listenForMessageOnce("content", "mainpanel", "runningNextInteraction", function(data){
          runningNextInteraction = true;
          // cool, and now let's start the process of retrieving fresh items by calling this function again
          prinfo.needNewRows = true;
          relation.getNextRow(pageVar, callback);
        });

        // here's us telling the content script to take care of clicking on the next button, more button, etc
        if (!pageVar.currentTabId()){ console.log("Hey!  How'd you end up trying to click next button on a page for which you don't have a current tab id??  That doesn't make sense.", pageVar); }
        var sendRunNextInteraction = function(){
          utilities.sendMessage("mainpanel", "content", "runNextInteraction", relation.messageRelationRepresentation(), null, null, [pageVar.currentTabId()]);};
        MiscUtilities.repeatUntil(sendRunNextInteraction, function(){return runningNextInteraction;}, 1000);
      }
      else {
        // we still have local rows that we haven't used yet.  just advance the counter to change which is our current row
        // the easy case :)
        prinfo.currentRowsCounter += 1;
        callback(true);
      }
    }

    this.getCurrentCellsText = function(pageVar){
      var cells = [];
      for (var i = 0; i < this.columns.length; i++){
        var cellText = this.getCurrentText(pageVar, this.columns[i]);
        cells.push(cellText);
      }
      return cells;
    }

    this.getCurrentXPath = function(pageVar, columnObject){
      var prinfo = pageVar.pageRelations[this.name+"_"+this.id]
      if (prinfo === undefined){ console.log("Bad!  Shouldn't be calling getCurrentXPath on a pageVar for which we haven't yet called getNextRow."); return null; }
      return prinfo.currentRows[prinfo.currentRowsCounter][columnObject.index].xpath; // in the current row, xpath at the index associated with nodeName
    }

    this.getCurrentText = function(pageVar, columnObject){
      var prinfo = pageVar.pageRelations[this.name+"_"+this.id]
      if (prinfo === undefined){ console.log("Bad!  Shouldn't be calling getCurrentText on a pageVar for which we haven't yet called getNextRow."); return null; }
      if (prinfo.currentRows === undefined) {console.log("Bad!  Shouldn't be calling getCurrentText on a prinfo with no currentRows.", prinfo); return null;}
      if (prinfo.currentRows[prinfo.currentRowsCounter] === undefined) {console.log("Bad!  Shouldn't be calling getCurrentText on a prinfo with a currentRowsCounter that doesn't correspond to a row in currentRows.", prinfo); return null;}
      return prinfo.currentRows[prinfo.currentRowsCounter][columnObject.index].text; // in the current row, value at the index associated with nodeName
    }

    this.getCurrentLink = function(pageVar, columnObject){
      var prinfo = pageVar.pageRelations[this.name+"_"+this.id]
      if (prinfo === undefined){ console.log("Bad!  Shouldn't be calling getCurrentLink on a pageVar for which we haven't yet called getNextRow."); return null; }
      if (prinfo.currentRows === undefined) {console.log("Bad!  Shouldn't be calling getCurrentLink on a prinfo with no currentRows.", prinfo); return null;}
      if (prinfo.currentRows[prinfo.currentRowsCounter] === undefined) {console.log("Bad!  Shouldn't be calling getCurrentLink on a prinfo with a currentRowsCounter that doesn't correspond to a row in currentRows.", prinfo); return null;}
      return prinfo.currentRows[prinfo.currentRowsCounter][columnObject.index].link; // in the current row, value at the index associated with nodeName
    }

    this.getCurrentMappingFromVarNamesToValues = function(pageVar){
      var map = {};
      for (var i = 0; i < this.columns.length; i++){
        var name = this.name+"."+this.columns[i].name;
        var value = this.getCurrentText(pageVar, this.columns[i]);
        map[name] = value;
      }
      return map;
    }

    this.saveToServer = function(){
      // sample: $($.post('http://localhost:3000/saverelation', { relation: {name: "test", url: "www.test2.com/test-test2", selector: "test2", selector_version: 1, num_rows_in_demonstration: 10}, columns: [{name: "col1", xpath: "a[1]/div[1]", suffix: "div[1]"}] } ));
      var rel = ServerTranslationUtilities.JSONifyRelation(this); // note that JSONifyRelation does stable stringification
      $.post('http://kaofang.cs.berkeley.edu:8080/saverelation', {relation: rel});
    }

    var tabReached = false;
    this.editSelector = function(){
      // show the UI for editing the selector
      // we need to open up the new tab that we'll use for showing and editing the relation, and we need to set up a listener to update the selector associated with this relation, based on changes the user makes over at the content script
      tabReached = false;
      chrome.tabs.create({url: this.url, active: true}, function(tab){
        RecorderUI.showRelationEditor(relation, tab.id);
        var sendSelectorInfo = function(){utilities.sendMessage("mainpanel", "content", "editRelation", relation.messageRelationRepresentation(), null, null, [tab.id]);};
        var sendSelectorInfoUntilAnswer = function(){
          if (tabReached){ return; } 
          sendSelectorInfo(); 
          setTimeout(sendSelectorInfoUntilAnswer, 1000);}
        setTimeout(sendSelectorInfoUntilAnswer, 500); // give it a while to attach the listener
      });
      // now we've sent over the current selector info.  let's set up the listener that will update the preview (and the object)
      utilities.listenForMessageWithKey("content", "mainpanel", "editRelation", "editRelation", function(data){relation.selectorFromContentScript(data)}); // remember this will overwrite previous editRelation listeners, since we're providing a key
    }

    this.selectorFromContentScript = function(msg){
      tabReached = true;
      this.setNewAttributes(msg.selector, msg.selector_version, msg.exclude_first, msg.columns, msg.demonstration_time_relation, msg.num_rows_in_demo, msg.next_type, msg.next_button_selector);
      RecorderUI.updateDisplayedRelation(this);
      RecorderUI.setColumnColors(msg.colors, msg.columns, msg.tab_id);
    };

    this.clearRunningState = function(){
      // for relations retrieved from pages, all relation info is stored with pagevar variables, so don't need to do anything
    };
  }

  // todo: for now all variable uses are uses of relation cells, but eventually will probably want to have scraped from outside of relations too
  pub.VariableUse = function(columnObject, relation, pageVar, link){
    Revival.addRevivalLabel(this);
    if (link === undefined){ link = false; }

    if (columnObject){ // will sometimes call with undefined, as for revival
      this.columnObject = columnObject;
      this.relation = relation;
      this.pageVar = pageVar;
      this.link = link; // is this variable use actually using the link of the node rather than just the node or the text
    }

    this.toString = function(){
      if (this.link){
        return this.columnObject.name + ".link";
      }
      return this.columnObject.name;
    };

    this.currentXPath = function(){
      return this.relation.getCurrentXPath(this.pageVar, this.columnObject);
    };

    this.currentText = function(){
      return this.relation.getCurrentText(this.pageVar, this.columnObject);
    };

    this.currentLink = function(){
      return this.relation.getCurrentLink(this.pageVar, this.columnObject);
    };
  }

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
    console.log("**************");
    console.log(sortedList.array);
    console.log(q1, q3, iqr);
    console.log(minValue, maxValue);
    console.log("**************");
    if (potentialItem < minValue || potentialItem > maxValue){
      return true;
    }
    return false;
  }

  pub.PageVariable = function(name, recordTimeUrl){
    Revival.addRevivalLabel(this);

    if (name){ // will sometimes call with undefined, as for revival
      this.name = name;
      this.recordTimeUrl = recordTimeUrl;
      this.pageRelations = {};
      this.pageStats = freshPageStats();
    }

    var that = this;

    function freshPageStats(){
      return {numNodes: new SortedArray([])};
    }

    this.setRecordTimeFrameData = function(frameData){
      this.recordTimeFrameData = frameData;
    };

    this.setCurrentTabId = function(tabId, continuation){
      console.log("setCurrentTabId", tabId);
      this.tabId = tabId;
      if (tabId !== undefined){
        utilities.listenForMessageOnce("content", "mainpanel", "pageStats", function(data){
          if (that.pageOutlier(data)){
            console.log("This was an outlier page!");
            var dialogText = "Woah, this page looks very different from what we expected.  We thought we'd get a page that looked like this:";
            if (ReplayScript.prog.mostRecentRow){
              dialogText += "<br>If it's helpful, the last row we scraped looked like this:<br>";
              dialogText += DOMCreationUtilities.arrayOfArraysToTable([ReplayScript.prog.mostRecentRow]).html(); // todo: is this really the best way to acess the most recent row?
            }
            RecorderUI.addDialog("Weird Page", dialogText, 
              {"I've fixed it": function(){console.log("I've fixed it."); that.setCurrentTabId(tabId, continuation);}, 
              "That's the right page": function(){/* bypass outlier checking */console.log("That's the right page."); that.nonOutlierProcessing(data, continuation);}});
          }
          else {
            that.nonOutlierProcessing(data, continuation);
          }
        });
        utilities.sendMessage("mainpanel", "content", "pageStats", {}, null, null, [tabId], null);
      }
      else{
        continuation();
      }
    };

    this.clearCurrentTabId = function(){
      this.tabId = undefined;
    };

    this.nonOutlierProcessing = function(pageData, continuation){
      // wasn't an outlier, so let's actually update the pageStats
      this.updatePageStats(pageData);
      continuation();
    }

    this.pageOutlier = function(pageData){
      return outlier(this.pageStats.numNodes, pageData.numNodes); // in future, maybe just iterate through whatever attributes we have, but not sure yet
    }

    this.updatePageStats = function(pageData){
      this.pageStats.numNodes.insert(pageData.numNodes); // it's sorted
    }
    
    this.clearRelationData = function(){
      this.pageRelations = {};
    }

    this.originalTabId = function(){
      console.log(this.recordTimeFrameData);
      return this.recordTimeFrameData.tab;
    }

    this.currentTabId = function(){
      return this.tabId;
    }

    this.toString = function(){
      return this.name;
    }

    this.clearRunningState = function(){
      this.tabId = undefined;
      this.pageStats = freshPageStats();
      this.clearRelationData();
    };

  };

  pub.Concatenate = function(components){
    Revival.addRevivalLabel(this);

    if (components){ // will sometimes call with undefined, as for revival
      this.components = components;
    }

    this.currentText = function(){
      var output = "";
      _.each(this.components, function(component){
        if (component instanceof pub.VariableUse){
          output += component.currentText();
        }
        else{
          // this should be a string, since currently can only concat strings and variable uses
          output += component;
        }
      });
      return output;
    }

    this.toString = function(){
      var outputComponents = [];
      _.each(this.components, function(component){
        if (component instanceof pub.VariableUse){
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

  pub.Program = function(statements){
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

    this.toString = function(){
      var statementLs = this.loopyStatements;
      if (this.loopyStatements.length === 0){
        statementLs = this.statements;
      }
      var scriptString = "";
      _.each(statementLs, function(statement){scriptString += statement.toStringLines().join("<br>") + "<br>";});
      return scriptString;
    };

    this.traverse = function(fn){
      for (var i = 0; i < this.loopyStatements.length; i++){
        this.loopyStatements[i].traverse(fn);
      }
    };

    this.getDuplicateDetectionData = function _getDuplicateDetectionData(){
      var loopData = [];
      this.traverse(function(statement){
        if (statement instanceof WebAutomationLanguage.LoopStatement){
          var newLoopItem = {};
          var nodeVars = statement.relationNodeVars();
          var childStatements = statement.getChildren();
          var scrapeChildren = [];
          for (var i = 0; i < childStatements.length; i++){
            var s = childStatements[i];
            if (s instanceof WebAutomationLanguage.ScrapeStatement && s.node instanceof WebAutomationLanguage.NodeVariable){
              scrapeChildren.push(s);
            }
            else if (s instanceof WebAutomationLanguage.LoopStatement){
              // convention right now, since duplicate detection is for avoiding repeat
              // of unnecessary work, is that we make the judgment based on variables available
              // before any nested loops
              break;
            }
          }
          var scrapeChildrenNodeVars = _.map(scrapeChildren, function(scrapeS){return scrapeS.node;});
          nodeVars.concat(scrapeChildrenNodeVars); // ok, nodeVars now has all our nodes
          newLoopItem.nodeVariables = nodeVars;
          // in addition to just sending along the nodeVar objects, we also want to make the table of values
          var displayData = [[], []];
          for (var i = 0; i < nodeVars.length; i++){
            var nv = nodeVars[i];
            displayData[0].push(nv.name() + " text");
            displayData[1].push(nv.recordTimeText());
            displayData[0].push(nv.name() + " link");
            displayData[1].push(nv.recordTimeLink());
          }
          newLoopItem.displayData = displayData;
          loopData.push(newLoopItem);
        }
      });
      return loopData;
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

      SimpleRecord.replay(trace, null, function(){console.log("Done replaying.");});
    };

    function alignRecordTimeAndReplayTimeCompletedEvents(recordTimeTrace, replayTimeTrace){
      // we should see corresponding 'completed' events in the traces
      var recCompleted = _.filter(recordTimeTrace, function(ev){return ev.type === "completed" && ev.data.type === "main_frame";}); // now only doing this for top-level completed events.  will see if this is sufficient
      var repCompleted = _.filter(replayTimeTrace, function(ev){return ev.type === "completed" && ev.data.type === "main_frame";});
      console.log(recCompleted, repCompleted);
      // should have same number of top-level load events.  if not, might be trouble
      if (recCompleted.length !== repCompleted.length){
        console.log("Different numbers of completed events in record and replay: ", recCompleted, repCompleted);
      }
      // todo: for now aligning solely based on point at which the events appear in the trace.  if we get traces with many events, may need to do something more intelligent
      var smallerLength = recCompleted.length;
      if (repCompleted.length < smallerLength) { smallerLength = repCompleted.length;}
      return [recCompleted.slice(0, smallerLength), repCompleted.slice(0, smallerLength)];
    }

    function updatePageVars(recordTimeTrace, replayTimeTrace, continuation){
      // console.log("updatePageVars", recordTimeTrace, replayTimeTrace);
      var recordTimeCompletedToReplayTimeCompleted = alignRecordTimeAndReplayTimeCompletedEvents(recordTimeTrace, replayTimeTrace);
      var recEvents = recordTimeCompletedToReplayTimeCompleted[0];
      var repEvents = recordTimeCompletedToReplayTimeCompleted[1];
      // console.log("recEvents:", recEvents, "repEvents", repEvents);
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
        // console.log("Setting pagevar current tab id to:", repEvents[i].data.tabId);
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
      console.log(recCompleted, repCompleted);
      // should have same number of top-level load events.  if not, might be trouble
      if (recCompleted.length !== repCompleted.length){
        console.log("Different numbers of completed events in record and replay: ", recCompleted, repCompleted);
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

    this.runBasicBlock = function(loopyStatements, callback, skipAllExceptBackAndClose){
      if (skipAllExceptBackAndClose === undefined){ skipAllExceptBackAndClose = false; }
      console.log("rbb", loopyStatements.length, loopyStatements);
      // first check if we're supposed to pause, stop execution if yes
      console.log("RecorderUI.userPaused", RecorderUI.userPaused);
      if (RecorderUI.userPaused){
        RecorderUI.resumeContinuation = function(){program.runBasicBlock(loopyStatements, callback);};
        console.log("paused");
        return;
      }
      console.log("RecorderUI.userStopped", RecorderUI.userStopped);
      if (RecorderUI.userStopped){
        console.log("run stopped");
        RecorderUI.userStopped = false; // set it back so that if the user goes to run again, everything will work
        return;
      }

      if (loopyStatements.length < 1){
        console.log("rbb: empty loopystatments.");
        callback();
        return;
      }
      // for now LoopStatement gets special processing
      else if (loopyStatements[0] instanceof WebAutomationLanguage.LoopStatement){
        if (skipAllExceptBackAndClose){
          // in this case, when we're basically 'continue'ing, it's as if this loop is empty, so skip straight to that
          program.runBasicBlock(loopyStatements.slice(1, loopyStatements.length), callback, skipAllExceptBackAndClose);
          return;
        }
        console.log("rbb: loop.");

        var loopStatement = loopyStatements[0];
        var relation = loopStatement.relation;

        // have we hit the maximum number of iterations we want to do?
        if (loopStatement.maxRows !== null && loopStatement.rowsSoFar >= loopStatement.maxRows){
          // hey, we're done!
          console.log("hit the row limit");
          loopStatement.rowsSoFar = 0;
          // once we're done with the loop, have to replay the remainder of the script
          program.runBasicBlock(loopyStatements.slice(1, loopyStatements.length), callback);
          return;
        }

        loopStatement.relation.getNextRow(loopStatement.pageVar, function(moreRows){
          if (!moreRows){
            // hey, we're done!
            console.log("no more rows");
            loopStatement.rowsSoFar = 0;
            // once we're done with the loop, have to replay the remainder of the script
            program.runBasicBlock(loopyStatements.slice(1, loopyStatements.length), callback);
            return;
          }
          console.log("we have a row!  let's run");
          // otherwise, should actually run the body
          loopStatement.rowsSoFar += 1;
          // block scope.  let's add a new frame
          program.environment = program.environment.envExtend(); // add a new frame on there
          // and let's give us access to all the loop variables
          var loopVarsMap = loopStatement.relation.getCurrentMappingFromVarNamesToValues(loopStatement.pageVar);
          // note that for now loopVarsMap includes all columns of the relation.  may some day want to limit it to only the ones used...
          for (var key in loopVarsMap){
            program.environment.envBind(key, loopVarsMap[key]);
          }
          console.log("loopyStatements", loopyStatements);
          program.runBasicBlock(loopStatement.bodyStatements, function(){ // running extra iterations of the for loop is the only time we change the callback
            // and once we've run the body, we should do the next iteration of the loop
            // but first let's get rid of that last environment frame
            console.log("rbb: preparing for next loop iteration, popping frame off environment.");
            program.environment = program.environment.parent;
            program.runBasicBlock(loopyStatements, callback); 
          });
        });
        return;
      }
      // also need special processing for back statements, if statements, continue statements, whatever isn't ringer-based
      else if (!ringerBased(loopyStatements[0])){
        console.log("rbb: non-Ringer-based statement.");

        if (skipAllExceptBackAndClose){
          // in this case, when we're basically 'continue'ing, we should do nothing unless this is actually a back or close
          if (!(loopyStatements[0] instanceof WebAutomationLanguage.BackStatement || loopyStatements[0] instanceof WebAutomationLanguage.ClosePageStatement)){
            program.runBasicBlock(loopyStatements.slice(1, loopyStatements.length), callback, skipAllExceptBackAndClose);
            return;
          }
        }

        // normal execution, either because we're not in skipallexceptbackandclose mode, or because we are but it's a back or a close
        var continuation = function(continueflag){ // remember that rbbcontinuations passed to run methods must always handle continueflag
          if (continueflag){
            // executed a continue statement, better stop going through this loop's statements, get back to the original callback
            program.runBasicBlock(loopyStatements.slice(1, loopyStatements.length), callback, true); // set skipAllExceptBackAndClose flag
            return;
          }
          // once we're done with this statement running, have to replay the remainder of the script
          program.runBasicBlock(loopyStatements.slice(1, loopyStatements.length), callback, skipAllExceptBackAndClose);
        };
        loopyStatements[0].run(program, continuation); // todo: program is passed to give access to environment.  may want a better way
        return;
      }
      else {
        console.log("rbb: r+r.");
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

        if (skipAllExceptBackAndClose){
          // in this case, when we're basically 'continue'ing, we should do nothing, so just go on to the next statement without doing anything else
          program.runBasicBlock(loopyStatements.slice(nextBlockStartIndex, loopyStatements.length), callback, skipAllExceptBackAndClose);
          return;
        }

        if (nextBlockStartIndex === 0){
          console.log("nextBlockStartIndex was 0!  this shouldn't happen!", loopyStatements);
          throw("nextBlockStartIndex 0");
        }

        basicBlockStatements = filterScrapingKeypresses(basicBlockStatements);

        // make the trace we'll replay
        var trace = [];
        // label each trace item with the basicBlock statement being used
        for (var i = 0; i < basicBlockStatements.length; i++){
          var cleanTrace = basicBlockStatements[i].cleanTrace;
          _.each(cleanTrace, function(ev){EventM.setTemporaryStatementIdentifier(ev, i);});
          trace = trace.concat(cleanTrace);
        }

        // now that we have the trace, let's figure out how to parameterize it
        // note that this should only be run once the current___ variables in the statements have been updated!  otherwise won't know what needs to be parameterized, will assume nothing
        // should see in future whether this is a reasonable way to do it
        console.log("trace", trace);
        var parameterizedTrace = pbv(trace, basicBlockStatements);
        // now that we've run parameterization-by-value, have a function, let's put in the arguments we need for the current run
        console.log("parameterizedTrace", parameterizedTrace);
        var runnableTrace = passArguments(parameterizedTrace, basicBlockStatements);
        var config = parameterizedTrace.getConfig();

        // the above works because we've already put in VariableUses for statement arguments that use relation items, for all statements within a loop, so currNode for those statements will be a variableuse that uses the relation
        // however, because we're only running these basic blocks, any uses of relation items (in invisible events) that happen before the for loop will not get parameterized, 
        // since their statement arguments won't be changed, and they won't be part of the trace that does have statement arguments changed (and thus get the whole trace parameterized for that)
        // I don't see right now how this could cause issues, but it's worth thinking about

        console.log("runnableTrace", runnableTrace, config);

        config.targetWindowId = RecorderUI.getCurrentRecordingWindow();
        SimpleRecord.replay(runnableTrace, config, function(replayObject){
          // use what we've observed in the replay to update page variables
          console.log("replayObject", replayObject);

          // based on the replay object, we need to update any pagevars involved in the trace;
          var trace = [];
          _.each(basicBlockStatements, function(statement){trace = trace.concat(statement.trace);}); // want the trace with display data, not the clean trace
          
          //updatePageVars(trace, replayObject.record.events);
          // ok, it's time to update the pageVars, but remember that's going to involve checking whether we got a reasonable page
          var allPageVarsOk = function(){
            // statements may need to do something based on this trace, so go ahead and do any extra processing
            for (var i = 0; i < basicBlockStatements.length; i++){
              console.log("calling postReplayProcessing on", basicBlockStatements[i]);
              basicBlockStatements[i].postReplayProcessing(replayObject.record.events, i);
            }

            // once we're done replaying, have to replay the remainder of the script
            program.runBasicBlock(loopyStatements.slice(nextBlockStartIndex, loopyStatements.length), callback);
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
            console.log("rbb: couldn't find a node based on user-required features.  skipping the rest of this row.");

            // even though couldn't complete the whole trace, still need to do updatePageVars because that's how we figure out which
            // tab is associated with which pagevar, so that we can go ahead and do tab closing and back button pressing at the end
            var trace = [];
          _.each(basicBlockStatements, function(statement){trace = trace.concat(statement.trace);}); // want the trace with display data, not the clean trace
            updatePageVars(trace, replayObject.record.events, function(){
              // in the continuation, we'll do the actual move onto the next statement
              program.runBasicBlock(loopyStatements.slice(nextBlockStartIndex, loopyStatements.length), callback, true);
            });

          }
        }
        );
      }
    }

    this.currentDataset = null;
    this.run = function(){
      RecorderUI.userPaused = false;
      RecorderUI.userStopped = false;
      this.currentDataset = new OutputHandler.Dataset();
      this.clearRunningState();
      this.environment = Environment.envRoot();
      this.runBasicBlock(this.loopyStatements, function(){
        program.currentDataset.closeDataset();
        console.log("Done with script execution.");});
    };

    this.stopRunning = function(){
      if (!RecorderUI.userPaused){
        // don't need to stop continuation chain unless it's currently going; if paused, isn't going, stopping flag won't get turned off and will prevent us from replaying later
        RecorderUI.userStopped = true; // this will stop the continuation chain
      }
      // should we even bother saving the data?
      this.currentDataset.closeDataset();
      this.clearRunningState();
      SimpleRecord.stopReplay(); // todo: is current (new) stopReplay enough to make sure that when we try to run the script again, it will start up correctly?
    };

    this.clearRunningState = function(){
      _.each(this.relations, function(relation){relation.clearRunningState();});
      _.each(this.pageVars, function(pageVar){pageVar.clearRunningState();});
      _.each(this.loopyStatements, function(statement){statement.clearRunningState();});
    };

    this.download = function(){
      if (this.currentDataset){
        this.currentDataset.downloadDataset();
      }
    }

    function paramName(statementIndex, paramType){ // assumes we can't have more than one of a single paramtype from a single statement.  should be true
      return "s"+statementIndex+"_"+paramType;
    }

    function pbv(trace, statements){
      var pTrace = new ParameterizedTrace(trace);

      for (var i = 0; i < statements.length; i++){
        var statement = statements[i];
        var pbvs = statement.pbvs();
        console.log("pbvs", pbvs);
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
            console.log("Tried to do pbv on a type we don't know.");
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
      if (origSegs.length !== newSegs.length){ console.log("origSegs and newSegs different length!", origXpath, newXpath); }
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
          console.log("Wrapper node correction:");
          console.log(origXpathPrefix);
          console.log(newXpathPrefix);
        }
        else {
          // this one is now diff, so shouldn't do replacement for the one further
          // (shouldn't do a1/b1/c1 -> d1/e1/f1 from example above)
          // I mean, maybe we actually should do this, but not currently a reason to think it will be useful.  worth considering though
          break;
        }
      }
    }

    function passArguments(pTrace, statements){
      for (var i = 0; i < statements.length; i++){
        var statement = statements[i];
        var args = statement.args();
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
            console.log("Tried to do pbv on a type we don't know. (Arg provision.)");
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
    this.relevantRelations = function(){
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

          if (!(pageVarName in pagesToNodes)){ pagesToNodes[pageVarName] = []; }
          if (pagesToNodes[pageVarName].indexOf(xpath) === -1){ pagesToNodes[pageVarName].push(xpath); }

          if (!(pageVarName in pagesToFrameUrls)){ pagesToFrameUrls[pageVarName] = []; }
          pagesToFrameUrls[pageVarName].push(frameUrl);

          pagesToUrls[pageVarName] = url;
        }
      }
      // ask the server for relations
      // sample: $($.post('http://localhost:3000/retrieverelations', { pages: [{xpaths: ["a[1]/div[2]"], url: "www.test2.com/test-test"}] }, function(resp){ console.log(resp);} ));
      var reqList = [];
      for (var pageVarName in pagesToNodes){
        reqList.push({url: pagesToUrls[pageVarName], xpaths: pagesToNodes[pageVarName], page_var_name: pageVarName});

      }
      var that = this;
      $.post('http://kaofang.cs.berkeley.edu:8080/retrieverelations', { pages: reqList }, function(resp){that.processServerRelations(resp);});
    }

    function filterScrapingKeypresses(statements){
      // if we ever get a sequence within the statements that's a keydown statement, then only scraping statements, then a keyup, assume we can toss the keyup and keydown ones

      console.log("filterScrapingKeypresses", statements);
      var keyIndexes = [];
      var keysdown = [];
      var keysup = [];
      var sets = [];
      for (var i = 0; i < statements.length; i++){
        if (statements[i] instanceof WebAutomationLanguage.TypeStatement && statements[i].onlyKeydowns){
          keyIndexes.push(i);
          keysdown = keysdown.concat(statements[i].keyCodes);
        }
        else if (keyIndexes.length > 0 && statements[i] instanceof WebAutomationLanguage.ScrapeStatement){
          continue;
        }
        else if (keyIndexes.length > 0 && statements[i] instanceof WebAutomationLanguage.TypeStatement && statements[i].onlyKeyups){
          keyIndexes.push(i);
          keysup = keysup.concat(statements[i].keyCodes);

          // ok, do the keysdown and keysup arrays have the same elements (possibly including repeats), just reordered?
          // todo: is this a strong enough condition?
          keysdown.sort();
          keysup.sort();
          if (_.isEqual(keysdown, keysup)) {
            sets.push(keyIndexes);
            keyIndexes = [];
            keysdown = [];
            keysup = [];
          }
        }
        else if (keyIndexes.length > 0 && !(statements[i] instanceof WebAutomationLanguage.ScrapeStatement)){
          keyIndexes = [];
          keysdown = [];
          keysup = [];
        }
      }
      // ok, for now we're only going to get rid of the keydown and keyup statements
      // they're in sets because may ultimately want to try manipulating scraping statements in the middle if they don't have dom events (as when relation parameterized)
      // but for now we'll stick with this

      for (var i = sets.length - 1; i >= 0; i--){
        var set = sets[i];
        for (var j = set.length - 1; j >= 0; j--){
          statements.splice(set[j], 1);
        }
      }
      
      console.log("filterScrapingKeypresses", statements);
      return statements;
    }

    this.processServerRelations = function(resp, currentStartIndex, tabsToCloseAfter, tabMapping){
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
          console.log("processServerrelations going for index:", i, targetPageVar);

          // this is one of the points to which we'll have to replay
          var statementSlice = program.statements.slice(startIndex, i + 1);
          var trace = [];
          _.each(statementSlice, function(statement){trace = trace.concat(statement.cleanTrace);});
          //_.each(trace, function(ev){EventM.clearDisplayInfo(ev);}); // strip the display info back out from the event objects

          console.log("processServerrelations program: ", program);
          console.log("processServerrelations trace indexes: ", startIndex, i);
          console.log("processServerrelations trace:", trace.length);

          var nextIndex = i + 1;

          // ok, we have a slice of the statements that should produce one of our pages. let's replay
          SimpleRecord.replay(trace, {tabMapping: tabMapping}, function(replayObj){
            // continuation
            console.log("replayobj", replayObj);

            // what's the tab that now has the target page?
            var replayTrace = replayObj.record.events;
            var lastCompletedEventTabId = TraceManipulationUtilities.lastTopLevelCompletedEventTabId(replayTrace);
            // what tabs did we make in the interaction in general?
            tabsToCloseAfter = tabsToCloseAfter.concat(TraceManipulationUtilities.tabsInTrace(replayTrace));

            // let's do some trace alignment to figure out a tab mapping
            var newMapping = tabMappingFromTraces(trace, replayTrace);
            tabMapping = _.extend(tabMapping, newMapping);
            console.log(newMapping, tabMapping);

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
              console.log("Panic!  We found a page in our outputPageVars that wasn't in our request to the server for relations that might be relevant on that page.");
            }

            var framesHandled = {};

            // we'll do a bunch of stuff to pick a relation, then we'll call this function
            var handleSelectedRelation = function(data){
              // handle the actual data the page sent us
              program.processLikelyRelation(data);
              // update the control panel display
              RecorderUI.updateDisplayedRelations(true); // true because we're still unearthing interesting relations, so should indicate we're in progress
              // now let's go through this process all over again for the next page, if there is one
              console.log("going to processServerRelations with nextIndex: ", nextIndex);
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
              console.log("framesHandled", framesHandled); // todo: this is just debugging

              var dataObjs = _.map(Object.keys(framesHandled), function(key){ return framesHandled[key]; });
              console.log("dataObjs", dataObjs);
              // todo: should probably do a fancy similarity thing here, but for now we'll be casual
              // we'll sort by number of cells, then return the first one that shares a url with our spec nodes, or the first one if none share that url
              dataObjs = _.filter(dataObjs, function(obj){return obj !== null && obj !== undefined;});
              var sortedDataObjs = _.sortBy(dataObjs, function(data){ if (!data || !data.first_page_relation || !data.first_page_relation[0]){return -1;} else {return data.first_page_relation.length * data.first_page_relation[0].length; }});
              console.log("sortedDataObjs", sortedDataObjs);
              var frameUrls = pagesToFrameUrls[targetPageVar.name];
              console.log("frameUrls", frameUrls, pagesToFrameUrls, targetPageVar.name);
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
                console.log("Aaaaaaaaaaah there aren't any frames that offer good relations!  Why???");
                return;
              }
              processedTheLikeliestRelation = true;
              handleSelectedRelation(sortedDataObjs[0]);
            };

            // let's get some info from the pages, and when we get that info back we can come back and deal with more script segments
            chrome.webNavigation.getAllFrames({tabId: lastCompletedEventTabId}, function(details) {
                framesHandled = {};
                details.forEach(function(frame){
                  // keep track of which frames need to respond before we'll be read to advance
                  console.log("frameId", frame.frameId);
                  framesHandled[frame.frameId] = false;
                });
                details.forEach(function(frame) {
                    // for each frame in the target tab, we want to see if the frame suggests a good relation.  once they've all made their suggestions
                    // we'll pick the one we like best
                    // todo: is there a better way?  after all, we do know the frame in which the user interacted with the first page at original record-time
                    
                    // here's the function for sending the message once
                    var getLikelyRelationFunc = function(){
                      utilities.sendFrameSpecificMessage("mainpanel", "content", "likelyRelation", 
                                                          {xpaths: pagesToNodes[targetPageVar.name], pageVarName: targetPageVar.name, serverSuggestedRelations: suggestedRelations}, 
                                                          lastCompletedEventTabId, frame.frameId, 
                                                          // question: is it ok to insist that every single frame returns a non-null one?  maybe have a timeout?  maybe accept once we have at least one good response from one of the frames?
                                                          function(response) { if (response !== null) {framesHandled[frame.frameId] = response; pickLikelyRelation();}}); // when get response, call pickLikelyRelation (defined above) to pick from the frames' answers
                    };

                    // here's the function for sending the message until we get the answer
                    var getLikelyRelationFuncUntilAnswer = function(){
                      if (framesHandled[frame.frameId]){ return; } // cool, already got the answer, stop asking
                      getLikelyRelationFunc(); // send that message
                      setTimeout(getLikelyRelationFuncUntilAnswer, 5000); // come back and send again if necessary
                    };

                    // actually call it
                    getLikelyRelationFuncUntilAnswer();

                });
            });

          });
          return; // all later indexes will be handled by the recursion instead of the rest of the loop
        }
      }
      // ok we hit the end of the loop without returning after finding a new page to work on.  time to close tabs
      tabsToCloseAfter = _.uniq(tabsToCloseAfter);      
      for (var i = 0; i < tabsToCloseAfter.length; i++){
        chrome.tabs.remove(tabsToCloseAfter[i], function(){
          // do we need to do anything?
        }); 
      }
      // let's also update the ui to indicate that we're no longer looking
      RecorderUI.updateDisplayedRelations(false);
      

    };

    var pagesToRelations = {};
    this.processLikelyRelation = function(data){
      console.log(data);
      if (pagesProcessed[data.page_var_name]){
        // we already have an answer for this page.  must have gotten sent multiple times even though that shouldn't happen
        console.log("Alarming.  We received another likely relation for a given pageVar, even though content script should prevent this.");
        return this.relations;
      }
      pagesProcessed[data.page_var_name] = true;

      if (data.num_rows_in_demonstration < 2 && data.next_type === NextTypes.NONE){
        // what's the point of showing a relation with only one row?
        pagesToRelations[data.page_var_name] = null;
      }
      else{
        var rel = new WebAutomationLanguage.Relation(data.relation_id, data.name, data.selector, data.selector_version, data.exclude_first, data.columns, data.first_page_relation, data.num_rows_in_demonstration, data.page_var_name, data.url, data.next_type, data.next_button_selector);
        pagesToRelations[data.page_var_name] = rel;
        this.relations.push(rel);
      }

      console.log(pagesToRelations, pagesToNodes);
      if (_.difference(_.keys(pagesToNodes), _.keys(pagesToRelations)).length === 0) { // pagesToRelations now has all the pages from pagesToNodes
        // awesome, all the pages have gotten back to us
        setTimeout(this.insertLoops.bind(this), 0); // bind this to this, since JS runs settimeout func with this pointing to global obj
      }

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
      bodyStatementLs = bodyStatementLs.concat(backStatements);
      // todo: also, this is only one of the places we introduce loops.  should do this everywhere we introduce or adjust loops.  really need to deal with the fact those aren't aligned right now

      var loopStatement = new WebAutomationLanguage.LoopStatement(relation, relationColumnsUsed, bodyStatementLs, pageVar); 
      return loopStatement;
    }

    this.insertLoops = function(){
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

      this.loopyStatements = this.statements;
      var indexes = _.keys(indexesToRelations).sort(function(a, b){return b-a}); // start at end, work towards beginning
      for (var i = 0; i < indexes.length; i++){
        var index = indexes[i];
        // let's grab all the statements from the loop's start index to the end, put those in the loop body
        var bodyStatementLs = this.loopyStatements.slice(index, this.loopyStatements.length);
        var pageVar = bodyStatementLs[0].pageVar; // pageVar comes from first item because that's the one using the relation, since it's the one that made us decide to insert a new loop starting with that 
        var loopStatement = loopStatementFromBodyAndRelation(bodyStatementLs, indexesToRelations[index], pageVar); // let's use bodyStatementLs as our body, indexesToRelations[index] as our relation 
        this.loopyStatements = this.loopyStatements.slice(0, index);
        this.loopyStatements.push(loopStatement);
      }

      RecorderUI.updateDisplayedScript();
    };

    this.tryAddingRelation = function(relation){
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
          if (parent instanceof WebAutomationLanguage.Program){
            // parent is a whole program, so go ahead and update this.loopystatments
            parent.loopyStatements = newStatements;
          }
          else{
            // parent is a loop statement, so update bodyStatements
            parent.bodyStatements = newStatements;
          }
          return true;
        }
      }
      return false;
    }

    this.removeRelation = function(relationObj){
      this.relations = _.without(this.relations, relationObj);

      // now let's actually remove any loops that were trying to use this relation
      this.loopyStatements = removeLoopsForRelation(this.loopyStatements, relationObj);

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
            loopyStatements[i].bodyStatements = removeLoopsForRelation(loopyStatements[i].bodyStatements, relation);
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

  for (var prop in pub){
    if (typeof pub[prop] === "function"){
      console.log("making revival label for ", prop);
      Revival.introduceRevivalLabel(prop, pub[prop]);
    }
  }

  return pub;
}());
