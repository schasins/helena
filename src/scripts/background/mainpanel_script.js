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

    activateButton(div, "#download", function(){ReplayScript.prog.download();});

    var reset = function(){
      ReplayScript.prog.stopRunning();
      pub.showProgramPreview();
    }
    activateButton(div, "#cancelRun", reset);

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

    var columns = relationObj.columns;
    var tr = $("<tr></tr>");
    for (var j = 0; j < columns.length; j++){
      (function(){
        var xpath = columns[j].xpath;
        var columnTitle = $("<input></input>");
        columnTitle.val(columns[j].name);
        columnTitle.change(function(){console.log(columnTitle.val(), xpath); relationObj.setColumnName(columns[j], columnTitle.val()); RecorderUI.updateDisplayedScript();});
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

  // returns true if we successfully parameterize this node with this relation, false if we can't
  function parameterizeNodeWithRelation(statement, relation, pageVar){
      var columns = relation.columns;
      for (var i = 0; i < columns.length; i++){
        var firstRowXpath = columns[i].firstRowXpath;
        if (firstRowXpath === statement.currentNode){
          statement.relation = relation;
          statement.currentNode = new WebAutomationLanguage.VariableUse(columns[i], relation, pageVar);
          return columns[i];
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
      return []; // loads don't get changed based on relations
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
    // todo: may be worth going back to the ctrl approach, but there are links that refuse to open that way, so for now let's try back buttons
    // proposeCtrlAdditions(this);
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
  };
  pub.ScrapeStatement = function(trace){
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
      var relationColumnUsed = parameterizeNodeWithRelation(this, relation, this.pageVar);
      if (relationColumnUsed){
        // this is cool because now we don't need to actually run scraping interactions to get the value, so let's update the cleanTrace to reflect that
        for (var i = this.cleanTrace.length - 1; i >= 0; i--){
          if (this.cleanTrace[i].additional && this.cleanTrace[i].additional.scrape){
            this.cleanTrace.splice(i, 1);
          }
        }
        console.log("shortened cleantrace", this.cleanTrace);
      }
      return [relationColumnUsed];
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
    if (!this.typedString){
      this.typedString = "";
    }
    this.typedStringLower = this.typedString.toLowerCase();
    var domEvents = _.filter(trace, function(ev){return ev.type === "dom";}); // any event in the segment may have triggered a load
    var outputLoads = _.reduce(domEvents, function(acc, ev){return acc.concat(EventM.getDOMOutputLoadEvents(ev));}, []);
    this.outputPageVars = _.map(outputLoads, function(ev){return EventM.getLoadOutputPageVar(ev);});
    // for now, assume the ones we saw at record time are the ones we'll want at replay
    this.currentNode = this.node;
    this.origNode = this.node;
    this.currentTypedString = this.typedString;

    this.toStringLines = function(){
      var stringRep = "";
      if (this.currentTypedString instanceof WebAutomationLanguage.Concatenate){
        stringRep = this.currentTypedString.toString();
      }
      else{
        stringRep = "'"+this.currentTypedString+"'";
      }
      return [outputPagesRepresentation(this)+"type("+this.pageVar.toString()+", "+stringRep+")"];
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

      // now let's also parameterize the text
      var columns = relation.columns;
      for (var i = 0; i < columns.length; i++){
        var text = columns[i].firstRowText;
        if (text === null){
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
      return [];
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
      ReplayScript.prog.mostRecentRow = cells;
    };
  }

  /*
  Statements below here are no longer executed by Ringer but rather by their own run methods
  */

  pub.BackStatement = function(pageVarCurr, pageVarBack){
    this.pageVarCurr = pageVarCurr;
    this.pageVarBack = pageVarBack;

    var backStatement = this;

    this.toStringLines = function(){
      return [this.pageVarBack.toString() + " = " + this.pageVarCurr.toString() + ".back()" ];
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
    };

    this.parameterizeForRelation = function(relation){
      return [];
    };
    this.unParameterizeForRelation = function(relation){
      return;
    };
  };

  pub.ContinueStatement = function(){
    this.toStringLines = function(){
      return ["continue"];
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
    this.bodyStatements = bodyStatements;

    this.toStringLines = function(){
      return ["if"]; // todo: when we have the real if statements, do the right thing
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
    this.relation = relation;
    this.relationColumnsUsed = relationColumnsUsed;
    this.bodyStatements = bodyStatements;
    this.pageVar = pageVar;

    this.toStringLines = function(){
      var relation = this.relation;
      var varNames = _.map(relationColumnsUsed, function(columnObject){return columnObject.name;});
      var prefix = "for "+varNames.join(", ")+" in "+this.pageVar.toString()+"."+this.relation.name+":";
      var statementStrings = _.reduce(this.bodyStatements, function(acc, statement){return acc.concat(statement.toStringLines());}, []);
      statementStrings = _.map(statementStrings, function(line){return ("&nbsp&nbsp&nbsp&nbsp "+line);});
      return [prefix].concat(statementStrings);
    };

    this.parameterizeForRelation = function(relation){
      return _.flatten(_.map(this.bodyStatements, function(statement){return statement.parameterizeForRelation(relation);}));
    };
    this.unParameterizeForRelation = function(relation){
      _.each(this.bodyStatements, function(statement){statement.unParameterizeForRelation(relation);});
    };
  }

  function usedByTextStatement(statement, parameterizeableStrings){
    if (!(statement instanceof WebAutomationLanguage.TypeStatement)){
      return false;
    }
    for (var i = 0; i < parameterizeableStrings.length; i++){
      if (!parameterizeableStrings[i]){ continue;}
      var lowerString = parameterizeableStrings[i].toLowerCase();
      if (statement.typedStringLower.indexOf(lowerString) > -1){
        return true;
      }
    }
    return false;
  }

  // used for relations that only have text in cells, as when user uploads the relation
  pub.TextRelation = function(csvFileContents){
    this.relation = $.csv.toArrays(csvFileContents);
    this.firstRowTexts = this.relation[0];

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

    this.getCurrentText = function(pageVar, columnObject){
      console.log(currentRowsCounter, "currentRowsCounter");
      return this.relation[currentRowsCounter][columnObject.index];
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

    console.log(this);
    this.processColumns();

    function initialize(){
      relation.firstRowXPaths = _.pluck(relation.demonstrationTimeRelation[0], "xpath");
      relation.firstRowTexts = _.pluck(relation.demonstrationTimeRelation[0], "text");
    }
    
    initialize();

    this.setNewAttributes = function(selector, selectorVersion, excludeFirst, columns, demonstrationTimeRelation, numRowsInDemo, nextType, nextButtonSelector){
      this.selector = msg.selector;
      this.selectorVersion = msg.selector_version;
      this.excludeFirst = msg.exclude_first;
      this.demonstrationTimeRelation = msg.demonstration_time_relation;
      this.numRowsInDemo = msg.num_rows_in_demo;
      this.nextType = msg.next_type;
      this.nextButtonSelector = msg.next_button_selector;

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
      if (!((statement instanceof WebAutomationLanguage.ScrapeStatement) || (statement instanceof WebAutomationLanguage.ClickStatement) || (statement instanceof WebAutomationLanguage.TypeStatement))){
        return false;
      }
      if (this.pageVarName === statement.pageVar.name && this.firstRowXPaths.indexOf(statement.node) > -1){
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

    function repeatUntil(repeatFunction, untilFunction, interval){
      if (untilFunction()){
        return;
      }
      repeatFunction();
      setTimeout(function(){repeatUntil(repeatFunction, untilFunction, interval);}, interval);
    }

    this.noMoreRows = function(prinfo, callback){
      // no more rows -- let the callback know we're done
      // clear the stored relation data also
      prinfo.currentRows = null;
      prinfo.currentRowsCounter = 0;
      callback(false); 
    };

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
      if (prinfo.currentRows === null){
        // cool!  no data right now, so we have to go to the page and ask for some

        // ok, here's what we'll do once we actually get some new items sent over
        var relationItemsRetrieved = false;
        var missesSoFar = 0;
        utilities.listenForMessageWithKey("content", "mainpanel", "freshRelationItems", "freshRelationItemsListener", function(data){ // with key so that we can remove the listener whenever we decide it's time to stop listening
          if (data.type === RelationItemsOutputs.NOMOREITEMS || (data.type === RelationItemsOutputs.NONEWITEMSYET && missesSoFar > 60)){
            // NOMOREITEMS -> definitively out of items.  this relation is done
            // NONEWITEMSYET && missesSoFar > 60 -> ok, time to give up at this point...
            relationItemsRetrieved = true; // to stop us from continuing to ask for freshitems
            utilities.stopListeningForMessageWithKey("content", "mainpanel", "freshRelationItems", "freshRelationItemsListener");
            relation.noMoreRows(prinfo, callback);
          }
          else if (data.type === RelationItemsOutputs.NONEWITEMSYET){
            missesSoFar += 1;
          }
          else if (data.type === RelationItemsOutputs.NEWITEMS){
            // yay, we have real data!
            relationItemsRetrieved = true; // to stop us from continuing to ask for freshitems
            utilities.stopListeningForMessageWithKey("content", "mainpanel", "freshRelationItems", "freshRelationItemsListener");
            prinfo.currentRows = data.relation;
            prinfo.currentRowsCounter = 0;
            callback(true);
          }
          else{
            console.log("woaaaaaah freak out, there's freshRelationItems that have an unknown type.");
          }
        });

        // and here's us asking for fresh relation items to be sent over
        if (!pageVar.currentTabId()){ console.log("Hey!  How'd you end up trying to find a relation on a page for which you don't have a current tab id??  That doesn't make sense.", pageVar); }
        var sendGetRelationItems = function(){
          utilities.sendMessage("mainpanel", "content", "getFreshRelationItems", relation.messageRelationRepresentation(), null, null, [pageVar.currentTabId()]);};
        repeatUntil(sendGetRelationItems, function(){return relationItemsRetrieved;}, 1000);
      }
      else if (prinfo.currentRowsCounter + 1 >= prinfo.currentRows.length){
        // ok, we had some data but we've run out.  time to try running the next button interaction and see if we can retrieve some more

        // here's what we want to do once we've actually clicked on the next button, more button, etc
        // essentially, we want to run getNextRow again, ready to grab new data from the page that's now been loaded or updated
        var runningNextInteraction = false;
        utilities.listenForMessageOnce("content", "mainpanel", "runningNextInteraction", function(data){
          runningNextInteraction = true;
          // cool, and we'll get to the situation where currentRows is null, so we'll start retrieving fresh items
          prinfo.currentRows = null;
          relation.getNextRow(pageVar, callback);
        });

        // here's us telling the content script to take care of clicking on the next button, more button, etc
        if (!pageVar.currentTabId()){ console.log("Hey!  How'd you end up trying to click next button on a page for which you don't have a current tab id??  That doesn't make sense.", pageVar); }
        var sendRunNextInteraction = function(){
          utilities.sendMessage("mainpanel", "content", "runNextInteraction", relation.messageRelationRepresentation(), null, null, [pageVar.currentTabId()]);};
        repeatUntil(sendRunNextInteraction, function(){return runningNextInteraction;}, 1000);
      }
      else {
        // we still have local rows that we haven't used yet.  just advance the counter to change which is our current row
        // the easy case :)
        prinfo.currentRowsCounter += 1;
        callback(true);
      }
    }

    this.getCurrentXPath = function(pageVar, columnObject){
      var prinfo = pageVar.pageRelations[this.name+"_"+this.id]
      if (prinfo === undefined){ console.log("Bad!  Shouldn't be calling getCurrentXPath on a pageVar for which we haven't yet called getNextRow."); return null; }
      return prinfo.currentRows[prinfo.currentRowsCounter][columnObject.index].xpath; // in the current row, xpath at the index associated with nodeName
    }

    this.getCurrentText = function(pageVar, columnObject){
      var prinfo = pageVar.pageRelations[this.name+"_"+this.id]
      if (prinfo === undefined){ console.log("Bad!  Shouldn't be calling getCurrentText on a pageVar for which we haven't yet called getNextRow."); return null; }
      return prinfo.currentRows[prinfo.currentRowsCounter][columnObject.index].text; // in the current row, value at the index associated with nodeName
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
      // todo: this should really be stable stringified (the selector), since we'll be using it to test equality of different relations
      var rel = this.messageRelationRepresentation();
      ServerTranslationUtilities.JSONifyRelation(rel);
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
    };

    this.clearRunningState = function(){
      // for relations retrieved from pages, all relation info is stored with pagevar variables, so don't need to do anything
    };
  }

  // todo: for now all variable uses are uses of relation cells, but eventually will probably want to have scraped from outside of relations too
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

  function outlier(sortedList, potentialItem){ // note that first arg should be SortedArray not just sorted array
    if (sortedList.length <= 10) {
      // it's just too soon to know if this is an outlier...
      return false;
    }
    // generous q1, q3
    var q1 = sortedList.get(Math.floor((sortedList.length() / 4)));
    var q3 = sortedList.get(Math.ceil((sortedList.length() * (3 / 4))));
    var iqr = q3 - q1;

    var minValue = q1 - iqr * 1.5;
    var maxValue = q3 + iqr * 1.5;
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
    this.name = name;
    this.recordTimeUrl = recordTimeUrl;
    this.pageRelations = {};
    this.pageStats = freshPageStats();

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
        utilities.sendMessage("mainpanel", "content", "pageStats", {}, null, null, null, [tabId]);
      }
      else{
        continuation();
      }
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
    this.components = components;

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
      var recordTimeCompletedToReplayTimeCompleted = alignRecordTimeAndReplayTimeCompletedEvents(recordTimeTrace, replayTimeTrace);
      var recEvents = recordTimeCompletedToReplayTimeCompleted[0];
      var repEvents = recordTimeCompletedToReplayTimeCompleted[1];
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
        }
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

    this.runBasicBlock = function(loopyStatements, callback){
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
        console.log("rbb: loop.");
        var loopStatement = loopyStatements[0];
        loopStatement.relation.getNextRow(loopStatement.pageVar, function(moreRows){
          if (!moreRows){
            console.log("no more rows");
            // hey, we're done!

            // once we're done with the loop, have to replay the remainder of the script
            program.runBasicBlock(loopyStatements.slice(1, loopyStatements.length), callback);
            return;
          }
          console.log("we have a row!  let's run");
          // otherwise, should actually run the body
          // block scope.  let's add a new frame
          program.environment = program.environment.envExtend(); // add a new frame on there
          // and let's give us access to all the loop variables
          var loopVarsMap = loopStatement.relation.getCurrentMappingFromVarNamesToValues(loopStatement.pageVar);
          // note that for now loopVarsMap includes all columns of the relation.  may some day want to limit it to only the ones used...
          for (var key in loopVarsMap){
            program.environment.envBind(key, loopVarsMap[key]);
          }
          console.log("loopyStatements", loopyStatements);
          program.runBasicBlock(loopStatement.bodyStatements, function(){
            // and once we've run the body, we should do the next iteration of the loop
            // but first let's get rid of that last environment frame
            program.environment = program.environment.parent;
            program.runBasicBlock(loopyStatements, callback); // running extra iterations of the for loop is the only time we change the callback
          });
        });
        return;
      }
      // also need special processing for back statements, if statements, continue statements, whatever isn't ringer-based
      else if (!ringerBased(loopyStatements[0])){
        console.log("rbb: non-Ringer-based statement.");
        var continuation = function(continueflag){ // remember that rbbcontinuations passed to run methods must always handle continueflag
          if (continueflag){
            // executed a continue statement, better stop going through this loop's statements, get back to the original callback
            callback();
            return;
          }
          // once we're done with this statement running, have to replay the remainder of the script
          program.runBasicBlock(loopyStatements.slice(1, loopyStatements.length), callback);
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
          if (loopyStatements[i] instanceof WebAutomationLanguage.LoopStatement || loopyStatements[i] instanceof WebAutomationLanguage.BackStatement){
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

        });
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
    var pagesToUrls = {};
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
          var pageVarName = s.pageVar.name; // pagevar is better than url for helping us figure out what was on a given logical page
          var url = s.pageVar.recordTimeUrl;
          if (!(pageVarName in pagesToNodes)){ pagesToNodes[pageVarName] = []; }
          if (pagesToNodes[pageVarName].indexOf(xpath) === -1){ pagesToNodes[pageVarName].push(xpath); }
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
                  ServerTranslationUtilities.unJSONifyRelation(suggestedRelations[j]); // is this the best place to deal with going between our object attributes and the server strings?
                }
              }
            }
            if (suggestedRelations === null){
              console.log("Panic!  We found a page in our outputPageVars that wasn't in our request to the server for relations that might be relevant on that page.");
            }

            // let's get some info from the pages, and when we get that info back we can come back and deal with more script segments
            pagesProcessed[targetPageVar.name] = false;
            var getLikelyRelationFunc = function(){utilities.sendMessage("mainpanel", "content", "likelyRelation", {xpaths: pagesToNodes[targetPageVar.name], pageVarName: targetPageVar.name, serverSuggestedRelations: suggestedRelations}, null, null, [lastCompletedEventTabId]);};
            var getLikelyRelationFuncUntilAnswer = function(){
              if (pagesProcessed[targetPageVar.name]){ return; } 
              getLikelyRelationFunc(); 
              setTimeout(getLikelyRelationFuncUntilAnswer, 5000);}

            // what should we do once we get the response back, having tested the various relations on the actual pages?
            utilities.listenForMessageOnce("content", "mainpanel", "likelyRelation", function(data){
              // handle the actual data the page sent us
              program.processLikelyRelation(data);
              // update the control panel display
              RecorderUI.updateDisplayedRelations();
              // now let's go through this process all over again for the next page, if there is one
              console.log("going to processServerRelations with nextIndex: ", nextIndex);
              program.processServerRelations(resp, nextIndex, tabsToCloseAfter, tabMapping);
            });
            setTimeout(getLikelyRelationFuncUntilAnswer, 1000); // give it a while to attach the listener
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
          backStatements.push(new WebAutomationLanguage.BackStatement(currPage, backPage));
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

  return pub;
}());