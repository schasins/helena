/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set shiftwidth=2 tabstop=2 autoindent cindent expandtab: */

'use strict';

/* Variables are kept in the global scopes so addons have access to them in an
 * easy-to-access manner. This should be ok since content scripts have a
 * scope isolated from the page's scope, so just need to be careful that an
 * add-on doesn't pollute the scope. */

var recording = RecordState.STOPPED;
var frameId = 'setme';
var port; /* port variable to send msgs to content script */

/* Record variables */
var pageEventId = 0; /* counter to give each event on page a unique id */
var lastRecordEvent; /* last event recorded */
var lastRecordSnapshot; /* snapshot (before and after) for last event */
var curRecordSnapshot; /* snapshot (before and after) the current event */

var additional_recording_handlers = {}; // so that other tools using an interface to r+r can put data in event messages
var additional_recording_handlers_on = {};

additional_recording_handlers_on.___additionalData___ = true;
additional_recording_handlers.___additionalData___ = function(){return {};}; // the only default additional handler, for copying data from record event objects to replay event objects

var additional_recording_filters_on = {}; // so that other tools using an interface to r+r can process event even before most processing done
var additional_recording_filters = {};

/* Replay variables */
var lastReplayEvent; /* last event replayed */
var lastReplayTarget;
var lastReplaySnapshot; /* snapshop taken before the event is replayed */
var curReplaySnapshot; /* snapshot taken before the next event is replayed */
var dispatchingEvent = false; /* if we currently dispatching an event */
var retryTimeout = null; /* handle to retry callback */
var simulatedEvents = null; /* current events we need are trying to dispatch */
var simulatedEventsIdx = 0;
var timeoutInfo = {startTime: 0, startIndex: 0, events: null};

/* Addon hooks */
var addonStartup = [];
var addonStartRecording = [];
var addonPreRecord = [];
var addonPostRecord = [];
var addonPreReplay = [];
var addonPreTarget = [];
var addonTarget = [];

/* Loggers */
var log = getLog('content');
var recordLog = getLog('record');
var replayLog = getLog('replay');

// ***************************************************************************
// Recording code
// ***************************************************************************

/* Reset all of the record time variables */
function resetRecord() {
  lastRecordEvent = null;
  lastRecordSnapshot = null;
  curRecordSnapshot = null;
}

/* Get the class of an event, which is used to init and dispatch it
 *
 * @param {string} type The DOM event type
 * @returns {string} The class type, such as MouseEvent, etc.
 */
function getEventType(type) {
  for (var eventType in params.events) {
    var eventTypes = params.events[eventType];
    for (var e in eventTypes) {
      if (e === type) {
        return eventType;
      }
    }
  }
  return null;
};

/* Return the default event properties for an event */
function getEventProps(type) {
  var eventType = getEventType(type);
  return params.defaultProps[eventType];
}

/* Find matching event in simulatedEvents. Needed to ensure that an event is
 * not replayed twice, i.e. once by the browser and once by the tool. */
function getMatchingEvent(eventData) {
  if (!dispatchingEvent)
    return null;

  if (simulatedEvents == null ||
      simulatedEventsIdx >= simulatedEvents.length)
    return null;

  var eventObject = simulatedEvents[simulatedEventsIdx];
  if (eventObject.data.type == eventData.type) {
    return eventObject;
  }

  return null;
}

function incrementMatchedEventIndex() {
  simulatedEventsIdx++;
}

