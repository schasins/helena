/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set shiftwidth=2 tabstop=2 autoindent cindent expandtab: */

'use strict';

/*
 * During replay, DOM events raised by the extension are not faithfully 
 * reproduced in the page's Javascript scope due to the same origin policy.
 * To get around this, we can inject code into the page's scope which
 * communicates with the extension to update the event object.
 *
 * This is required to get key events working on some pages.
 */

(function() {

  /* event we are waiting for */
  var scriptEvent = null;

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

  /* These are the only properties we will update */
  var whiteListProps = {
    relatedTarget: true,
    keyCode: true,
    charCode: true,
    offsetY: true,
    offsetX: true,
    layerX: true,
    layerY: true
  };

  /* check if the event handler object is correct */
  function checkEvent(event) {

    if (scriptEvent && event.type == scriptEvent.type) {
      console.log('[inject] found matching event: ', scriptEvent, event);

      for (var prop in scriptEvent) {
        try {
          var scriptData = scriptEvent[prop];
          var eventData = event[prop];

          if (scriptData != eventData) {
            console.log('[inject] fixing property: ', prop);
            if (prop in whiteListProps) {
              setEventProp(event, prop, scriptData);
            } else {
              console.log('[inject] prop not whitelisted');
            }
          }
        } catch (e) {
          recordLog.error('[' + id + '] error recording property:', prop, e);
        }
      }

      scriptEvent = null;
    }

    // TODO: special case with mouseover, need to return false
    return true;
  };

  /* Attach the event handlers to their respective events */
  function addListenersForRecording() {
    var events = params.events;
    for (var eventType in events) {
      var listOfEvents = events[eventType];
      for (var e in listOfEvents) {
        if (listOfEvents[e])
          document.addEventListener(e, checkEvent, true);
      }
    }
  };
  addListenersForRecording();

  /* event handler for messages from the content script */
  function contentScriptUpdate(request) {
    scriptEvent = request.detail;

    var relatedTarget = scriptEvent.relatedTarget;
    if (relatedTarget)
      scriptEvent.relatedTarget = simpleXPathToNode(relatedTarget);

    console.log('[inject] handle message:', scriptEvent);
    return;
  }

  document.addEventListener('webscript', contentScriptUpdate, true);
})();
