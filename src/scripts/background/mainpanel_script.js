function setUp(){

  //messages received by this component
  //utilities.listenForMessage("content", "mainpanel", "selectorAndListData", processSelectorAndListData);
  //utilities.listenForMessage("content", "mainpanel", "nextButtonData", processNextButtonData);
  //utilities.listenForMessage("content", "mainpanel", "moreItems", moreItems);
  utilities.listenForMessage("content", "mainpanel", "scrapedData", RecorderUI.processScrapedData);
  
  //messages sent by this component
  //utilities.sendMessage("mainpanel", "content", "startProcessingList", "");
  //utilities.sendMessage("mainpanel", "content", "stopProcessingList", "");
  //utilities.sendMessage("mainpanel", "content", "startProcessingNextButton", "");
  //utilities.sendMessage("mainpanel", "content", "getMoreItems", data);
  //utilities.sendMessage("mainpanel", "content", "getNextPage", data);
  
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
    utilities.replaceContent(div, $("#about_to_record"));
    div.find("#start_recording").click(RecorderUI.startRecording);
  }

  pub.startRecording = function(){
    var div = $("#new_script_content");
    utilities.replaceContent(div, $("#recording"));
    div.find("#stop_recording").click(RecorderUI.stopRecording);

    SimpleRecord.startRecording();
  }

  pub.stopRecording = function(){
    var trace = SimpleRecord.stopRecording();
    var scriptString = ReplayScript.setCurrentTrace(trace);
    var div = $("#new_script_content");
    utilities.replaceContent(div, $("#done_recording")); // let's put in the done_recording node
    var scriptPreviewDiv = div.find("#program_representation");
    utilities.replaceContent(scriptPreviewDiv, $("<div>"+scriptString+"</div>")); // let's put the script string in the done_recording node
    var replayButton = div.find("#replay");
    replayButton.button();
    replayButton.click(RecorderUI.replay);
  }

  pub.replay = function(){
    ReplayScript.prog.replay();
  }

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
  }

  return pub;
}());

/**********************************************************************
 * Hiding the modifications to the internals of Ringer event objects
 **********************************************************************/

var EventM = (function() {
  var pub = {};

  pub.prepareForDisplay = function(ev){
    if (!ev.additional){
      ev.additional = {};
    } 
    ev.additional.display = {};
  };

  pub.getLoadURL = function(ev){
    return ev.data.url;
  };

  pub.getDOMURL = function(ev){
    return ev.frame.topURL;
  };

  pub.getVisible = function(ev){
    return ev.additional.display.visible;
  };
  pub.setVisible = function(ev, val){
    ev.additional.display.visible = val;
  };

  pub.getLoadOutputPageVar = function(ev){
    return ev.additional.display.pageVarId;
  };
  pub.setLoadOutputPageVar = function(ev, val){
    ev.additional.display.pageVarId = val;
  };

  pub.getDOMInputPageVar = function(ev){
    return ev.additional.display.inputPageVar;
  };
  pub.setDOMInputPageVar = function(ev, val){
    ev.additional.display.inputPageVar = val;
  };

  pub.getDOMOutputLoadEvents = function(ev){
    return ev.additional.display.causesLoads;
  };
  pub.setDOMOutputLoadEvents = function(ev, val){
    ev.additional.display.causesLoads = val;
  };
  pub.addDOMOutputLoadEvent = function(ev, val){
    ev.additional.display.causesLoads.push(val);
  };

  pub.getLoadCausedBy = function(ev){
    return ev.additional.display.causedBy;
  };
  pub.setLoadCausedBy = function(ev, val){
    ev.additional.display.causedBy = val;
  };

  pub.clearDisplayInfo = function(ev){
    ev.additional.display = null;
  }

  return pub;
}());

/**********************************************************************
 * Manipulations of whole scripts
 **********************************************************************/