/* Create an event record given the data from the event handler */
function recordEvent(eventData) {
  /* check if we are stopped, then just return */
  if (recording == RecordState.STOPPED)
    return true;

  for (var key in additional_recording_filters_on){
    if (!additional_recording_filters_on[key] || !additional_recording_filters[key]){ // on may be false, or may lack a handler if user attached something silly
      continue;
    }
    var filterIt = additional_recording_filters[key](eventData);
    if (filterIt){
      return; // the message including the eventMessage will never be sent, so this event will never be recorded
    }
  }

  var type = eventData.type;
  var dispatchType = getEventType(type);
  var shouldRecord = params.events[dispatchType][type];
  if (params.ctrlOnlyEvents.indexOf(type) > -1 && !eventData.ctrlKey){
    //console.log("Ignoring "+type+" because CTRL key not down.");
    shouldRecord = false;
  }

  var matched = getMatchingEvent(eventData);

  if (!matched && type == 'change' && recording == RecordState.REPLAYING) {
    eventData.stopImmediatePropagation();
    eventData.preventDefault();
    return false;
  }

  /* cancel the affects of events which are not extension generated or are not
   * picked up by the recorder */
  if (params.replay.cancelUnknownEvents && 
      recording == RecordState.REPLAYING && !dispatchingEvent) {
    recordLog.debug('[' + frameId + '] cancel unknown event during replay:',
         type, dispatchType, eventData);
    eventData.stopImmediatePropagation();
    eventData.preventDefault();
    return false;
  }

  if (params.record.cancelUnrecordedEvents &&
      recording == RecordState.RECORDING && !shouldRecord) {
    recordLog.debug('[' + frameId + '] cancel unrecorded event:', type, 
        dispatchType, eventData);
    eventData.stopImmediatePropagation();
    eventData.preventDefault();
    return false;
  }

  /* if we are not recording this type of event, we should exit */
  if (!shouldRecord)
    return true;

  /* handle any event recording the addons need */
  for (var i = 0, ii = addonPreRecord.length; i < ii; ++i) {
    if (!addonPreRecord[i](eventData))
      return false;
  }

  /* continue recording the event */
  recordLog.debug('[' + frameId + '] process event:', type, dispatchType,
      eventData);
  sendAlert('Recorded event: ' + type);

  var properties = getEventProps(type);
  var target = eventData.target;
  var nodeName = target.nodeName.toLowerCase();

  var eventMessage = {
    frame: {},
    data: {},
    timing: {},
    meta: {},
    additional: {}
  };

  /* deal with all the replay mess that we can't do in simulate */
  if (recording == RecordState.REPLAYING){
    replayUpdateDeltas(eventData, eventMessage);
  }

  /* deal with snapshotting the DOM, calculating the deltas, and sending
   * updates */
  updateDeltas(target);

  eventMessage.target = saveTargetInfo(target, recording);
  var relatedTarget = eventData.relatedTarget;
  if (relatedTarget) {
    eventMessage.relatedTarget = saveTargetInfo(relatedTarget, recording);
  }

  eventMessage.frame.URL = document.URL;
  eventMessage.meta.dispatchType = dispatchType;
  eventMessage.meta.nodeName = nodeName;
  eventMessage.meta.pageEventId = pageEventId++;
  eventMessage.meta.recordState = recording;
  eventMessage.type = 'dom';

  var data = eventMessage.data;
  /* record all properties of the event object */
  if (params.record.allEventProps) {
    for (var prop in eventData) {
      try {
        var value = eventData[prop];
        var t = typeof(value);
        if (t == 'number' || t == 'boolean' || t == 'string' || 
            t == 'undefined') {
          data[prop] = value;
        }
      } catch (err) {
        recordLog.error('[' + frameId + '] error recording property:', prop, err);
      }
    }
  /* only record the default event properties */
  } else {
    for (var prop in properties) {
      if (prop in eventData)
        data[prop] = eventData[prop];
    }
  }

  // now we need to handle the timeStamp, which is milliseconds from epoch in old Chrome, but milliseconds from start of current page load in new Chrome
  if (data.timeStamp < 307584000000){
    // if you've been waiting on this page for 10 years, you're out of luck
    // we're assuming this is new Chrome's time since page load
    data.timeStamp = data.timeStamp + performance.timing.navigationStart;
  }

  /* handle any event recording the addons need */
  for (var i = 0, ii = addonPostRecord.length; i < ii; ++i) {
    addonPostRecord[i](eventData, eventMessage);
  }
  
  for (var key in additional_recording_handlers_on){
	  if (!additional_recording_handlers_on[key] || !additional_recording_handlers[key]){ // on may be false, or may lack a handler if user attached something silly
      continue;
    }
	  var handler = additional_recording_handlers[key];
	  var ret_val = handler(target, eventMessage);
    if (ret_val === false){
      // additional recording handlers are allowed to throw out events by returning false
      // this may not be a good design, so something to consider in future
      // also, is false really the value that should do this?
      return; // the message including the eventMessage will never be sent, so this event will never be recorded
    }
    if (ret_val !== null){
      eventMessage.additional[key] = ret_val;
    }
  }

  /* save the event record */
  recordLog.debug('[' + frameId + '] saving event message:', eventMessage);
  port.postMessage({type: 'event', value: eventMessage, state: recording});
  lastRecordEvent = eventMessage;

  /* check to see if this event is part of a cascade of events. we do this 
   * by setting a timeout, which will execute after the cascade of events */
  setTimeout(function() {
    var update = {
      type: 'updateEvent',
      value: {
        pageEventId: eventMessage.meta.pageEventId,
        updates: [
          {field: 'meta.endEventId', value: lastRecordEvent.meta.pageEventId}
        ]
      },
      state: lastRecordEvent.meta.recordState
    };
    console.log('Update:', update);
    port.postMessage(update);
  }, 0);

  // TODO: special case with mouseover, need to return false
  return true;
};

