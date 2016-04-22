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
    utilities.replaceContent($("#new_script_content"), $("<div>"+scriptString+"</div>"));
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
 * Wrangling the replay script once we have the raw trace
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

  return pub;
}());

var ReplayScript = (function() {
  var pub = {};

  pub.trace = null;

  pub.setCurrentTrace = function(trace){
    trace = processTrace(trace);
    trace = prepareForDisplay(trace);
    trace = markUnnecessaryLoads(trace);
    trace = associateNecessaryLoadsWithIDs(trace);
    trace = parameterizePages(trace);
    trace = addCausalLinks(trace);
    pub.trace = trace;

    segmentedTrace = segment(trace);
    statements = segmentedTraceToStatements(segmentedTrace);
    pub.statements = statements; // the actual useful representation
    var scriptString = "";
    _.each(statements, function(statement){console.log(statement.toString()); scriptString += statement.toString() + "<br>";});
    pub.scriptString = scriptString;
    return scriptString;
  }

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

  var StatementTypes = {
    MOUSE: "click",
    KEYBOARD: "type",
    LOAD: "load",
    SCRAPE: "extract"
  };

  var statementToEventMapping = {
    mouse: ['click','dblclick','mousedown','mousemove','mouseout','mouseover','mouseup'],
    keyboard: ['keydown','keyup','keypress','textinput','paste','input']
  };

  function statementType(ev){
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

  function allowedInSameSegment(e1, e2){
    // if either of them is null (as when we do not yet have a current visible event), anything goes
    if (e1 === null || e2 === null){
      return true;
    }
    var e1type = statementType(e1);
    var e2type = statementType(e2);
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
        if (currentSegmentVisibleEvent === null && statementType(ev) !== null ){ // only relevant to first segment
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

  function LoadStatement(url, outputPageVar, trace){
    this.url = url;
    this.outputPageVar = outputPageVar;
    this.trace = trace;

    this.toString = function(){
      return this.outputPageVar+" = load('"+this.url+"')";
    };
  }
  function ClickStatement(pageVar, node, outputPageVars, trace){
    this.pageVar = pageVar;
    this.node = node;
    this.outputPageVars = outputPageVars;
    this.trace = trace;

    this.toString = function(){
      prefix = "";
      if (this.outputPageVars.length > 0){
        prefix = this.outputPageVars.join(", ")+" = ";
      }
      return prefix+"click("+this.pageVar+", <img src='"+this.trace[0].additional.visualization+"'>)";
    };
  }
  function ScrapeStatement(pageVar, node, trace){
    this.pageVar = pageVar;
    this.node = node;
    this.trace = trace;

    this.toString = function(){
      return "scrape("+this.pageVar+", <img src='"+this.trace[0].additional.visualization+"'>)";
    };
  }
  function TypeStatement(pageVar, node, typedString, outputPageVars, trace){
    this.pageVar = pageVar;
    this.node = node;
    this.typedString = typedString;
    this.outputPageVars = outputPageVars;
    this.trace = trace;

    this.toString = function(){
      prefix = "";
      if (this.outputPageVars.length > 0){
        prefix = this.outputPageVars.join(", ")+" = ";
      }
      return prefix+"type("+this.pageVar+",, <img src='"+this.trace[0].additional.visualization+"'>, '"+this.typedString+"')";
    };
  }

  function segmentedTraceToStatements(segmentedTrace){
    var statements = [];
    _.each(segmentedTrace, function(seg){
      sType = null;
      for (var i = 0; i < seg.length; i++){
        var ev = seg[i];
        var st = statementType(ev);
        if (st !== null){
          sType = st;
          if (sType === StatementTypes.LOAD){
            var url = ev.data.url;
            var outputPageVar = EventM.getLoadOutputPageVar(ev);
            statements.push(new LoadStatement(url, outputPageVar, seg));
            break;
          }
          else if (sType === StatementTypes.MOUSE){
            var pageVar = EventM.getDOMInputPageVar(ev);
            var node = ev.target.xpath;
            var domEvents = _.filter(seg, function(ev){return ev.type === "dom";}); // any event in the segment may have triggered a load
            var outputLoads = _.reduce(domEvents, function(acc, ev){return acc.concat(EventM.getDOMOutputLoadEvents(ev));}, []);
            var outputPageVars = _.map(outputLoads, function(ev){return EventM.getLoadOutputPageVar(ev);});

            statements.push(new ClickStatement(pageVar, node, outputPageVars, seg));
            break;
          }
          else if (sType === StatementTypes.SCRAPE){
            var pageVar = EventM.getDOMInputPageVar(ev);
            var node = ev.target.xpath;
            statements.push(new ScrapeStatement(pageVar, node, seg));
            break;
          }
          else if (sType === StatementTypes.KEYBOARD){
            var pageVar = EventM.getDOMInputPageVar(ev);
            var node = ev.target.xpath;
            var textEntryEvents = _.filter(seg, function(ev){statementToEventMapping.keyboard.indexOf(statementType(ev)) > -1;});
            var lastTextEntryEvent = textEntryEvents[-1];
            var finalTypedValue = ev.meta.deltas.value;
            var domEvents = _.filter(seg, function(ev){return ev.type === "dom";}); // any event in the segment may have triggered a load
            var outputLoads = _.reduce(domEvents, function(acc, ev){return acc.concat(EventM.getDOMOutputLoadEvents(ev));}, []);
            var outputPageVars = _.map(outputLoads, function(ev){return EventM.getLoadOutputPageVar(ev);});
            statements.push(new TypeStatement(pageVar, node, finalTypedValue, outputPageVars, seg));
            break;
          }
        }
      }
    });
    return statements;
  }

  // from output trace, extract the items that were scraped
  pub.capturesFromTrace = function(trace){
    var scraped_nodes = {};
    for (var i = 0; i < trace.length; i++){
      var event = trace[i];
      if (event.type !== "dom"){continue;}
        var additional = event.additional;
        if (additional.scrape){
          var c = additional.scrape;
          //only want one text per node, even though click on same node, for instance, has 3 events
          scraped_nodes[c.xpath] = c;
        }
      }
    var items = _.map(scraped_nodes, function(val,key){return val;});
    return items;
  }

  return pub;
}());