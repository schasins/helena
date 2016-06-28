function setUp(){

  //messages received by this component
  //utilities.listenForMessage("content", "mainpanel", "selectorAndListData", processSelectorAndListData);
  //utilities.listenForMessage("content", "mainpanel", "nextButtonData", processNextButtonData);
  //utilities.listenForMessage("content", "mainpanel", "moreItems", moreItems);
  utilities.listenForMessage("content", "mainpanel", "scrapedData", RecorderUI.processScrapedData);
  utilities.listenForMessage("content", "mainpanel", "requestCurrentRecordingWindow", RecorderUI.sendCurrentRecordingWindow);
  
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
    var div = $("#new_script_content");
    DOMCreationUtilities.replaceContent(div, $("#about_to_record"));
    div.find("#start_recording").click(RecorderUI.startRecording);
  };

  var recordingWindowId = null;
  pub.startRecording = function(){
    var div = $("#new_script_content");
    DOMCreationUtilities.replaceContent(div, $("#recording"));
    div.find("#stop_recording").click(RecorderUI.stopRecording);

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
              SimpleRecord.startRecording();
              recordingWindowId = win.id;
              pub.sendCurrentRecordingWindow();
              console.log("Only recording in window: ", recordingWindowId);
            });
          }
        }
      });
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
    pub.showProgramPreview();
  };

  pub.showProgramPreview = function(){
    var div = $("#new_script_content");
    DOMCreationUtilities.replaceContent(div, $("#script_preview")); // let's put in the script_preview node
    activateButton(div, "#run", RecorderUI.run);
    activateButton(div, "#replay", RecorderUI.replayOriginal);
    activateButton(div, '#relation_upload', RecorderUI.uploadRelation);
    RecorderUI.updateDisplayedScript();
    RecorderUI.updateDisplayedRelations();
  };

  pub.run = function(){
    // update the panel to show pause, resume buttons
    var div = $("#new_script_content");
    DOMCreationUtilities.replaceContent(div, $("#script_running"));

    activateButton(div, "#pause", RecorderUI.pauseRun);
    activateButton(div, "#resume", RecorderUI.resumeRun);
    div.find("#resume").button("option", "disabled", true); // shouldn't be able to resume before we even pause

    activateButton(div, "#download", ReplayScript.prog.download);

    // actually start the script running
    ReplayScript.prog.run();
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
  var scraped = {};
  var xpaths = []; // want to show texts in the right order
  pub.processScrapedData = function(data){
    scraped[data.xpath] = data.text; // dictionary based on xpath since we can get multiple DOM events that scrape same data from same node
    xpaths.push(data.xpath);
    $div = $("#scraped_items_preview");
    $div.html("");
    for (var i = 0; i < xpaths.length; i++){
      $div.append($('<div class="first_row_elem">'+scraped[xpaths[i]]+'</div>'));
    }
  };

  pub.updateDisplayedRelations = function(){
    var relationObjects = ReplayScript.prog.relations;
    $div = $("#new_script_content").find("#relations");
    $div.html("");
    if (relationObjects.length === 0){
      $div.html("No relevant tables identified on the webpages yet.");
      return;
    }
    for (var i = 0; i < relationObjects.length; i++){
      var $relDiv = $("<div class=relation_preview></div>");
      $div.append($relDiv);
      var relation = relationObjects[i];
      var textRelation = relation.demonstrationTimeRelationText();
      if (textRelation.length > 2){
        textRelation = textRelation.slice(0,2);
        textRelation.push(_.map(Array.apply(null, Array(textRelation[0].length)), function(){return "...";}));
      }
      var table = DOMCreationUtilities.arrayOfArraysToTable(textRelation);

      var xpaths = relation.firstRowXpathsInOrder();
      var tr = $("<tr></tr>");
      for (var j = 0; j < xpaths.length; j++){
        (function(){
          var xpath = xpaths[j];
          var columnTitle = $("<input></input>");
          console.log(xpath);
          console.log(relation);
          columnTitle.val(relation.getParameterizeableXpathColumnObject(xpath).name);
          columnTitle.change(function(){console.log(columnTitle.val(), xpath); relation.setParameterizeableXpathNodeName(xpath, columnTitle.val()); RecorderUI.updateDisplayedScript();});
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
    // once ready button clicked, we'll already have updated the relation selector info based on messages the content panel has been sending, so we can just go back to looking at the program preview
    readyButton.click(function(){
      RecorderUI.showProgramPreview();
      // we also want to close the tab...
      chrome.tabs.remove(tabId);
    });
  };

  pub.updateDisplayedRelation = function(relationObj){
    var $relDiv = $("#new_script_content").find("#output_preview");
    $relDiv.html("");

    var textRelation = relationObj.demonstrationTimeRelationText();
    var table = DOMCreationUtilities.arrayOfArraysToTable(textRelation);

    var xpaths = relationObj.firstRowXpathsInOrder();
    var tr = $("<tr></tr>");
    for (var j = 0; j < xpaths.length; j++){
      (function(){
        var xpath = xpaths[j];
        var columnTitle = $("<input></input>");
        columnTitle.val(relationObj.getParameterizeableXpathColumnObject(xpath).name);
        columnTitle.change(function(){console.log(columnTitle.val(), xpath); relationObj.setParameterizeableXpathNodeName(xpath, columnTitle.val()); RecorderUI.updateDisplayedScript();});
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

  pub.updateDisplayedScript = function(){
    var program = ReplayScript.prog;
    var scriptString = program.toString();
    var scriptPreviewDiv = $("#new_script_content").find("#program_representation");
    DOMCreationUtilities.replaceContent(scriptPreviewDiv, $("<div>"+scriptString+"</div>")); // let's put the script string in the script_preview node
  };

  pub.addNewRowToOutput = function(listOfCellTexts){
    var div = $("#new_script_content").find("#output_preview").find("table");
    var l = div.children().length;
    if (l === 500){
      $("#new_script_content").find("#output_preview").append($("<div>This dataset is too big for us to display.  The preview here shows the first 500 rows.  To see the whole dataset, just click the download button above.</div>"));
    }
    else if (l < 500){
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
    trace = associateNecessaryLoadsWithIDs(trace);
    trace = parameterizePages(trace);
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

  var frameToPageVarId = {};
  function associateNecessaryLoadsWithIDs(trace){
    var idCounter = 1; // blockly says not to count from 0
    _.each(trace, function(ev){if (ev.type === "completed" && EventM.getVisible(ev)){ var p = new WebAutomationLanguage.PageVariable("p"+idCounter, EventM.getLoadURL(ev)); EventM.setLoadOutputPageVar(ev, p); frameToPageVarId[EventM.getLoadURL(ev)] = p; idCounter += 1;}});
    return trace;
  }

  function parameterizePages(trace){
    _.each(trace, function(ev){if (ev.type === "dom"){ var p = frameToPageVarId[EventM.getDOMURL(ev)]; EventM.setDOMInputPageVar(ev, p); p.setRecordTimeFrameData(ev.frame); }});
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
        EventM.setVisible(ev);
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
        currentSegment.push(ev);
        if (currentSegmentVisibleEvent === null && WebAutomationLanguage.statementType(ev) !== null ){ // only relevant to first segment
          currentSegmentVisibleEvent = ev;
        }
      }
      else{
        // the current event isn't allowed in last segment -- maybe it's on a new node or a new type of action.  need a new segment
        allSegments.push(currentSegment);
        currentSegment = [ev];
        currentSegmentVisibleEvent = ev; // if this were an invisible event, we wouldn't have needed to start a new block, so it's always ok to put this in for the current segment's visible event
      }});
    allSegments.push(currentSegment); // put in that last segment
    allSegments = postSegmentationInvisibilityDetectionAndMerging(allSegments);
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
          else if (sType === StatementTypes.SCRAPE){
            statements.push(new WebAutomationLanguage.ScrapeStatement(seg));
          }
          else if (sType === StatementTypes.KEYBOARD){
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
  MOUSE: "click",
  KEYBOARD: "type",
  LOAD: "load",
  SCRAPE: "extract"
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
          return StatementTypes.SCRAPE
        }
        return StatementTypes.MOUSE;
      }
      else if (statementToEventMapping.keyboard.indexOf(ev.data.type) > -1){
        if ([16, 17, 18].indexOf(ev.data.keyCode) > -1){
          // this is just shift, ctrl, or alt key.  don't need to show these to the user
          return null;
        }
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

  function nodeRepresentation(statement){
    if (statement.currentNode instanceof WebAutomationLanguage.VariableUse){
      return statement.currentNode.toString();
    }
    if (statement.trace[0].additional.visualization === "whole page"){
      return "whole page";
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

  function parameterizeNodeWithRelation(statement, relation, pageVar){
      var xpaths = relation.parameterizeableXpaths();
      var index = xpaths.indexOf(statement.currentNode);
      if (index > -1){
        statement.relation = relation;
        statement.currentNode = new WebAutomationLanguage.VariableUse(relation.getParameterizeableXpathColumnObject(xpaths[index]), relation, pageVar);
      }
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

  // the actual statements

  pub.LoadStatement = function(trace){
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

    this.toStringLines = function(){
      return [this.outputPageVar.toString()+" = load('"+this.url+"')"];
    };

    this.pbvs = function(){
      var pbvs = [];
      if (this.url !== this.currentUrl){
        pbvs.push({type:"url", value: this.url});
      }
      return pbvs;
    };

    this.parameterizeForRelation = function(){
      return; // loads don't get changed based on relations
    };
    this.unParameterizeForRelation = function(){
      return; // loads don't get changed based on relations
    };

    this.args = function(){
      var args = [];
      args.push({type:"url", value: this.currentUrl});
      return args;
    };

    this.postReplayProcessing = function(trace, temporaryStatementIdentifier){
      return;
    };
  };
  pub.ClickStatement = function(trace){
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
    proposeCtrlAdditions(this);
    this.cleanTrace = cleanTrace(this.trace);


    this.toStringLines = function(){
      var nodeRep = nodeRepresentation(this);
      return [outputPagesRepresentation(this)+"click("+this.pageVar.toString()+", "+nodeRep+")"];
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
      parameterizeNodeWithRelation(this, relation, this.pageVar);
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
  };
  pub.ScrapeStatement = function(trace){
    this.trace = trace;
    this.cleanTrace = cleanTrace(trace);

    // find the record-time constants that we'll turn into parameters
    var ev = firstVisibleEvent(trace);
    this.pageVar = EventM.getDOMInputPageVar(ev);
    this.node = ev.target.xpath;
    this.pageUrl = ev.frame.topURL;
    // for now, assume the ones we saw at record time are the ones we'll want at replay
    this.currentNode = this.node;
    this.origNode = this.node;

    this.toStringLines = function(){
      var nodeRep = nodeRepresentation(this);
      return ["scrape("+this.pageVar.toString()+", "+nodeRep+")"];
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
      parameterizeNodeWithRelation(this, relation, this.pageVar);
      // this is cool because now we don't need to actually run scraping interactions to get the value, so let's update the cleanTrace to reflect that
      for (var i = this.cleanTrace.length - 1; i >= 0; i--){
        if (this.cleanTrace[i].additional && this.cleanTrace[i].additional.scrape){
          this.cleanTrace.splice(i, 1);
        }
      }
      console.log("shortened cleantrace", this.cleanTrace);
    };
    this.unParameterizeForRelation = function(relation){
      unParameterizeNodeWithRelation(this, relation);
      // have to go back to actually running the scraping interactions...
      this.cleanTrace = cleanTrace(trace);
    };

    this.args = function(){
      var args = [];
      args.push({type:"node", value: currentNodeXpath(this)});
      args.push({type:"tab", value: currentTab(this)});
      return args;
    };

    this.postReplayProcessing = function(trace, temporaryStatementIdentifier){
      if (this.currentNode instanceof WebAutomationLanguage.VariableUse){
        // this scrape statement is parameterized, so we can just grab the current value from the node...
        this.currentNodeCurrentValue = this.currentNode.currentText();
      }
      else{
        // it's not just a relation item, so relation extraction hasn't extracted it, so we have to actually look at the trace
        // find the scrape that corresponds to this scrape statement based on temporarystatementidentifier
        for (var i = 0; i < trace.length; i++){
          if (EventM.getTemporaryStatementIdentifier(trace[i]) === temporaryStatementIdentifier && trace[i].additional && trace[i].additional.scrape && trace[i].additional.scrape.text){
            this.currentNodeCurrentValue = trace[i].additional.scrape.text;
            return;
          }
        }
      }
    };
  };
  pub.TypeStatement = function(trace){
    this.trace = trace;
    this.cleanTrace = cleanTrace(trace);

    // find the record-time constants that we'll turn into parameters
    var ev = firstVisibleEvent(trace);
    this.pageVar = EventM.getDOMInputPageVar(ev);
    this.node = ev.target.xpath;
    this.pageUrl = ev.frame.topURL;
    var acceptableEventTypes = statementToEventMapping.keyboard;
    var textEntryEvents = _.filter(trace, function(ev){return WebAutomationLanguage.statementType(ev) === StatementTypes.KEYBOARD;});
    var lastTextEntryEvent = textEntryEvents[textEntryEvents.length - 1];
    this.typedString = lastTextEntryEvent.target.snapshot.value;
    var domEvents = _.filter(trace, function(ev){return ev.type === "dom";}); // any event in the segment may have triggered a load
    var outputLoads = _.reduce(domEvents, function(acc, ev){return acc.concat(EventM.getDOMOutputLoadEvents(ev));}, []);
    this.outputPageVars = _.map(outputLoads, function(ev){return EventM.getLoadOutputPageVar(ev);});
    // for now, assume the ones we saw at record time are the ones we'll want at replay
    this.currentNode = this.node;
    this.origNode = this.node;
    this.currentTypedString = this.typedString;

    this.toStringLines = function(){
      return [outputPagesRepresentation(this)+"type("+this.pageVar.toString()+", '"+this.currentTypedString+"')"];
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
      parameterizeNodeWithRelation(this, relation, this.pageVar);
    };
    this.unParameterizeForRelation = function(relation){
      unParameterizeNodeWithRelation(this, relation);
    };

    this.args = function(){
      var args = [];
      args.push({type:"node", value: currentNodeXpath(this)});
      args.push({type:"tab", value: currentTab(this)});
      return args;
    };

    this.postReplayProcessing = function(trace, temporaryStatementIdentifier){
      return;
    };
  };

  pub.OutputRowStatement = function(scrapeStatements){
    this.trace = []; // no extra work to do in r+r layer for this
    this.cleanTrace = [];
    this.scrapeStatements = scrapeStatements;

    this.toStringLines = function(){
      var nodeRepLs = _.map(this.scrapeStatements, function(statement){return nodeRepresentation(statement);});
      return ["addOutputRow(["+nodeRepLs.join(",")+"])"];
    };

    this.pbvs = function(){
      return [];
    };
    this.parameterizeForRelation = function(relation){
      return;
    };
    this.unParameterizeForRelation = function(relation){
      return;
    };
    this.args = function(){
      return [];
    };
    this.postReplayProcessing = function(trace, temporaryStatementIdentifier){
      // we've 'executed' an output statement.  better send a new row to our output
      var cells = [];
      _.each(this.scrapeStatements, function(scrapeStatment){
        cells.push(scrapeStatment.currentNodeCurrentValue);
      });
      RecorderUI.addNewRowToOutput(cells);
      ReplayScript.prog.currentDataset.addRow(cells); // todo: is replayscript.prog really the best way to access the prog object so that we can get the current dataset object, save data to server?
    };
  }

  pub.LoopStatement = function(relation, bodyStatements, pageVar){
    this.relation = relation;
    this.bodyStatements = bodyStatements;
    this.pageVar = pageVar;

    this.toStringLines = function(){
      var relation = this.relation;
      var varNames = _.map(relation.columns, function(columnObject){return columnObject.name;});
      var prefix = "for "+varNames.join(", ")+" in "+this.pageVar.toString()+"."+this.relation.name+":";
      var statementStrings = _.reduce(this.bodyStatements, function(acc, statement){return acc.concat(statement.toStringLines());}, []);
      statementStrings = _.map(statementStrings, function(line){return ("&nbsp&nbsp&nbsp&nbsp "+line);});
      return [prefix].concat(statementStrings);
    };

    this.parameterizeForRelation = function(relation){
      _.each(this.bodyStatements, function(statement){statement.parameterizeForRelation(relation);});
    };
    this.unParameterizeForRelation = function(relation){
      _.each(this.bodyStatements, function(statement){statement.unParameterizeForRelation(relation);});
    };
  }

  // used for relations that only have text in cells, as when user uploads the relation
  pub.TextRelation = function(csvFileContents){
    this.relation = $.csv.toArrays(csvFileContents);

    this.demonstrationTimeRelationText = function(){
      return this.relation;
    }

    this.firstRowXpathsInOrder = function(){
      return Array.apply(null, {length: this.relation[0].length}).map(Number.call, Number); // we'll just use indexes instead of xpaths for this type of relation, which is purely a text relation
    }

    this.parameterizeableXpaths = function(){
      return this.firstRowXpathsInOrder();
    }

    var xpathsToColumnObjects = {};
    this.processColumns = function(){
      newXpathsToColumnObjects = {};
      var indexes = this.firstRowXpathsInOrder();
      for (var i = 0; i < indexes.length; i++){
        newXpathsToColumnObjects[indexes[i]] = {index: i, name: "filler", xpath: i}; // todo: don't actually want to put filler here
      }
      xpathsToColumnObjects = newXpathsToColumnObjects
    };
    this.processColumns();

    this.getParameterizeableXpathColumnObject = function(xpath){
      var obj = xpathsToColumnObjects[xpath];
      if (!obj){ console.log("Ack!  No column object for that xpath: ", xpathsToColumnObjects, xpath);}
      return obj;
    };
    // user can give us better names
    this.setParameterizeableXpathNodeName = function(xpath, v){
      var columnObj = xpathsToColumnObjects[xpath];
      columnObj.name = v;
    };

    this.usedByStatement = function(statement){
      if (!(statement instanceof WebAutomationLanguage.TypeStatement)){
        return false;
      }
      // todo: actually fill this in!
      return false;
    };

    var currentRowsCounter = 0;
    this.clearRunningState = function(){
      currentRowsCounter = 0;
    };
  }

  var relationCounter = 0;
  pub.Relation = function(relationId, name, selector, selectorVersion, excludeFirst, columns, demonstrationTimeRelation, numRowsInDemo, url, nextType, nextButtonSelector){
    this.id = relationId;
    this.selector = selector;
    this.selectorVersion = selectorVersion;
    this.excludeFirst = excludeFirst;
    this.columns = columns;
    this.demonstrationTimeRelation = demonstrationTimeRelation;
    this.numRowsInDemo = numRowsInDemo;
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

    this.pageRelationsInfo = {};

    var relation = this;

    this.demonstrationTimeRelationText = function(){
      return _.map(this.demonstrationTimeRelation, function(row){return _.map(row, function(cell){return cell.text;});});
    }

    this.firstRowXpathsInOrder = function(){
      return relation.parameterizeableXpaths();
    }

    this.parameterizeableXpaths = function(){
      // for now, will only parameterize on the first row
      return _.map(relation.demonstrationTimeRelation[0], function(cell){ return cell.xpath;});
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

    var xpathsToColumnObjects = {};
    this.processColumns = function(){
      newXpathsToColumnObjects = {};
      for (var i = 0; i < relation.columns.length; i++){
        processColumn(relation.columns[i], i, xpathsToColumnObjects[relation.columns[i].xpath]); // should later look at whether this index is good enough
        newXpathsToColumnObjects[relation.columns[i].xpath] = relation.columns[i];
      }
      xpathsToColumnObjects = newXpathsToColumnObjects
    };
    this.processColumns();

    function processColumn(colObject, index, oldColObject){
      if (colObject.name === null || colObject.name === undefined){
        if (oldColObject && oldColObject.name){
          colObject.name = oldColObject.name;
        }
        else{
          colObject.name = relation.name+"_item_"+(index+1); // a filler name that we'll use for now
        }
      }
      colObject.index = index;
    }

    this.nameColumnsAndRelation = function(){
      // should eventually consider looking at existing columns to suggest columns names
    }
    this.nameColumnsAndRelation();

    this.getParameterizeableXpathColumnObject = function(xpath){
      var obj = xpathsToColumnObjects[xpath];
      if (!obj){ console.log("Ack!  No column object for that xpath: ", xpathsToColumnObjects, xpath);}
      return obj;
    };
    // user can give us better names
    this.setParameterizeableXpathNodeName = function(xpath, v){
      var columnObj = xpathsToColumnObjects[xpath];
      columnObj.name = v;
    };

    this.usedByStatement = function(statement){
      if (!((statement instanceof WebAutomationLanguage.ScrapeStatement) || (statement instanceof WebAutomationLanguage.ClickStatement) || (statement instanceof WebAutomationLanguage.TypeStatement))){
        return false;
      }
      // for now we're only saying the relation is used if the nodes in the relation are used
      // todo: ultimately should also say it's used if the text contents of a node is typed
      return (this.url === statement.pageUrl && this.parameterizeableXpaths().indexOf(statement.node) > -1);
    };

    this.clearRunningState = function(){
      this.pageRelationsInfo = {};
    };

    this.messageRelationRepresentation = function(){
      return {id: this.id, name: this.name, selector: this.selector, selector_version: this.selectorVersion, exclude_first: this.excludeFirst, columns: this.columns, next_type: this.nextType, next_button_selector: this.nextButtonSelector, url: this.url, num_rows_in_demonstration: this.numRowsInDemo};
    };

    this.getNextRow = function(pageVar, callback){ // has to be called on a page, since a relation selector can be applied to many pages.  higher-level tool must control where to apply
      // todo: this is a very simplified version that assumes there's only one page of results.  add the rest soon.

      // have to keep track of different state for relations retrieved with the same relation but on different pages
      // todo: in future may sometimes want to clear out the information in this.pageRelationsInfo.  should think about this, lest it become a memory hog
      var pname = pageVar.name;
      var prinfo = this.pageRelationsInfo[pname];
      if (prinfo === undefined || prinfo.currentTabId !== pageVar.currentTabId()){ // if we haven't seen this pagevar or haven't seen the URL currently associated with the pagevar, need to clear our state and start fresh
        prinfo = {currentRows: null, currentRowsCounter: 0, currentTabId: pageVar.currentTabId()};
        this.pageRelationsInfo[pname] = prinfo;
      }

      console.log("getnextrow", this, prinfo.currentRowsCounter);
      if (prinfo.currentRows === null){
        utilities.listenForMessageOnce("content", "mainpanel", "relationItems", function(data){
          prinfo.currentRows = data.relation;
          prinfo.currentRowsCounter = 0;
          callback(true);
        });
        utilities.sendMessage("mainpanel", "content", "getRelationItems", this.messageRelationRepresentation(), null, null, [pageVar.currentTabId()]);
        // todo: for above.  need to figure out the appropriate tab_id
        // how should we decide on tab id?  should we just send to all tabs, have them all check if it looks listy on the relevant tab?
        // this might be useful for later attempts to apply relation finders to new pages with different urls, so user doesn't have to show them, that sort of thing
      }
      else if (prinfo.currentRowsCounter + 1 >= prinfo.currentRows.length){
        callback(false); // no more rows -- let the callback know we're done
      }
      else {
        // we still have local rows that we haven't used yet.  just advance the counter to change which is our current row
        prinfo.currentRowsCounter += 1;
        callback(true);
      }
    }

    this.getCurrentXPath = function(pageVar, columnObject){
      var pname = pageVar.name;
      var prinfo = this.pageRelationsInfo[pname];
      if (prinfo === undefined){ console.log("Bad!  Shouldn't be calling getCurrentXPath on a pageVar for which we haven't yet called getNextRow."); return null; }
      return prinfo.currentRows[prinfo.currentRowsCounter][columnObject.index].xpath; // in the current row, xpath at the index associated with nodeName
    }

    this.getCurrentText = function(pageVar, columnObject){
      var pname = pageVar.name;
      var prinfo = this.pageRelationsInfo[pname];
      if (prinfo === undefined){ console.log("Bad!  Shouldn't be calling getCurrentText on a pageVar for which we haven't yet called getNextRow."); return null; }
      return prinfo.currentRows[prinfo.currentRowsCounter][columnObject.index].text; // in the current row, value at the index associated with nodeName
    }

    this.saveToServer = function(){
      // sample: $($.post('http://localhost:3000/saverelation', { relation: {name: "test", url: "www.test2.com/test-test2", selector: "test2", selector_version: 1, num_rows_in_demonstration: 10}, columns: [{name: "col1", xpath: "a[1]/div[1]", suffix: "div[1]"}] } ));
      // todo: this should really be stable stringified (the selector), since we'll be using it to test equality of different relations
      var rel = this.messageRelationRepresentation();
      ServerTranslationUtilities.JSONifyRelation(rel);
      $.post('http://visual-pbd-scraping-server.herokuapp.com/saverelation', {relation: rel});
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
      this.selector = msg.selector;
      this.selectorVersion = msg.selector_version;
      this.excludeFirst = msg.exclude_first;
      this.columns = msg.columns;
      this.processColumns();
      this.demonstrationTimeRelation = msg.demonstration_time_relation;
      this.numRowsInDemo = msg.num_rows_in_demo;
      this.nextType = msg.next_type;
      this.nextButtonSelector = msg.next_button_selector;
      RecorderUI.updateDisplayedRelation(this);
    };
  }

  // todo: for now all variable uses are uses of relations, but eventually will probably want to have scraped from outside of relations too
  pub.VariableUse = function(columnObject, relation, pageVar){
    this.columnObject = columnObject;
    this.relation = relation;
    this.pageVar = pageVar;

    this.toString = function(){
      return this.columnObject.name;
    };

    this.currentXPath = function(){
      return this.relation.getCurrentXPath(this.pageVar, this.columnObject);
    };

    this.currentText = function(){
      return this.relation.getCurrentText(this.pageVar, this.columnObject);
    };
  }

  pub.PageVariable = function(name, recordTimeUrl){
    this.name = name;
    this.recordTimeUrl = recordTimeUrl;

    this.setRecordTimeFrameData = function(frameData){
      this.recordTimeFrameData = frameData;
    };

    this.setCurrentTabId = function(tabId){
      this.tabId = tabId;
    };

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
      this.setCurrentTabId(undefined);
    };

  };

  // the whole program

  pub.Program = function(statements){
    this.statements = statements;
    this.relations = [];
    this.pageVars = _.uniq(_.map(_.filter(statements, function(s){return s.pageVar;}), function(statement){return statement.pageVar;}));                                                                                                                                                                                 
    this.loopyStatements = [];

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

    // just for replaying the straight-line recording, primarily for debugging
    this.replayOriginal = function(){
      var trace = [];
      _.each(this.statements, function(statement){trace = trace.concat(statement.cleanTrace);});
      _.each(trace, function(ev){EventM.clearDisplayInfo(ev);}); // strip the display info back out from the event objects

      SimpleRecord.replay(trace, null, function(){console.log("Done replaying.");});
    };

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

    function runBasicBlock(loopyStatements, callback){
      console.log("rbb", loopyStatements.length, loopyStatements);
      // first check if we're supposed to pause, stop execution if yes
      console.log("RecorderUI.userPaused", RecorderUI.userPaused);
      if (RecorderUI.userPaused){
        RecorderUI.resumeContinuation = function(){runBasicBlock(loopyStatements, callback);};
        console.log("paused");
        return;
      }

      if (loopyStatements.length < 1){
        console.log("rbb: empty loopystatments.");
        callback();
        return;
      }
      else if (loopyStatements[0] instanceof WebAutomationLanguage.LoopStatement){
        console.log("rbb: loop.");
        var loopStatement = loopyStatements[0];
        loopStatement.relation.getNextRow(loopStatement.pageVar, function(moreRows){
          if (!moreRows){
            console.log("no more rows");
            // hey, we're done!
            callback();
            return;
          }
          console.log("we have a row!  let's run");
          // otherwise, should actually run the body
          console.log("loopyStatements", loopyStatements);
          runBasicBlock(loopStatement.bodyStatements, function(){
            // and once we've run the body, we should do the next iteration of the loop
            runBasicBlock(loopyStatements, callback); // running extra iterations of the for loop is the only time we change the callback
          });
        });
      }
      else {
        console.log("rbb: r+r.");
        // the fun stuff!  we get to run a basic block with the r+r layer
        var basicBlockStatements = [];
        var nextBlockStartIndex = loopyStatements.length;
        for (var i = 0; i < loopyStatements.length; i++){
          if (loopyStatements[i] instanceof WebAutomationLanguage.LoopStatement){
            nextBlockStartIndex = i;
            break;
          }
          basicBlockStatements.push(loopyStatements[i]);
        }

        if (nextBlockStartIndex === 0){
          console.log("nextBlockStartIndex was 0!  this shouldn't happen!", loopyStatements);
          throw("nextBlockStartIndex 0");
        }

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

        SimpleRecord.replay(runnableTrace, config, function(replayObject){
          // use what we've observed in the replay to update page variables
          console.log("replayObject", replayObject);

          // based on the replay object, we need to update any pagevars involved in the trace;
          var trace = [];
          _.each(basicBlockStatements, function(statement){trace = trace.concat(statement.trace);}); // want the trace with display data, not the clean trace
          updatePageVars(trace, replayObject.record.events);

          // statements may need to do something based on this trace, so go ahead and do any extra processing
          for (var i = 0; i < basicBlockStatements.length; i++){
            console.log("calling postReplayProcessing on", basicBlockStatements[i]);
            basicBlockStatements[i].postReplayProcessing(replayObject.record.events, i);
          }

          // once we're done replaying, have to replay the remainder of the script
          runBasicBlock(loopyStatements.slice(nextBlockStartIndex, loopyStatements.length), callback);
        });
      }
    }

    this.currentDataset = null;
    this.run = function(){
      this.currentDataset = new OutputHandler.Dataset();
      _.each(this.relations, function(relation){relation.clearRunningState();});
      _.each(this.pageVars, function(pageVar){pageVar.clearRunningState();});
      runBasicBlock(this.loopyStatements, function(){
        program.currentDataset.closeDataset();
        console.log("Done with script execution.");});
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
    var pagesProcessed = {};
    this.relevantRelations = function(){
      // ok, at this point we know the urls we've used and the xpaths we've used on them
      // we should ask the server for relations that might help us out
      // when the server gets back to us, we should try those relations on the current page
      // we'll compare those against the best we can create on the page right now, pick the winner

      // get the xpaths used on the urls
      for (var i = 0; i < this.statements.length; i++){
        var s = this.statements[i];
        if ( (s instanceof WebAutomationLanguage.ScrapeStatement) || (s instanceof WebAutomationLanguage.ClickStatement) ){
          var xpath = s.node; // todo: in future, should get the whole node info, not just the xpath, but this is sufficient for now
          var url = s.pageUrl; // the top url of the frame on which the relevant events were raised
          if (!(url in pagesToNodes)){ pagesToNodes[url] = []; }
          console.log(pagesToNodes[url], xpath, xpath in pagesToNodes[url]);
          if (pagesToNodes[url].indexOf(xpath) === -1){ pagesToNodes[url].push(xpath); }
        }
      }
      // ask the server for relations
      // sample: $($.post('http://localhost:3000/retrieverelations', { pages: [{xpaths: ["a[1]/div[2]"], url: "www.test2.com/test-test"}] }, function(resp){ console.log(resp);} ));
      var reqList = [];
      for (var url in pagesToNodes){
        reqList.push({url: url, xpaths: pagesToNodes[url]});

      }
      var that = this;
      $.post('http://visual-pbd-scraping-server.herokuapp.com/retrieverelations', { pages: reqList }, function(resp){that.processServerRelations(resp);});
    }

    this.processServerRelations = function(resp, currentStartIndex){
      if (currentStartIndex === undefined){currentStartIndex = 0;}
      // we're ready to try these relations on the current pages
      // to do this, we'll have to actually replay the script

      // let's find all the statements that should open new pages (where we'll need to try relations)
      for (var i = currentStartIndex; i < program.statements.length; i++){
        if (program.statements[i].outputPageVars && program.statements[i].outputPageVars.length > 0){
          // todo: for now this code assumes there's exactly one outputPageVar.  this may not always be true!  but dealing with it now is a bad use of time
          var targetPageUrl = program.statements[i].outputPageVars[0].recordTimeUrl; // it was a pageVariable object, and we've grabbed the url from there
          console.log("processServerrelations going for index:", i, targetPageUrl);
          // note that we're here grabbing urls from the pageVars, whereas above (to get the urls to send to the server) we just used the pageurls associated with statement objects.  make sure these will always align. otherwise could run into trouble.

          // this is one of the points to which we'll have to replay
          var statementSlice = program.statements.slice(0, i + 1);
          var trace = [];
          _.each(statementSlice, function(statement){trace = trace.concat(statement.cleanTrace);});
          //_.each(trace, function(ev){EventM.clearDisplayInfo(ev);}); // strip the display info back out from the event objects

          var nextIndex = i + 1;

          // ok, we have a slice of the statements that should produce one of our pages. let's replay
          SimpleRecord.replay(trace, null, function(replayObj){
            // continuation
            console.log("replayobj", replayObj);

            // what's the tab that now has the target page?
            var replayTrace = replayObj.record.events;
            var lastCompletedEventTabId = TraceManipulationUtilities.lastTopLevelCompletedEventTabId(replayTrace);
            // what tabs did we make in the interaction in general?
            var tabsToCloseAfter = TraceManipulationUtilities.tabsInTrace(replayTrace);

            // and what are the server-suggested relations we want to send?
            var resps = resp.pages;
            var suggestedRelations = null;
            for (var i = 0; i < resps.length; i++){
              var url = resps[i].url;
              if (url === targetPageUrl){
                suggestedRelations = [resps[i].relations.same_domain_best_relation, resps[i].relations.same_url_best_relation];
                for (var j = 0; j < suggestedRelations.length; j++){
                  if (suggestedRelations[j] === null){ continue; }
                  ServerTranslationUtilities.unJSONifyRelation(suggestedRelations[j]); // is this the best place to deal with going between our object attributes and the server strings?
                }
              }
            }
            if (suggestedRelations === null){
              console.log("Panic!  We found a page in our outputPageVars that wasn't in our request to the server for relations that might be relevant on that page.");
            }

            // let's get some info from the pages, and when we get that info back we can come back and deal with more script segments
            pagesProcessed[targetPageUrl] = false;
            var getLikelyRelationFunc = function(){utilities.sendMessage("mainpanel", "content", "likelyRelation", {xpaths: pagesToNodes[targetPageUrl], url: targetPageUrl, serverSuggestedRelations: suggestedRelations}, null, null, [lastCompletedEventTabId]);};
            var getLikelyRelationFuncUntilAnswer = function(){
              if (pagesProcessed[targetPageUrl]){ return; } 
              getLikelyRelationFunc(); 
              setTimeout(getLikelyRelationFuncUntilAnswer, 1000);}

            // what should we do once we get the response back, having tested the various relations on the actual pages?
            utilities.listenForMessageOnce("content", "mainpanel", "likelyRelation", function(data){
              // no longer need the tabs from which we got this info
              var closedTabsCount = 0;
              for (var i = 0; i < tabsToCloseAfter.length; i++){
                chrome.tabs.remove(tabsToCloseAfter[i], function(){
                  closedTabsCount += 1;
                  if (closedTabsCount === tabsToCloseAfter.length){
                    // cool, all the tabs are closed, we're ready to continue
                    // handle the actual data the page sent us
                    program.processLikelyRelation(data);
                    // update the control panel display
                    RecorderUI.updateDisplayedRelations();
                    // now let's go through this process all over again for the next page, if there is one
                    console.log("going to processServerRelations with nextIndex: ", nextIndex);
                    program.processServerRelations(resp, nextIndex);
                  }
                }); 
              }
            });
            setTimeout(getLikelyRelationFuncUntilAnswer, 500); // give it a while to attach the listener
          });

          return;
        }
      }
    };

    var pagesToRelations = {};
    this.processLikelyRelation = function(data){
      console.log(data);
      if (pagesProcessed[data.url]){
        // we already have an answer for this page.  must have gotten sent multiple times even though that shouldn't happen
        return this.relations;
      }
      pagesProcessed[data.url] = true;

      if (data.num_rows_in_demonstration < 2 && data.next_type === NextTypes.NONE){
        // what's the point of showing a relation with only one row?
        pagesToRelations[data.url] = null;
      }
      else{
        var rel = new WebAutomationLanguage.Relation(data.relation_id, data.name, data.selector, data.selector_version, data.exclude_first, data.columns, data.first_page_relation, data.num_rows_in_demonstration, data.url, data.next_type, data.next_button_selector);
        pagesToRelations[data.url] = rel;
        this.relations.push(rel);
      }


      if (_.difference(_.keys(pagesToNodes), _.keys(pagesToRelations)).length === 0) { // pagesToRelations now has all the pages from pagesToNodes
        // awesome, all the pages have gotten back to us
        setTimeout(this.insertLoops.bind(this), 0); // bind this to this, since JS runs settimeout func with this pointing to global obj
      }

      // give the text relations back to the UI-handling component so we can display to user
      return this.relations;
    };

    this.insertLoops = function(){
      var indexesToRelations = {}; // indexes into the statements mapped to the relations used by those statements
      for (var i = 0; i < this.relations.length; i++){
        var relation = this.relations[i];
        for (var j = 0; j < this.statements.length; j++){
          var statement = this.statements[j];
          if (relation.usedByStatement(statement)){
            indexesToRelations[j] = relation;
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
        // we want to parameterize the body for the relation
        var relation = indexesToRelations[index];
        for (var j = 0; j < bodyStatementLs.length; j++){
          bodyStatementLs[j].parameterizeForRelation(relation);
        }
        var loopStatement = new WebAutomationLanguage.LoopStatement(relation, bodyStatementLs, this.loopyStatements[index].pageVar);
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
          for (var j = 0; j < bodyStatementLs.length; j++){
            bodyStatementLs[j].parameterizeForRelation(relation);
          }
          var loopStatement = new WebAutomationLanguage.LoopStatement(relation, bodyStatementLs, loopyStatements[i].pageVar);
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
          return true;;
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

  return pub;
}());