function updateExistingEvent(eventMessage, field, value) {
    var update = {
      type: 'updateEvent',
      value: {
        pageEventId: eventMessage.meta.pageEventId,
        updates: [
          {field: field, value: value}
        ]
      },
      state: recording
    };
    port.postMessage(update);
}

/* Fix deltas that did not occur during replay */
function replayUpdateDeltas(eventData, eventMessage) {
  var replayEvent = getMatchingEvent(eventData);
  if (replayEvent) {
    incrementMatchedEventIndex();
      
    replayEvent.replayed = true;

    eventMessage.meta.recordId = replayEvent.meta.id;
    var target = eventData.target;
    snapshotReplay(target);

    /* make sure the deltas from the last event actually happened */
    if (params.compensation.enabled && lastReplayEvent) {
      var recordDeltas = lastReplayEvent.meta.deltas;
      if (typeof recordDeltas == 'undefined') {
        recordLog.error('no deltas found for last event:', lastReplayEvent);
        recordDeltas = [];
      }

      /* make sure replay matches recording */
      if (lastReplaySnapshot) {
        var replayDeltas = getDeltas(lastReplaySnapshot.before,
                                     lastReplaySnapshot.after);
        /* check if these deltas match the last simulated event
         * and correct for unmatched deltas */
        fixDeltas(recordDeltas, replayDeltas, lastReplayTarget);
      }

      /* Resnapshot to record the changes caused by fixing the deltas */
      resnapshotBefore(target);
    }
    lastReplayEvent = replayEvent;
    lastReplayTarget = target;
  }
}

/* Create a snapshot of the target element */
function snapshotRecord(target) {
  lastRecordSnapshot = curRecordSnapshot;
  if (lastRecordSnapshot)
    lastRecordSnapshot.after = snapshotNode(lastRecordSnapshot.target);

  curRecordSnapshot = {before: snapshotNode(target), target: target};
}

/* Update the deltas for the previous event */
function updateDeltas(target) {
  snapshotRecord(target);

  if (lastRecordEvent && lastRecordSnapshot) {
    var deltas = getDeltas(lastRecordSnapshot.before,
                           lastRecordSnapshot.after);
    lastRecordEvent.deltas = deltas;
    var update = {
      type: 'updateEvent',
      value: {
        pageEventId: lastRecordEvent.meta.pageEventId,
        updates: [
          {field: 'meta.deltas', value: deltas},
          {field: 'meta.nodeSnapshot', 
           value: snapshotNode(lastRecordSnapshot.target)}
        ]
      },
      state: recording
    };
    port.postMessage(update);
  }
}

