/**
 * Coordinates the model (Record, Replay, User) and view (Panel).
 */

/*
var Controller = (function ControllerClosure() {
  var ctlLog = Logs.getLog('controller');

  function Controller(record, replay, scriptServer, ports) {
    this.record = record;
    this.replay = replay;
    this.scriptServer = scriptServer;
    this.ports = ports;
    this.listeners = [];
  }

  Controller.prototype = {
    // The user started recording
    start: function() {
      ctlLog.log('start');
      this.record.startRecording();

      // Update the UI
      chrome.browserAction.setBadgeBackgroundColor({color: [255, 0, 0, 64]});
      // chrome.browserAction.setBadgeText({text: 'ON'});
    },
    stop: function() {
      ctlLog.log('stop');
      this.record.stopRecording();

      // Update the UI 
      chrome.browserAction.setBadgeBackgroundColor({color: [0, 0, 0, 0]});
      // chrome.browserAction.setBadgeText({text: 'OFF'});
    },
    reset: function() {
    },
    replayRecording: function _replayRecording(config, cont, errorConts) {
      if (errorConts === undefined) {errorConts = {};}
      ctlLog.log('replay');
      this.stop();

      var record = this.record;
      var events = record.getEvents();
      
      if (!config)
        config = {};

      if (!config.scriptId)
        config.scriptId = record.getScriptId();

      this.replay.replay(record.getEvents(), config, cont, errorConts);
      return replay;
    },
    replayScript: function(events, config, cont, errorConts) {
      if (errorConts === undefined) {errorConts = {};}
      this.setEvents(null, events);
      return this.replayRecording(config, cont, errorConts);
    },
    stopReplay: function(){
      this.replay.stopReplay();
    },
    pause: function() {
      this.replay.pause();
    },
    restart: function() {
      this.replay.restart();
    },
    skip: function() {
      this.replay.skip();
    },
    resend: function() {
      this.replay.resend();
    },
    replayOne: function() {
      this.replay.replayOne();
    },
    loop: function(eventIds) {
      this.record.addLoop(eventIds);
    },
    next: function(eventIds) {
      this.record.addNextLoop(eventIds);
    },
    saveScript: function(name) {
      ctlLog.log('saving script');
      var events = this.record.getEvents();
      this.scriptServer.saveScript(name, events, null, "");
    },
    getScript: function(name) {
      ctlLog.log('getting script');
      var controller = this;
      this.scriptServer.getScript(name,
          function(script) {
            controller.setEvents(script.id, script.events);
          });
    },
    setEvents: function(scriptId, events) {
      this.record.setEvents(events);
      this.record.setScriptId(scriptId);
    },
    updateParams: function _updateParams() {
      this.ports.sendToAll({type: 'params', value: params});
    },
    addListener: function _addListener(callback) {
      this.listeners.push(callback);
      this.record.addListener(callback);
      this.replay.addListener(callback);
    },
    updateListeners: function _updateListeners(msg) {
      var listeners = this.listeners;
      for (var i = 0, ii = listeners.length; i < ii; ++i) {
        listeners[i](msg);
      }
    },
//    submitInput: function _submitInput(text) {
//      ctlLog.log(text);
//    },
    userUpdate: function _userUpdate(eventId, field, value) {
      ctlLog.log('update:', eventId, field, value);
      this.record.userUpdate(eventId, field, value);
    }
  };

  return Controller;
})();
*/