var ReplayScript = (function() {
  var pub = {};

  pub.trace = null;

  // controls the sequence of transformations we do when we get a trace

  pub.setCurrentTrace = function(trace){
    console.log(trace);
    trace = processTrace(trace);
    trace = prepareForDisplay(trace);
    trace = markUnnecessaryLoads(trace);
    trace = associateNecessaryLoadsWithIDs(trace);
    trace = parameterizePages(trace);
    trace = addCausalLinks(trace);
    pub.trace = trace;

    segmentedTrace = segment(trace);
    var prog = segmentedTraceToProgram(segmentedTrace);
    pub.prog = prog;
    return prog.toString();
  }

  // functions for each transformation

  function processTrace(trace){
    trace = sanitizeTrace(trace);
    return trace;
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
    _.each(trace, function(ev){if (ev.type === "completed" && EventM.getVisible(ev)){ var p = "p"+idCounter; EventM.setLoadOutputPageVar(ev, p); frameToPageVarId[EventM.getLoadURL(ev)] = p; idCounter += 1;}});
    return trace;
  }

  function parameterizePages(trace){
    _.each(trace, function(ev){if (ev.type === "dom"){ EventM.setDOMInputPageVar(ev, frameToPageVarId[EventM.getDOMURL(ev)]); }});
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

  // the actual statements

  pub.LoadStatement = function(trace){
    this.trace = trace;

    // find the record-time constants that we'll turn into parameters
    var ev = firstVisibleEvent(trace);
    this.url = ev.data.url;
    this.outputPageVar = EventM.getLoadOutputPageVar(ev);

    this.toString = function(){
      return this.outputPageVar+" = load('"+this.url+"')";
    };
  }
  pub.ClickStatement = function(trace){
    this.trace = trace;

    // find the record-time constants that we'll turn into parameters
    var ev = firstVisibleEvent(trace);
    this.pageVar = EventM.getDOMInputPageVar(ev);
    this.node = ev.target.xpath;
    var domEvents = _.filter(trace, function(ev){return ev.type === "dom";}); // any event in the segment may have triggered a load
    var outputLoads = _.reduce(domEvents, function(acc, ev){return acc.concat(EventM.getDOMOutputLoadEvents(ev));}, []);
    this.outputPageVars = _.map(outputLoads, function(ev){return EventM.getLoadOutputPageVar(ev);});

    this.toString = function(){
      prefix = "";
      if (this.outputPageVars.length > 0){
        prefix = this.outputPageVars.join(", ")+" = ";
      }
      return prefix+"click("+this.pageVar+", <img src='"+this.trace[0].additional.visualization+"'>)";
    };
  }
  pub.ScrapeStatement = function(trace){
    this.trace = trace;

    // find the record-time constants that we'll turn into parameters
    var ev = firstVisibleEvent(trace);
    this.pageVar = EventM.getDOMInputPageVar(ev);
    this.node = ev.target.xpath;

    this.toString = function(){
      return "scrape("+this.pageVar+", <img src='"+this.trace[0].additional.visualization+"'>)";
    };
  }
  pub.TypeStatement = function(trace){
    this.trace = trace;

    // find the record-time constants that we'll turn into parameters
    var ev = firstVisibleEvent(trace);
    this.pageVar = EventM.getDOMInputPageVar(ev);
    this.node = ev.target.xpath;
    var textEntryEvents = _.filter(trace, function(ev){statementToEventMapping.keyboard.indexOf(WebAutomationLanguage.statementType(ev)) > -1;});
    var lastTextEntryEvent = textEntryEvents[-1];
    this.typedString = ev.meta.deltas.value;
    var domEvents = _.filter(trace, function(ev){return ev.type === "dom";}); // any event in the segment may have triggered a load
    var outputLoads = _.reduce(domEvents, function(acc, ev){return acc.concat(EventM.getDOMOutputLoadEvents(ev));}, []);
    this.outputPageVars = _.map(outputLoads, function(ev){return EventM.getLoadOutputPageVar(ev);});

    this.toString = function(){
      prefix = "";
      if (this.outputPageVars.length > 0){
        prefix = this.outputPageVars.join(", ")+" = ";
      }
      return prefix+"type("+this.pageVar+",, <img src='"+this.trace[0].additional.visualization+"'>, '"+this.typedString+"')";
    };
  }

  // the whole program

  pub.Program = function(statements){
    this.statements = statements;

    this.toString = function(){
      var scriptString = "";
      _.each(this.statements, function(statement){scriptString += statement.toString() + "<br>";});
      return scriptString;
    };

    this.replay = function(){
      console.log("replaying");
      var trace = [];
      _.each(this.statements, function(statement){trace = trace.concat(statement.trace);});
      _.each(trace, function(ev){EventM.clearDisplayInfo(ev);});
      console.log(trace);
      SimpleRecord.replay(trace, null, function(){console.log("done recording.");});
    }
  }

  return pub;
}());