// ***************************************************************************
// Replaying code
// ***************************************************************************

/* Needed since some event properties are marked as read only */
  function setEventProp(e, prop, value) {
    try {
      if (e[prop] != value) {
        e[prop] = value;
      }
    } catch(err) {}
    try {
      if (e[prop] != value) {
        Object.defineProperty(e, prop, {value: value});
      }
    } catch(err) {}
    try {
      if (e[prop] != value) {
        (function() {
          var v = value;
          Object.defineProperty(e, prop, {get: function() {v},
                                          set: function(arg) {v = arg;}});
        })();
        Object.defineProperty(e, prop, {value: value});
      }
    } catch(err) {
      replayLog.log(err);
    }
  }

/* Check if the current event has timed out.
 *
 * @params events The current list of events to replay.
 * @params startIndex The index into @link{events} which is needs to be
 *     replayed.
 * @returns {boolean} True if timeout has occured
 */
function checkTimeout(events, startIndex) {
  var timeout = params.replay.targetTimeout;
  if (timeout != null && timeout > 0) {
    var curTime = new Date().getTime();

    /* we havent changed event */
    if (timeoutInfo.events == events &&
        timeoutInfo.startIndex == startIndex) {
      if (curTime - timeoutInfo.startTime > timeout * 1000)
        return true;
    } else {
      timeoutInfo = {startTime: curTime, startIndex: startIndex,
                     events: events};
    }
  }
  return false;
}

/* Replays a set of events atomically
 *
 * @params events The current list of events to replay.
 * @params startIndex The index into @link{events} which is needs to be
 *     replayed.
 */
