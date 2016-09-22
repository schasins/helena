/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set shiftwidth=2 tabstop=2 autoindent cindent expandtab: */

'use strict';

var SimpleRecord = (function SimpleRecordClosure() {
  function SimpleRecord() {
    // do nothing
  }

  SimpleRecord.prototype = {
    startRecording: function _startRecording() {
      controller.reset();
      controller.start();
    },
    stopRecording: function _stopRecording() {
      controller.stop();
      return record.getEvents();
    },
    /* Replay a trace of events
     *
     * @param {array} trace - An array of events to replay
     * @param {object} config - Config for the trace. Currently accepts the following keys:
     *   frameMapping, tabMapping
     * @param {function} callback - callback function which should accept the replay object
     * @param {object} optionalCallbacks - callback functions we'll call if particular
     *   errors arise.  Currently accepts the following keys: portFailure.  Notte that
     *   error conts should accept a continuation as first argument, for resuming replay
     *   once the issue has been resolved according to top-level tools' preferences.
     */
     replay: function _replay(trace, config, callback, optionalCallbacks) {
      if (optionalCallbacks === undefined) {optionalCallbacks = {};}
      controller.replayScript(trace, config, callback, optionalCallbacks);
    },
    stopReplay: function _stopReplay() {
      controller.stopReplay();
    }
  };

  return new SimpleRecord();
})();
