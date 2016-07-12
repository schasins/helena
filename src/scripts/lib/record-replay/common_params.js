/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set shiftwidth=2 tabstop=2 autoindent cindent expandtab: */

'use strict';

var params = null;
var defaultParams = null; /* supposed to be read-only copy of parameters */

/* Compensation actions scheme, should be used when element properties differ
 * between record and replay executions */
var CompensationAction = {
  NONE: 'none',
  FORCED: 'forced'
};

/* Strategy to apply when an exeception is thrown because of a disconnected
 * port */ 
var BrokenPortStrategy = {
  RETRY: 'retry',
  SKIP: 'skip'
};

/* Strategy for how much time should be spent between events */
var TimingStrategy = {
  MIMIC: 'mimic',
  SPEED: 'speed',
  SLOWER: 'slower',
  SLOWEST: 'slower',
  FIXED_1: 'fixed_1',
  RANDOM_0_3: 'random_0_3',
  PERTURB_0_3: 'perturb_0_3',
  PERTURB: 'purterb'
};

/* Strategy for action to take after a timeout */
var TimeoutStrategy = {
  ERROR: 'error',
  SKIP: 'skip'
};

(function() {
  /* List of all events and whether or not we should capture them */
  var events = {
    'Event': {
      // 'abort': true,
      'change': true,  /* change event occurs before focus is lost (blur) */
      'copy': true,
      'cut': true,
      'error': false,
      'input': true,  /* input event occurs on each keystroke (or cut/paste) */
      'load': false,
      'paste': true,
      'reset': true,
      'resize': false,
      'scroll': false,
      'select': true,
      'submit': true,
      'unload': false
    },
    'FocusEvent': {
      'focus': true,
      'blur': true
    },
    'MouseEvent': {
      'click': true,
      'dblclick': true,
      'mousedown': true,
      'mousemove': false,
      'mouseout': false,
      'mouseover': false,
      'mouseup': true,
      'mousewheel': false
      // 'dragenter': false,
      // 'dragleave': false,
    },
    'KeyboardEvent': {
      'keydown': true,
      'keyup': true,
      'keypress': true
    },
    'TextEvent': {
      'textInput': true  // similar to input event, doesn trigger with cp/pst
    }
  };

  var defaultProps = {
    'Event': {
      'type': true,
      'bubbles': true,
      'cancelable': true,
      'timeStamp': 0
    },
    'FocusEvent': {
      'type': true,
      'bubbles': true,
      'cancelable': true,
      'detail': 0,
      'timeStamp': 0
    },
    'MouseEvent': {
      'type': true,
      'bubbles': true,
      'cancelable': true,
      'detail': 0,
      'screenX': 0,
      'screenY': 0,
      'clientX': 0,
      'clientY': 0,
      'ctrlKey': false,
      'altKey': false,
      'shiftKey': false,
      'metaKey': false,
      'button': 0,
      'timeStamp': 0
    },
    'KeyboardEvent': {
      'type': true,
      'bubbles': true,
      'cancelable': true,
      'ctrlKey': false,
      'altKey': false,
      'shiftKey': false,
      'metaKey': false,
      'keyCode': 0,
      'charCode': 0,
      'timeStamp': 0,
      'keyIdentifier': '',  /* nonstandard to Chrome */
      'keyLocation': 0  /* nonstandard to Chrome */
    },
    'TextEvent': {
      'type': true,
      'bubbles': true,
      'cancelable': true,
      'data': '',
      'inputMethod': 0,
      'locale': '',
      'timeStamp': 0
    }
  };

  var ctrlOnlyEvents = ["mouseover"];

  /* There are a lot of random parameters, too many for comments. Best way to
   * figure out what a parameter does, is to grep for that parameter in the
   * source code. */
  defaultParams = {
    events: events,
    ctrlOnlyEvents: ctrlOnlyEvents,
    defaultProps: defaultProps,
    panel: {
      enableEdit: true,
      enableRequest: true
    },
    logging: {
      level: 0,
      enabled: 'all',
      print: true,
      saved: true
    },
    compensation: {
      enabled: true,
      omittedProps: ['innerHTML', 'outerHTML', 'innerText', 'outerText',
          'textContent', 'className', 'childElementCount', 'scrollHeight',
          'scrollWidth', 'clientHeight', 'clientWidth', 'clientTop',
          'clientLeft', 'offsetHeight', 'offsetWidth', 'offsetTop',
          'offsetLeft', 'text', 'valueAsNumber', 'id', 'class', 'xpath', 
          'baseURI'],
    },
    record: {
      recordAllEventProps: true,
      cancelUnrecordedEvents: false,
      listenToAllEvents: false
    },
    replay: {
      openNewTab: true,
      saveReplay: false,
      cancelUnknownEvents: false,
      skipCascadingEvents: true,
      eventTimeout: null,
      targetTimeout: 15,
      compensation: CompensationAction.FORCED,
      timingStrategy: TimingStrategy.MIMIC,
      defaultWait: 100,
      defaultWaitNewTab: 4000,
      defaultWaitNextEvent: 4000,
      captureWait: 0,
      highlightTarget: true,
      brokenPortStrategy: BrokenPortStrategy.RETRY,
      atomic: true,
      cascadeCheck: true,
      urlSimilarity: 0.8,
      defaultUser: false
    },
    capture: {
      saveCaptureLocal: true,
    },
    server: {
      // url: 'http://sbarman.webfactional.com/api/',
      url: 'http://127.0.0.1:8000/api/',
      user: 'sbarman',
    },
  };

  if (window.jQuery)
    params = jQuery.extend(true, {}, defaultParams);
  else
    params = defaultParams;

})();