function simulate(events, startIndex) {
  /* since we are simulating new events, lets clear out any retries from
   * the last request */
  clearRetry();

  simulatedEvents = events;
  simulatedEventsIdx = 0;

  for (var i = startIndex, ii = events.length; i < ii; ++i) {
    var eventRecord = events[i];

    /* Should not replay non-dom events here */
    if (eventRecord.type != 'dom') {
      replayLog.error('Simulating unknown event type');
      throw 'Unknown event type';
    }

    var eventData = eventRecord.data;
    var eventName = eventData.type;

    /* this event was detected by the recorder, so lets skip it */
    if (params.replay.cascadeCheck && events[i].replayed)
      continue;

    /* handle any event replaying the addons need */
    for (var j = 0, jj = addonPreTarget.length; j < jj; ++j) {
      addonPreTarget[j](eventRecord);
    }

    replayLog.debug('simulating:', eventName, eventData);

    var target = null;
    if (addonTarget.length > 0) {
      /* use the addon's target */
      for (var j = 0, jj = addonTarget.length; j < jj; ++j) {
        target = addonTarget[j](eventRecord);
        if (target)
          break;
      }
    } else {
      var targetInfo = eventRecord.target;
      var xpath = targetInfo.xpath;
  
      /* find the target */
      target = getTarget(targetInfo);
    }

    /* if no target exists, lets try to dispatch this event a little bit in
     *the future, and hope the page changes */
    if (!target) {
      if (checkTimeout(events, i)) {
        replayLog.warn('timeout finding target, skip event: ', events, i);
        // we timed out with this target, so lets skip the event
        i++;
      }

      setRetry(events, i, params.replay.defaultWait);
      return;
    }

    if (params.replay.highlightTarget) {
      if (["blur","focus"].indexOf(eventName) === -1){
        highlightNode(target, 100);
      }
    }
        
  	// additional handlers should run in replay only if ran in record
  	for (var key in additional_recording_handlers_on){
  		additional_recording_handlers_on[key] = false;
  	}
    for (var key in eventRecord.additional){
  		additional_recording_handlers_on[key] = true;
  	}
    // want to copy over any data in additionalData, so let's remember what's in current event object's additionalData field
    additional_recording_handlers_on.___additionalData___ = true;
    additional_recording_handlers.___additionalData___ = function(){
      if (eventRecord.additional && eventRecord.additional.___additionalData___){
        return eventRecord.additional.___additionalData___; 
      }
      return {};
    };

    /* Create an event object to mimick the recorded event */
    var eventType = getEventType(eventName);
    var defaultProperties = getEventProps(eventName);

    if (!eventType) {
      replayLog.error("can't find event type ", eventName);
      return;
    }

    var options = jQuery.extend({}, defaultProperties, eventData);

    var oEvent = document.createEvent(eventType);
    if (eventType == 'Event') {
      oEvent.initEvent(eventName, options.bubbles, options.cancelable);
    } else if (eventType == 'FocusEvent') {
      var relatedTarget = null;

      if (eventRecord.relatedTarget)
        relatedTarget = getTarget(eventData.relatedTarget);

      oEvent.initUIEvent(eventName, options.bubbles, options.cancelable,
          document.defaultView, options.detail);
      setEventProp(oEvent, 'relatedTarget', relatedTarget);
    } else if (eventType == 'MouseEvent') {
      var relatedTarget = null;

      if (eventRecord.relatedTarget)
        relatedTarget = getTarget(eventRecord.relatedTarget);

      oEvent.initMouseEvent(eventName, options.bubbles, options.cancelable,
          document.defaultView, options.detail, options.screenX,
          options.screenY, options.clientX, options.clientY,
          options.ctrlKey, options.altKey, options.shiftKey, options.metaKey,
          options.button, relatedTarget);
    } else if (eventType == 'KeyboardEvent') {
      // TODO: nonstandard initKeyboardEvent
      oEvent.initKeyboardEvent(eventName, options.bubbles, options.cancelable,
          document.defaultView, options.keyIdentifier, options.keyLocation,
          options.ctrlKey, options.altKey, options.shiftKey, options.metaKey);

      var propsToSet = ['charCode', 'keyCode'];

      for (var j = 0, jj = propsToSet.length; j < jj; ++j) {
        var prop = propsToSet[j];
        setEventProp(oEvent, prop, options[prop]);
      }

    } else if (eventType == 'TextEvent') {
      oEvent.initTextEvent(eventName, options.bubbles, options.cancelable,
          document.defaultView, options.data, options.inputMethod,
          options.locale);
    } else {
      replayLog.error('unknown type of event');
    }

    /* used to detect extension generated events */
    oEvent.extensionGenerated = true;
    if (eventData.cascading) {
      oEvent.cascading = eventData.cascading;
      oEvent.cascadingOrigin = eventData.cascadingOrigin;
    }

    replayLog.debug('[' + frameId + '] dispatchEvent', eventName, options, target,
                    oEvent);

    /* send the update to the injected script so that the event can be 
     * updated on the pages's context */
    var detail = {};
    for (var prop in oEvent) {
      var data = oEvent[prop];
      var type = typeof(data);

      if (type == 'number' || type == 'boolean' || type == 'string' ||
          type == 'undefined') {
        detail[prop] = data;
      } else if (prop == 'relatedTarget' && isElement(data)) {
        detail[prop] = nodeToXPath(data);
      }
    }
    document.dispatchEvent(new CustomEvent('webscript', {detail: detail}));

    /* update panel showing event was sent */
    sendAlert('Dispatched event: ' + eventData.type);

    /* handle any event replaying the addons need */
    for (var j = 0, jj = addonPreReplay.length; j < jj; ++j) {
      addonPreReplay[j](target, oEvent, eventRecord, events);
    }

    /* actually dispatch the event */ 
    dispatchingEvent = true;
    target.dispatchEvent(oEvent);
    dispatchingEvent = false;
  }
  /* let the background page know that all the events were replayed (its
   * possible some/all events were skipped) */
  port.postMessage({type: 'ack', value: {type: Ack.SUCCESS}, state: recording});
  replayLog.debug('sent ack: ', frameId);
}

