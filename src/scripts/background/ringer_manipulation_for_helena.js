'use strict'

/**********************************************************************
 * Hiding the modifications to the internals of Ringer event objects
 *
 * these are basically just a bunch of convenient functions for manipulating
 * events.  no state or anything
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
 *
 * this is what we use to turn low-level Ringer scripts into high-level
 * Helena scripts
 **********************************************************************/

var ReplayScript = (function _ReplayScript() {
  var pub = {};

  // controls the sequence of transformations we do when we get a trace

  pub.ringerTraceToHelenaProgram = function _ringerTraceToHelenaProgram(trace, windowId){
    WALconsole.log(trace);
    trace = processTrace(trace, windowId);
    trace = prepareForDisplay(trace);
    trace = markUnnecessaryLoads(trace);
    trace = associateNecessaryLoadsWithIDsAndParameterizePages(trace);
    trace = addCausalLinks(trace);
    trace = removeEventsBeforeFirstVisibleLoad(trace);

    var segmentedTrace = segment(trace);
    var prog = segmentedTraceToProgram(segmentedTrace);
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
    _.each(trace, function(ev){if (ev.type === "completed" && ev.data.type === "main_frame" && domEventURLs.indexOf(EventM.getLoadURL(ev)) > -1){ EventM.setVisible(ev, true);}});
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
    var lastDOMEvent = null;
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
    WALconsole.log("allowedInSameSegment?", e1type, e2type, e1, e2);
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
      var sType = null;
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
          else if (sType === StatementTypes.PULLDOWNINTERACTION){
            statements.push(new WebAutomationLanguage.PulldownInteractionStatement(seg));
          }
          break;
        }
      }
    });
    return new WebAutomationLanguage.Program(statements);
  }

  return pub;
}());