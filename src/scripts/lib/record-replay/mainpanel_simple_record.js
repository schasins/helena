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
     */
     replay: function _replay(trace, config, callback) {
      controller.replayScript(trace, config, callback);
    },
    stopReplay: function _stopReplay() {
      controller.stopReplay();
    }
  };

  return new SimpleRecord();
})();