/* Stop the next execution of simulate */
function clearRetry() {
  if (retryTimeout) {
    clearTimeout(retryTimeout);
    retryTimeout = null;
  }
}

/* Try simulating again in a little bit */
function setRetry(events, startIndex, timeout) {
  retryTimeout = setTimeout(function() {
    simulate(events, startIndex);
  }, timeout);
  return;
}

/* Take a snapshot of the target */
function snapshotReplay(target) {
  replayLog.log('snapshot target:', target);
  lastReplaySnapshot = curReplaySnapshot;
  if (lastReplaySnapshot)
    lastReplaySnapshot.after = snapshotNode(lastReplaySnapshot.target);

  curReplaySnapshot = {before: snapshotNode(target), target: target};
}

/* Update the snapshot */
function resnapshotBefore(target) {
  curReplaySnapshot.before = snapshotNode(target);
}

/* Update the lastTarget, so that the record and replay deltas match */
function fixDeltas(recordDeltas, replayDeltas, lastTarget) {
  replayLog.info('record deltas:', recordDeltas);
  replayLog.info('replay deltas:', replayDeltas);

  /* effects of events that were found in record but not replay */
  var recordDeltasNotMatched = filterDeltas(recordDeltas, replayDeltas);
  /* effects of events that were found in replay but not record */
  var replayDeltasNotMatched = filterDeltas(replayDeltas, recordDeltas);

  replayLog.info('record deltas not matched: ', recordDeltasNotMatched);
  replayLog.info('replay deltas not matched: ', replayDeltasNotMatched);

  var element = lastTarget;

  for (var i = 0, ii = replayDeltasNotMatched.length; i < ii; ++i) {
    var delta = replayDeltasNotMatched[i];
    replayLog.debug('unmatched replay delta', delta);

    if (delta.type == 'Property is different.') {
      var divProp = delta.divergingProp;
      if (params.replay.compensation == CompensationAction.FORCED) {
        element[divProp] = delta.orig.prop[divProp];
      }
    }
  }

  /* the thing below is the stuff that's doing divergence synthesis */
  for (var i = 0, ii = recordDeltasNotMatched.length; i < ii; ++i) {
    var delta = recordDeltasNotMatched[i];
    replayLog.debug('unmatched record delta', delta);

    if (delta.type == 'Property is different.') {
      var divProp = delta.divergingProp;
      if (params.replay.compensation == CompensationAction.FORCED) {
        element[divProp] = delta.changed.prop[divProp];
      }
    }
  }
}

// ***************************************************************************
// Prompt code
// ***************************************************************************

var promptCallback = null;

function promptUser(text, callback) {
  if (!promptCallback)
    log.warn('overwriting old prompt callback');

  promptCallback = callback;
  port.postMessage({type: 'prompt', value: text, state: recording});
}

function promptResponse(text) {
  if (promptCallback)
    promptCallback(text);

  promptCallback = null;
}

// ***************************************************************************
// Misc code
// ***************************************************************************

var highlightCount = 0;

/* Highlight a node with a green rectangle. Uesd to indicate the target. */
function highlightNode(target, time) {
  var offset = $(target).offset();
  var boundingBox = target.getBoundingClientRect();
  var newDiv = $('<div/>');
  var idName = 'sbarman-hightlight-' + highlightCount;
  newDiv.attr('id', idName);
  newDiv.css('width', boundingBox.width);
  newDiv.css('height', boundingBox.height);
  newDiv.css('top', offset.top);
  newDiv.css('left', offset.left);
  newDiv.css('position', 'absolute');
  newDiv.css('z-index', 1000);
  newDiv.css('background-color', '#00FF00');
  newDiv.css('opacity', .4);
  $(document.body).append(newDiv);

  if (time) {
    setTimeout(function() {
      dehighlightNode(idName);
    }, 100);
  }

  return idName;
}

function dehighlightNode(id) {
  $('#' + id).remove();
}

/* Send an alert that will be displayed in the main panel */
function sendAlert(msg) {
  port.postMessage({type: 'alert', value: msg, state: recording});
}

