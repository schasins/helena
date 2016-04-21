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
    ReplayScript.setCurrentTrace(trace);
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
    console.log(statements);
    _.each(statements, function(statement){console.log(statement); console.log(statement.toString());});

    console.log(segmentedTrace);
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
    _.each(trace, function(ev){
      if (!ev.additional){ev.additional = {};} 
      ev.additional.display = {};});
    return trace;
  }

  // user doesn't need to see load events for loads that load URLs whose associated DOM trees the user never actually uses
  function markUnnecessaryLoads(trace){
    var domEvents =  _.filter(trace, function(ev){return ev.type === "dom";});
    var domEventURLs = _.unique(_.map(domEvents, function(ev){return ev.frame.topURL;}));
    _.each(trace, function(ev){if (ev.type === "completed" && domEventURLs.indexOf(ev.data.url) > -1){ ev.additional.display.visible = true;}});
    return trace;
  }

  var frameToPageVarId = {};
  function associateNecessaryLoadsWithIDs(trace){
    var idCounter = 1; // blockly says not to count from 0
    _.each(trace, function(ev){if (ev.type === "completed" && ev.additional.display.visible){ console.log(ev.data.url); ev.additional.display.pageVarId = idCounter; frameToPageVarId[ev.data.url] = idCounter; idCounter += 1;}});
    return trace;
  }

  function parameterizePages(trace){
    _.each(trace, function(ev){if (ev.type === "dom"){ if (!(ev.frame.topURL in frameToPageVarId)){console.log(ev.frame.topURL, frameToPageVarId);} ev.additional.display.inputPageVar = frameToPageVarId[ev.frame.topURL]; }});
    return trace;
  }

  function addCausalLinks(trace){
    lastDOMEvent = null;
    _.each(trace, function(ev){
      if (ev.type === "dom"){
        lastDOMEvent = ev;
        ev.additional.display.causesLoads = [];
      }
      else if (ev.typ === "completed" && ev.additional.display.visible) {
        ev.additional.display.causedBy = lastDOMEvent;
        lastDOMEvent.additional.display.causesLoads.append(ev);
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
      if (!ev.additional.display.visible){
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

  function segment(trace){
    var allSegments = [];
    var currentSegment = [];
    var currentDOMEventStatementType = null;
    var currentDOMEventTargetNode = null;
    _.each(trace, function(ev){
      var sType = statementType(ev);
      var xpath = null;
      if (ev.target) {xpath = ev.target.xpath;} // load events don't have targets
      if (currentDOMEventTargetNode === xpath && (currentDOMEventStatementType === null || sType === null || currentDOMEventStatementType == sType) ){
        currentSegment.push(ev);
        if (currentDOMEventStatementType === null){
          currentDOMEventStatementType = sType; // current block didn't yet have a statement type.  maybe now it does.
        }
      }
      else{
        // either we're on a new node or doing a new kind of action.  need a new segment
        allSegments.push(currentSegment);
        currentSegment = [ev];
        currentDOMEventStatementType = sType;
        currentDOMEventTargetNode = xpath;
      }});
    allSegments.push(currentSegment); // put in that last segment
    return allSegments;
  }

  function LoadStatement(url, outputPageVar, trace){
    this.url = url;
    this.outputPageVar = outputPageVar;
    this.trace = trace;

    this.toString = function(){
      return this.outputPageVar+" = load("+this.url+")";
    };
  }
  function ClickStatement(pageVar, node, outputPageVars, trace){
    this.pageVar = pageVar;
    this.node = node;
    this.outputPageVars = outputPageVars;
    this.trace = trace;

    this.toString = function(){
      return this.outputPageVars.join(", ")+" = click("+this.pageVar+", "+this.node+")";
    };
  }
  function ScrapeStatement(pageVar, node, trace){
    this.pageVar = pageVar;
    this.node = node;
    this.trace = trace;

    this.toString = function(){
      return "scrape("+this.pageVar+", "+this.node+")";
    };
  }
  function TypeStatement(pageVar, node, typedString, outputPageVars, trace){
    this.pageVar = pageVar;
    this.node = node;
    this.typedString = typedString;
    this.outputPageVars = outputPageVars;
    this.trace = trace;

    this.toString = function(){
      return this.outputPageVars.join(", ")+" = type("+this.pageVar+", "+this.node+", "+this.typedString+")";
    };
  }
  function InvisibleStatement(trace){
    this.trace = trace;
    this.toString = function(){
      return "";
    };
  }

    var StatementTypes = {
    MOUSE: "click",
    KEYBOARD: "type",
    LOAD: "load",
    SCRAPE: "extract"
  };

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
            console.log(ev);
            var url = ev.data.url;
            var outputPageVar = ev.additional.display.pageVarId;
            statements.push(new LoadStatement(url, outputPageVar, seg));
            break;
          }
          else if (sType === StatementTypes.MOUSE){
            console.log(ev);
            var pageVar = ev.additional.display.inputPageVar;
            var node = ev.target.xpath;
            var outputLoads = ev.additional.display.causesLoads;
            var outputPageVars = _.map(outputLoads, function(ev){return ev.additional.display.pageVarId;});
            statements.push(new ClickStatement(pageVar, node, outputPageVars, seg));
            break;
          }
          else if (sType === StatementTypes.SCRAPE){
            console.log(ev);
            var pageVar = ev.additional.display.inputPageVar;
            var node = ev.target.xpath;
            statements.push(new ScrapeStatement(pageVar, node, seg));
            break;
          }
          else if (sType === StatementTypes.KEYBOARD){
            console.log(ev);
            var pageVar = ev.additional.display.inputPageVar;
            var node = ev.target.xpath;
            var textEntryEvents = _.filter(seg, function(ev){statementToEventMapping.keyboard.indexOf(statementType(ev)) > -1;});
            var lastTextEntryEvent = textEntryEvents[-1];
            var finalTypedValue = ev.meta.deltas.value;
            var outputLoads = ev.additional.display.causesLoads;
            var outputPageVars = _.map(outputLoads, function(ev){return ev.additional.display.pageVarId;});
            statements.push(new TypeStatement(pageVar, node, finalTypedValue, outputPageVars, seg));
            break;
          }
        }
      }
      // we've gone through all the events in the segment and none were things we wanted to show the user
      console.log("weird segment: ", seg);
      statements.push(new InvisibleStatement(seg));
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