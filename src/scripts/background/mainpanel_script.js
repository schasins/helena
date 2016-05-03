function setUp(){

  //messages received by this component
  //utilities.listenForMessage("content", "mainpanel", "selectorAndListData", processSelectorAndListData);
  //utilities.listenForMessage("content", "mainpanel", "nextButtonData", processNextButtonData);
  //utilities.listenForMessage("content", "mainpanel", "moreItems", moreItems);
  utilities.listenForMessage("content", "mainpanel", "scrapedData", RecorderUI.processScrapedData);
  utilities.listenForMessage("content", "mainpanel", "likelyRelation", RecorderUI.processLikelyRelation);
  
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
  }

  pub.startRecording = function(){
    var div = $("#new_script_content");
    DOMCreationUtilities.replaceContent(div, $("#recording"));
    div.find("#stop_recording").click(RecorderUI.stopRecording);

    SimpleRecord.startRecording();
  }

  pub.stopRecording = function(){
    var trace = SimpleRecord.stopRecording();
    var program = ReplayScript.setCurrentTrace(trace);
    var scriptString = program.toString();
    program.relevantRelations(); // now that we have a script, let's set some processing in motion that will figure out likely relations
    var div = $("#new_script_content");
    DOMCreationUtilities.replaceContent(div, $("#done_recording")); // let's put in the done_recording node
    var scriptPreviewDiv = div.find("#program_representation");
    DOMCreationUtilities.replaceContent(scriptPreviewDiv, $("<div>"+scriptString+"</div>")); // let's put the script string in the done_recording node
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

  pub.processLikelyRelation = function(data){
    var textRelations = ReplayScript.prog.processLikelyRelation(data);
    $div = $("#new_script_content").find("#relations");
    $div.html("");
    for (var i = 0; i < textRelations.length; i++){
      var textRelation = textRelations[i];
      if (textRelation.length > 2){
        textRelation = textRelation.slice(0,2);
        textRelation.push(_.map(Array.apply(null, Array(textRelation[0].length)), function(){return "...";}));
      }
      $div.append(DOMCreationUtilities.arrayOfArraysToTable(textRelation));
    }
  }

  pub.showLoopyScript = function(){
    var program = ReplayScript.prog;
    var scriptString = program.toString();
    var scriptPreviewDiv = $("#new_script_content").find("#program_representation");
    DOMCreationUtilities.replaceContent(scriptPreviewDiv, $("<div>"+scriptString+"</div>")); // let's put the script string in the done_recording node
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
    delete ev.additional.display;
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
    return prog;
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
    // for now, assume the ones we saw at record time are the ones we'll want at replay
    this.currentUrl = this.url;

    this.toStringLines = function(){
      return [this.outputPageVar+" = load('"+this.url+"')"];
    };

    this.pbvs = function(){
      var pbvs = [];
      if (this.url !== this.currentUrl){
        pbvs.push({type:"url", value: this.url});
      }
      return pbvs;
    };

    this.args = function(){
      var args = [];
      args.push({type:"url", value: this.currentUrl});
      return args;
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

    this.toStringLines = function(){
      var prefix = "";
      if (this.outputPageVars.length > 0){
        prefix = this.outputPageVars.join(", ")+" = ";
      }
      return [prefix+"click("+this.pageVar+", <img src='"+this.trace[0].additional.visualization+"'>)"];
    };

    this.pbvs = function(){
      var pbvs = [];
      if (this.node !== this.currentNode){
        pbvs.push({type:"node", value: this.node});
      }
      return pbvs;
    };

    this.args = function(){
      var args = [];
      args.push({type:"node", value: this.currentNode});
      return args;
    };
  };
  pub.ScrapeStatement = function(trace){
    this.trace = trace;

    // find the record-time constants that we'll turn into parameters
    var ev = firstVisibleEvent(trace);
    this.pageVar = EventM.getDOMInputPageVar(ev);
    this.node = ev.target.xpath;
    this.pageUrl = ev.frame.topURL;
    // for now, assume the ones we saw at record time are the ones we'll want at replay
    this.currentNode = this.node;

    this.toStringLines = function(){
      return ["scrape("+this.pageVar+", <img src='"+this.trace[0].additional.visualization+"'>)"];
    };

    this.pbvs = function(){
      var pbvs = [];
      if (this.node !== this.currentNode){
        pbvs.push({type:"node", value: this.node});
      }
      return pbvs;
    };

    this.args = function(){
      var args = [];
      args.push({type:"node", value: this.currentNode});
      return args;
    };
  };
  pub.TypeStatement = function(trace){
    this.trace = trace;

    // find the record-time constants that we'll turn into parameters
    var ev = firstVisibleEvent(trace);
    this.pageVar = EventM.getDOMInputPageVar(ev);
    this.node = ev.target.xpath;
    this.pageUrl = ev.frame.topURL;
    var textEntryEvents = _.filter(trace, function(ev){statementToEventMapping.keyboard.indexOf(WebAutomationLanguage.statementType(ev)) > -1;});
    var lastTextEntryEvent = textEntryEvents[-1];
    this.typedString = ev.meta.deltas.value;
    var domEvents = _.filter(trace, function(ev){return ev.type === "dom";}); // any event in the segment may have triggered a load
    var outputLoads = _.reduce(domEvents, function(acc, ev){return acc.concat(EventM.getDOMOutputLoadEvents(ev));}, []);
    this.outputPageVars = _.map(outputLoads, function(ev){return EventM.getLoadOutputPageVar(ev);});
    // for now, assume the ones we saw at record time are the ones we'll want at replay
    this.currentNode = this.node;
    this.currentTypedString = this.typedString;

    this.toStringLines = function(){
      var prefix = "";
      if (this.outputPageVars.length > 0){
        prefix = this.outputPageVars.join(", ")+" = ";
      }
      return [prefix+"type("+this.pageVar+",, <img src='"+this.trace[0].additional.visualization+"'>, '"+this.typedString+"')"];
    };

    this.pbvs = function(){
      var pbvs = [];
      if (this.node !== this.currentNode){
        pbvs.push({type:"node", value: this.node});
      }
      return pbvs;
    };

    this.args = function(){
      var args = [];
      args.push({type:"node", value: this.currentNode});
      return args;
    };
  };

  pub.LoopStatement = function(relation, bodyStatements){
    this.relation = relation;
    this.bodyStatements = bodyStatements;

    this.toStringLines = function(){
      var prefix = "for loop:";
      var statementStrings = _.reduce(this.bodyStatements, function(acc, statement){return acc.concat(statement.toStringLines());}, []);
      statementStrings = _.map(statementStrings, function(line){return ("&nbsp&nbsp&nbsp&nbsp "+line);});
      return [prefix].concat(statementStrings);
    };
  }

  pub.Relation = function(selector, demonstrationTimeRelation, url){
    this.selector = selector;
    this.demonstrationTimeRelation = demonstrationTimeRelation;
    this.url = url;

    this.parameterizeableXpaths = function(){
      // for now, will only parameterize on the first row
      return _.map(this.demonstrationTimeRelation[0], function(cell){ return cell.xpath;});
    };

    this.usedByStatement = function(statement){
      if (!((statement instanceof WebAutomationLanguage.ScrapeStatement) || (statement instanceof WebAutomationLanguage.ClickStatement) || (statement instanceof WebAutomationLanguage.TypeStatement))){
        return false;
      }
      // for now we're only saying the relation is used if the nodes in the relation are used
      // todo: ultimately should also say it's used if the text contents of a node is typed
      return (this.url === statement.pageUrl && this.parameterizeableXpaths().indexOf(statement.node) > -1);
    }
  }

  // the whole program

  pub.Program = function(statements){
    this.statements = statements;
    this.relations = [];
    this.loopyStatements = [];

    this.toString = function(){
      var statementLs = this.loopyStatements;
      if (this.loopyStatements.length === 0){
        statementLs = this.statements;
      }
      var scriptString = "";
      _.each(statementLs, function(statement){scriptString += statement.toStringLines().join("<br>") + "<br>";});
      return scriptString;
    };

    this.replay = function(){
      var trace = [];
      _.each(this.statements, function(statement){trace = trace.concat(statement.trace);});
      _.each(trace, function(ev){EventM.clearDisplayInfo(ev);}); // strip the display info back out from the event objects

      // now that we have the trace, let's figure out how to parameterize it
      // note that this should only be run once the current___ variables in the statements have been updated!  otherwise won't know what needs to be parameterized, will assume nothing
      // should see in future whether this is a reasonable way to do it
      var parameterizedTrace = this.pbv(trace);
      // now that we've run parameterization-by-value, have a function, let's put in the arguments we need for the current run
      var runnableTrace = this.passArguments(parameterizedTrace);

      SimpleRecord.replay(runnableTrace, null, function(){console.log("Done replaying.");});
    };

    function paramName(statementIndex, paramType){ // assumes we can't have more than one of a single paramtype from a single statement.  should be true
      return "s"+statementIndex+"_"+paramType;
    }

    this.pbv = function(trace){
      var pTrace = new ParameterizedTrace(trace);

      for (var i = 0; i < this.statements.length; i++){
        var statement = this.statements[i];
        var pbvs = statement.pbvs();
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

    this.passArguments = function(pTrace){
      for (var i = 0; i < this.statements.length; i++){
        var statement = this.statements[i];
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

    var pagesToNodes = {};
    this.relevantRelations = function(){
      for (var i = 0; i < this.statements.length; i++){
        var s = this.statements[i];
        if ( (s instanceof WebAutomationLanguage.ScrapeStatement) || (s instanceof WebAutomationLanguage.ClickStatement) ){
          var xpath = s.node; // todo: in future, should get the whole node info, not just the xpath, but this is sufficient for now
          var url = s.pageUrl; // the top url of the frame on which the relevant events were raised
          if (! (url in pagesToNodes)){ pagesToNodes[url] = []; }
          if (! (xpath in pagesToNodes[url])){ pagesToNodes[url].push(xpath); }
        }
      }
      for (var url in pagesToNodes){
        (function(){
          var curl = url; // closure copy
          chrome.tabs.create({url: curl, active: false}, function(tab){
            setTimeout(function(){utilities.sendMessage("mainpanel", "content", "likelyRelation", {xpaths: pagesToNodes[curl], url:curl}, null, null, [tab.id]);}, 500); // give it a while to attach the listener
            // todo: may also want to do a timeout to make sure this actually gets a response
          });
        }());
      }
    };


    var pagesToRelations = {};
    this.processLikelyRelation = function(data){
      chrome.tabs.remove(data.tab_id); // no longer need the tab from which we got this info
      var rel = new WebAutomationLanguage.Relation(data.selector, data.relation, data.url);
      pagesToRelations[data.url] = rel;
      this.relations.push(rel);
      var textRelations = [];
      for (var url in pagesToRelations){
        var relation = pagesToRelations[url].demonstrationTimeRelation;
        relation = _.map(relation, function(row){return _.map(row, function(cell){return cell.text;});});
        textRelations.push(relation);
      }

      if (pagesToRelations.length === pagesToNodes.length){
        // awesome, all the pages have gotten back to us
        setTimeout(this.insertLoops.bind(this), 0); // bind this to this, since JS runs settimeout func with this pointing to global obj
      }

      // give the text relations back to the UI-handling component so we can display to user
      return textRelations;
    };

    this.insertLoops = function(){
      var indexesToRelations = {};
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
      var indexes = Object.keys(indexesToRelations).sort(function(a, b){return b-a});
      for (var i = 0; i < indexes.length; i++){
        var index = indexes[i];
        // let's grab all the statements from the loop's start index to the end, put those in the loop body
        var loopStatement = new WebAutomationLanguage.LoopStatement(indexesToRelations[index], this.loopyStatements.slice(index, this.loopyStatements.length));
        this.loopyStatements = this.loopyStatements.slice(0, index);
        this.loopyStatements.push(loopStatement);
      }

      RecorderUI.showLoopyScript();
    };

  }

  return pub;
}());