/* Update the parameters for this scripts scope */
function updateParams(newParams) {
  var oldParams = params;
  params = newParams;

  var oldEvents = oldParams.events;
  var events = params.events;

  /* if we are listening to all events, then we don't need to do anything since
   * we should have already added listeners to all events at the very
   * beginning */
  if (params.record.listenToAllEvents)
    return;

  for (var eventType in events) {
    var listOfEvents = events[eventType];
    var oldListOfEvents = oldEvents[eventType];
    for (var e in listOfEvents) {
      if (listOfEvents[e] && !oldListOfEvents[e]) {
        log.log('[' + frameId + '] extension listening for ' + e);
        document.addEventListener(e, recordEvent, true);
      } else if (!listOfEvents[e] && oldListOfEvents[e]) {
        log.log('[' + frameId + '] extension stopped listening for ' + e);
        document.removeEventListener(e, recordEvent, true);
      }
    }
  }
}

var handlers = {
  'recording': function(v) {
    recording = v;
    console.log("recording: ", v);
    if (v === RecordState.RECORDING){
      /* handle any startup the addons need once a tab knows it's recording */
      for (var i = 0, ii = addonStartRecording.length; i < ii; ++i) {
        addonStartRecording[i]();
      }
    }
  },
  'params': updateParams,
  'dom': function(v) {
    simulate(v, 0);
  },
  'stop': function() {
    updateDeltas();
    resetRecord();
  },
  'reset': resetRecord,
  'pauseReplay': clearRetry,
  'url': function() {
    port.postMessage({type: 'url', value: document.URL, state: recording});
  },
  'promptResponse': promptResponse
};

/* Handle messages coming from the background page */
function handleMessage(request) {
  var type = request.type;

  log.log('[' + frameId + '] handle message:', request, type);

  var callback = handlers[type];
  if (callback) {
    callback(request.value);
  } else {
    log.error('cannot handle message:', request);
  }
}

/* Attach the event handlers to their respective events */
function addListenersForRecording() {
  var events = params.events;
  for (var eventType in events) {
    var listOfEvents = events[eventType];
    for (var e in listOfEvents) {
      listOfEvents[e] = true;
      document.addEventListener(e, recordEvent, true);
    }
  }
};

/* We need to add all the events now before and other event listners are
 * added to the page. We will remove the unwanted handlers once params is
 * updated */
addListenersForRecording();

/* need to check if we are in an iframe */
var value = {};
value.top = (self == top);
value.URL = document.URL;

/* Add all the other handlers */
chrome.runtime.sendMessage({type: 'getId', value: value}, function(resp) {
  log.log(resp);
  frameId = resp.value;
  port = new Port(frameId);
  port.addListener(handleMessage);

  // see if recording is going on
  port.postMessage({type: 'getParams', value: null, state: recording});
  port.postMessage({type: 'getRecording', value: null, state: recording});

  /* handle any startup the addons need */
  for (var i = 0, ii = addonStartup.length; i < ii; ++i) {
    addonStartup[i]();
  }
});

var pollUrlId = window.setInterval(function() {
  if (value.URL != document.URL) {
    var url = document.URL;
    value.URL = url;
    port.postMessage({type: 'url', value: url, state: recording});
    log.log('url change: ', url);
  }
}, 1000);

function injectScripts(paths) {
  function injectScript(index) {
    // inject code into the pages domain
    var s = document.createElement('script');
    s.src = chrome.extension.getURL(paths[index]);
    s.onload = function() {
      this.parentNode.removeChild(this);
      if (index + 1 < paths.length)
        injectScript(index + 1);
    };
    (document.head || document.documentElement).appendChild(s);
  }
  injectScript(0);
}

// TODO(sbarman): need to wrap these so variables don't escape into the
// enclosing scope
//injectScripts(["scripts/lib/record-replay/common_params.js", 
//               "scripts/lib/record-replay/content_dom.js",
//               "scripts/lib/record-replay/content_injected.js"]);
