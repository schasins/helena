/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set shiftwidth=2 tabstop=2 autoindent cindent expandtab: */

'use strict';

/* Store mappings between ports, tabs, iframes, etc */
var PortManager = (function PortManagerClosure() {
  var portLog = getLog('ports');

  function PortManager() {
    this.numPorts = 0;
    this.portIdToPort = {};
    this.portIdToTabId = {};
    this.portIdToPortInfo = {};
    this.portIdToWindowId = {};
    this.tabIdToPortIds = {};
    this.tabIdToTabInfo = {};
    this.tabIdToTab = {};
    this.tabIdToWindowId = {};
  }

  PortManager.prototype = {
    /* Send a message to all content scripts. Messages should be in the form
     * {type: ..., value: ...} */
    sendToAll: function _sendToAll(message) {
      portLog.log('sending to all:', message);
      var ports = this.portIdToPort;
      for (var portId in ports) {
        ports[portId].postMessage(message);
      }
    },
    getTabId: function _getTabId(portId) {
      return this.portIdToTabId[portId];
    },
    getWindowId: function _getTabId(portId) {
      return this.portIdToWindowId[portId];
    },
    getTabInfo: function _getTabInfo(tabId) {
      var tabInfo = this.tabIdToTabInfo[tabId];
      if (!tabInfo)
        return null;

      var ret = {};
      ret.frames = tabInfo.frames;

      /* we store all the top frames, so just return the last frame */
      var topFrames = tabInfo.top;
      if (topFrames.length > 0)
        ret.top = topFrames[topFrames.length - 1];

      return ret;
    },
    getTabFromTabId: function _getTabFromTabId(tabId) {
      return this.tabIdToTab[tabId];
    },
    getPort: function _getPort(portId) {
      return this.portIdToPort[portId];
    },
    updateUrl: function _updateUrl(port, url) {
      this.portIdToPortInfo[port.name].URL = url;
    },
    removeTab: function _removeTab(tabId) {
      var portIds = this.tabIdToPortIds[tabId];
      for (var i = 0; i < portIds.length; i++){
        this.removePort(portIds[i]);
      }
      delete this.tabIdToPortIds[tabId];
      delete this.tabIdToTab[tabId];
      delete this.tabIdToTabInfo[tabId];
    },
    removePort: function _removePort(portId) {
      delete this.portIdToPort[portId];
      delete this.portIdToPortInfo[portId];
      delete this.portIdToTabId[portId];
      delete this.portIdToWindowId[portId];
    },
    updateRemovedTabs: function _updateRemovedTabs(openTabs) {
      var possiblyOpenTabs = {};
      for (var tabId in this.tabIdToTab) {
        possiblyOpenTabs[tabId] = false;
      }

      for (var i = 0, ii = openTabs.length; i < ii; ++i) {
        possiblyOpenTabs[openTabs[i].id] = true;
      }

      for (var tabId in possiblyOpenTabs)
        if (!possiblyOpenTabs[tabId])
          this.removeTab(tabId);
    },
    getNewId: function _getNewId(value, sender) {
      /* for some reason, the start page loads the content script but doesn't
       * have a tab id. in this case, don't assign an id */
      //console.log("getNewId", value, sender);
      if (!sender.tab) {
        portLog.warn('request for new id without a tab id');
        return;
      }

      var windowId = sender.tab.windowId;

      /* bug with listening to removed tabs, so lets actually check which
       * tabs are open and then update our list appropriately */
      var ports = this;
      chrome.tabs.query({}, function(openTabs) {
        ports.updateRemovedTabs(openTabs);
      });

      this.numPorts++;
      var portId = '' + this.numPorts;

      portLog.log('adding new id: ', portId, value);

      /* Update various mappings */
      var tabId = sender.tab.id;
      this.tabIdToTab[tabId] = sender.tab;
      this.tabIdToWindowId[tabId] = windowId;
      portLog.log('adding tab:', tabId, sender.tab);

      this.portIdToTabId[portId] = tabId;
      this.portIdToPortInfo[portId] = value;
      value.portId = portId;
      this.portIdToWindowId[portId] = windowId;

      var portIds = this.tabIdToPortIds[tabId];
      if (!portIds) {
        portIds = [];
        this.tabIdToPortIds[tabId] = portIds;
      }
      portIds.push(portId);

      var tabInfo = this.tabIdToTabInfo[tabId];
      if (!tabInfo) {
        tabInfo = {top: [], frames: []};
        this.tabIdToTabInfo[tabId] = tabInfo;
      }
      if (value.top) {
        tabInfo.top.push(value);
        //console.log("this.tabIdToTabInfo, added top frame: ", this.tabIdToTabInfo);
      } else {
        //console.log("this.tabIdToTabInfo, added non-top frame: ", this.tabIdToTabInfo);
        tabInfo.frames.push(value);
      }
      return portId;
    },
    connectPort: function _connectPort(port) {
      var portId = port.name;
      var ports = this.portIdToPort;

      ports[portId] = port;

      port.addMessageListener(function(msg) {
        handleMessage(port, msg);
      });

      var portManager = this;
      port.addDisconnectListener(function(evt) {
        portLog.log('Disconnect port:', port);

        if (portId in ports) {
          delete ports[portId];
        } else {
          throw "Can't find port";
        }

        var portInfo = portManager.portIdToPortInfo[portId];
        var tabId = portManager.portIdToTabId[portId];
        var tabInfo = portManager.tabIdToTabInfo[tabId];

        var frames;
        if (tabInfo) {
          if (portInfo.top)
            var frames = tabInfo.top;
          else
            var frames = tabInfo.frames;

          for (var i = 0, ii = frames.length; i < ii; ++i) {
            if (frames[i].portId == portId) {
              frames.splice(i, 1);
              break;
            }
          }
        } else {
          portLog.log('Cannot find information about tab:', tabId, tabInfo);
        }
      });
    }
  };

  return PortManager;
})();

/* Handles recording of events from the content scripts */
var Record = (function RecordClosure() {
  var recordLog = getLog('record');

  function Record(ports) {
    this.ports = ports;
    this.listeners = [];

    this.reset();
  }

  Record.prototype = {
    reset: function _reset() {
      this.updateStatus(RecordState.STOPPED);
      this.scriptId = null;
      this.events = [];
      /* the time the last event was recorded */
      this.lastTime = 0;

      this.updateListeners({type: 'reset', value: null});
      this.ports.sendToAll({type: 'reset', value: null});
    },
    /* Messages should be in the form {type:..., value:...} */
    addListener: function _addListener(callback) {
      this.listeners.push(callback);
    },
    updateListeners: function _updateListeners(msg) {
      var listeners = this.listeners;
      for (var i = 0, ii = listeners.length; i < ii; ++i) {
        listeners[i](msg);
      }
    },
    getStatus: function _getStatus() {
      return this.recordState;
    },
    updateStatus: function _updateStatus(newStatus) {
      this.recordState = newStatus;
      this.updateListeners({type: 'status', value: 'record:' + newStatus});
      this.ports.sendToAll({type: 'recording', value: newStatus});
    },
    /* Begin recording events.
     *
     * @param {boolean} replaying Whether we are recording a user's
     *     interactions or the events raised by the replayer. 
     */
    startRecording: function _startRecording(replaying) {
      recordLog.log('starting record');
      var s = replaying ? RecordState.REPLAYING : RecordState.RECORDING;
      this.updateStatus(s);

      /* Tell the content scripts to begin recording */
      this.ports.sendToAll({type: 'recording', value: this.getStatus()});
    },
    stopRecording: function _stopRecording() {
      recordLog.log('stopping record');
      this.updateStatus(RecordState.STOPPED);

      /* Tell the content scripts to stop recording */
      this.ports.sendToAll({type: 'stop', value: null});
      this.ports.sendToAll({type: 'recording', value: this.getStatus()});
    },
    /* Add the event to be recorded
     *
     * @param {object} eventRequest Details of about the saved event
     * @param {string} portId Optional name of the port for the event
     * @param {index} index Index where put the event. Defaults to the end of
     *     the event array if undefined
     *
     * @returns {string} Id assigned to the event
     */
    addEvent: function _addEvent(e, portId, index) {
      recordLog.log('added event:', e, portId);

      /* Check if the event is coming from a content script */
      if (portId) {
        var ports = this.ports;
        var tab = ports.getTabId(portId);
        var win = ports.getWindowId(portId);
        var tabInfo = ports.getTabInfo(tab);
        // TODO: this is broken, maybe
        var topURL = tabInfo.top.URL;

        var iframeIndex = -1;
        var topFrame = (tabInfo.top.portId == portId);

        if (topFrame) {
          var topFrame = true;
        } else {
          var topFrame = false;
          var frames = tabInfo.frames;
          for (var i = 0, ii = frames.length; i < ii; ++i) {
            var frame = frames[i];
            if (frame.portId == portId) {
              iframeIndex = i;
              break;
            }
          }
        }

        e.frame.port = portId;
        e.frame.topURL = topURL;
        e.frame.topFrame = topFrame;
        e.frame.iframeIndex = iframeIndex;
        e.frame.tab = tab;
        e.frame.windowId = win;
      }

      /* Save timing info */
      var time = e.data.timeStamp;
      var lastTime = this.lastTime;
      if (lastTime == 0) {
        var waitTime = 0;
      } else {
        var waitTime = time - lastTime; // the time to wait between running the last event and running this one.
      }
      if (!('timing' in e))
        e.timing = {};
      e.timing.waitTime = waitTime;
      this.lastTime = time;

      /* Give this event an unique id */
      var events = this.events;
      if (!('meta' in e))
        e.meta = {};
      e.meta.id = 'event' + events.length;

      if (typeof index == 'undefined') {
        this.events.push(e);
        this.updateListeners({type: 'event', value: {event: e}});
      } else {
        this.events.splice(index, 0, e);
        this.updateListeners({type: 'event', 
            value: {event: e, index: index}});
      }
      return e.meta.id;
    },
    /* Update the properties of an event. @link{eventRequest} should contain the
     * pageEventId so that the event can be matched.
     *
     * @param {object} eventRequest Updates to be made and meta data used to 
     *     identify event
     * @param {string} portId Id of port which requests came through
     */
    updateEvent: function _updateEvent(request, portId) {
      var pageEventId = request.pageEventId;
      var updates = request.updates;

      recordLog.log('updating event:', updates, pageEventId);

      var events = this.events;

      for (var i = events.length - 1; i >= 0; --i) {
        var value = events[i];
        /* Check if its the right event */
        if (value.frame && value.frame.port == portId &&
            value.meta && value.meta.pageEventId == pageEventId) {
          var id = value.meta.id;
          for (var i = 0, ii = updates.length; i < ii; ++i) {
            var u = updates[i];
            this.userUpdate(id, u.field, u.value); 
          }
          break;
        }
      }
    },
    /* Finds the event based upon the eventId and updates the event's 
     * @link{field} to @link{newVal}. */
    userUpdate: function _userUpdate(eventId, field, newVal) {
      function updateProp(obj, path, i) {
        if (i == path.length - 1)
          obj[path[i]] = newVal;
        else
          updateProp(obj[path[i]], path, i + 1);
      }

      var events = this.events;
      for (var i = events.length - 1; i >= 0; --i) {
        var value = events[i];
        if (value.meta.id == eventId) {
          updateProp(value, field.split('.'), 0);
        }
      }
    },
    /* Create a copy of the events recorded */
    getEvents: function _getEvents() {
      return jQuery.extend(true, [], this.events);
    },
    /* Set the recorded events */
    setEvents: function _setEvents(events) {
      this.reset();
      this.events = events;
      for (var i = 0, ii = events.length; i < ii; ++i) {
        this.updateListeners({type: 'event', value: {event: events[i]}});
      }
    },
    setScriptId: function _setScriptId(id) {
      this.scriptId = id;
    },
    getScriptId: function _getScriptId() {
      return this.scriptId;
    },
    getEvent: function _getEvent(eventId) {
      var events = this.events;
      if (!events)
        return null;

      for (var i = 0, ii = events.length; i < ii; ++i) {
        var e = events[i];
        if (e.value.meta.id == eventId)
          return e;
      }
      return null;
    }
  };

  return Record;
})();

/* Handles replaying scripts */
var Replay = (function ReplayClosure() {
  var replayLog = getLog('replay');

  function Replay(ports, scriptServer, user) {
    this.ports = ports;
    this.scriptServer = scriptServer;
    /* The user interface to interact with the replayer */
    this.user = user;
    this.record = new Record(ports);
    this.listeners = [];

    this.reset();
  }

  /* Used to validate the user's response */
  function yesNoCheck(response) {
    if (response == 'yes' || response == 'y')
      return 'yes';
    else if (response == 'no' || response == 'n')
      return 'no';

    return null;
  }

  Replay.prototype = {
    replayableEvents: {
      dom: 'simulateDomEvent',
      completed: 'simulateCompletedEvent'
    },
    addonReset: [],
    addonTiming: [],
    matchedCompletedEvents: [],
    currentPortMappingFailures: 0, // we'll use this to see if we're failing to find a port for a given event too many times
    reset: function _reset() {
      /* execution proceeds as callbacks so that the page's JS can execute, this
       * is the handle to the current callback */
      this.callbackHandle = null;
      this.replayState = this.updateStatus(ReplayState.STOPPED);
      /* record the first execution attempt of the first event */
      this.timeoutInfo = {startTime: 0, index: -1};
      /* stores responses from the content script */
      this.ack = null;
      /* list of events */
      this.events = [];
      /* current event index */
      this.index = 0;
      /* maps between the record and replay time ports and tabs */
      this.portMapping = {};
      this.tabMapping = {};
      /* used to link the replayed events with the original recording */
      this.scriptId = null;
      /* callback executed after replay has finished */
      this.cont = null;
      this.firstEventReplayed = false;
      this.startTime = 0;

      // useful for helping us figure out whether a completed event has happened or not;
      this.matchedCompletedEvents = [];

      /* Call the resets for the addons */
      var addonReset = this.addonReset;
      for (var i = 0, ii = addonReset.length; i < ii; ++i)
        addonReset[i].call(this);

      this.record.reset();
    },
    /* Messages should be in the form {type:..., value:...} */
    addListener: function _addListener(callback) {
      this.listeners.push(callback);
    },
    updateListeners: function _updateListeners(msg) {
      var listeners = this.listeners;
      for (var i = 0, ii = listeners.length; i < ii; ++i) {
        listeners[i](msg);
      }
    },
    updateStatus: function _updateStatus(newStatus) {
      this.replayState = newStatus;
      this.updateListeners({type: 'status', value: 'replay:' + newStatus});
    },
    /* Begin replaying a list of events.
     *
     * @param {array} events List of events
     * @param {string} scriptId Id of the original recording
     * @param {function} cont Callback thats executed after replay is finished
     * @param {object} errorConts map from errors to callbacks that should be executed for those errors
     */
    replay: function _replay(events, config, cont, errorConts) {
      if (errorConts === undefined) {errorConts = {};}
      replayLog.log('starting replay');

      /* Pause and reset and previous executions */
      this.pause();
      this.reset();

      /* Record start time for debugging */
      this.startTime = new Date().getTime();
      /* If these events were already replayed, we may need to reset them */
      this.events = events;
      for (var i = 0, ii = events.length; i < ii; ++i)
        this.resetEvent(events[i]);

      if (config) {
        if (config.scriptId)
          this.scriptId = condif.scriptId;
        
        if (config.frameMapping) {
          var frameMapping = config.frameMapping;
          var portMapping = this.portMapping;
          var ports = this.ports;
          for (var k in frameMapping)
            portMapping[k] = ports.getPort(frameMapping[k]);
        }
        if (config.tabMapping) {
          var tabMapping = config.tabMapping;
          var tm = this.tabMapping;
          for (var k in tabMapping)
            tm[k] = tabMapping[k];
        }
        if (config.targetWindowId) {
          this.targetWindowId = config.targetWindowId;
        }
      }

      this.cont = cont;
      this.errorConts = errorConts;
      this.updateStatus(ReplayState.REPLAYING);

      this.record.startRecording(true);
      this.setNextTimeout(0);
    },
    /* Replay a different set of events as a subexecution. This requires 
     * saving the context of the current execution and resetting it once
     * the execution is finished.
     *
     * @param {array} events List of events to replay
     * @param {string} scriptId Id of script
     * @param {object} tabMapping Initial tab mapping
     * @param {object} portMapping Initial port mapping
     * @param {function} check Callback after subreplay is finished. The replay
     *     is passed in as an argument.
     * @param {function} cont Callback after subreplay is finished and 
     *     replayer's state is reset to original.
     * @param {number} timeout Optional argument specifying a timeout for the
     *     subreplay.
     */
    subReplay: function _subReplay(events, scriptId, tabMapping, portMapping,
                                   check, cont, timeout) {
      /* copy the properties of the replayer (so they can be later reset) */
      var props = Object.keys(this);
      var copy = {};
      for (var i = 0, ii = props.length; i < ii; ++i) {
        var prop = props[i];
        copy[prop] = this[prop];
      }

      /* replay the events */
      var replay = this;
      this.replay(events, {scriptId: scriptId}, function(r) {
        if (timeout) {
          clearTimeout(timeoutId);
        }
        check(r);

        this.reset();
        for (var key in copy) {
          replay[key] = copy[key];
        }

        this.updateStatus(ReplayState.REPLAYING);
        this.record.startRecording(true);

        cont(r);
      });

      /* set the mappings */
      this.tabMapping = tabMapping;
      this.portMapping = portMapping;

      if (timeout) {
        var timeoutId = setTimeout(function() {
          replay.finish();
        }, timeout);
      }
    },
    /* Get an event object based upon its id */
    getEvent: function _getEvent(eventId) {
      var events = this.events;
      if (!events)
        return null;

      for (var i = 0, ii = events.length; i < ii; ++i) {
        var e = events[i];
        if (e.meta.id == eventId)
          return e;
      }
      return null;
    },
    getStatus: function _getStatus() {
      return this.replayState;
    },
    /* Increase the index and update the listeners */
    incrementIndex: function _incrementIndex() {
      this.index += 1;

      var index = this.index;
      var events = this.events;
      if (index < events.length) {
        var e = events[index];
        if (e.meta)
          this.updateListeners({type: 'simulate', value: e.meta.id});
      }
    },
    /* Return the index of the next event that should be replayed */ 
    getNextReplayableEventIndex: function _getNextReplayableEventIndex() {
      var index = this.index;
      var events = this.events;
      var replayableEvents = this.replayableEvents;

      for (var i = index, ii = events.length; i < ii; ++i) {
        var v = events[i].type;
        if (events[i].type in replayableEvents)
          return i;
      }
      return events.length;
    },
    /* Return the time in the future the next replayable event should be
     * executed based upon the current timing strategy. */
    getNextTime: function _getNextTime() {
      var time;
      /*  */
      var addonTiming = this.addonTiming;
      for (var i = 0, ii = addonTiming.length; i < ii; ++i) {
        time = addonTiming[i].call(this);
        if (typeof time == 'number')
          return time;
      }

      var timing = params.replay.timingStrategy;

      var curIndex = this.index;
      var nextIndex = this.getNextReplayableEventIndex();
      var events = this.events;
      var waitTime = 0;

      /* Check if there are any events to replay */
      if (nextIndex >= events.length)
        return 0;
      if (curIndex == 0)
        return 0; // note: this used to be 1,000.  not sure why.  may need to look into this at some point.

      var defaultTime = 0;
      for (var i = curIndex; i <= nextIndex; ++i){
        var timeToAdd = events[i].timing.waitTime;
        if (events[i].timing.ignoreWait && timeToAdd > 5){
          timeToAdd = timeToAdd / 5;
        }
        defaultTime += timeToAdd; 
      }

      if (defaultTime > 10000)
        defaultTime = 10000;

      if (timing == TimingStrategy.MIMIC) {
        waitTime = defaultTime;
      } else if (timing == TimingStrategy.SPEED) {
        waitTime = 0;
      } else if (timing == TimingStrategy.SLOWER) {
        waitTime = defaultTime * 2;
      } else if (timing == TimingStrategy.SLOWEST) {
        waitTime = defaultTime * 4;
      } else if (timing == TimingStrategy.FIXED_1) {
        waitTime = 1000;
      } else if (timing == TimingStrategy.RANDOM_0_3) {
        waitTime = Math.round(Math.random() * 3000);
      } else if (timing == TimingStrategy.PERTURB_0_3) {
        waitTime = defaultTime + Math.round(Math.random() * 3000);
      } else if (timing == TimingStrategy.PERTURB) {
        var scale = 0.7 + (Math.random() * 0.6);
        waitTime = Math.round(defaultTime * scale);
      } else {
        throw 'unknown timing strategy';
      }
      replayLog.log('wait time:', waitTime);
      return waitTime;
    },
    /* Set the callback to replay the next event
     *
     * @param {number} time Optional delay when callback should be executed. The
     *     default will use whatever strategy is set in the parameters.
    */
    setNextTimeout: function _setNextTimeout(time) {
      if (this.callbackHandle){
        clearTimeout(this.callbackHandle); // we'll always choose the next time to run based on the most recent setNextTimeout, so clear out whatever might already be there 
      }
      if (typeof time == 'undefined')
        time = this.getNextTime();

      var replay = this;
      this.callbackHandle = setTimeout(function() {
        replay.guts();
      }, time);
    },
    /* Pause the execution by clearing out the callback */
    pause: function _pause() {
      var handle = this.callbackHandle;
      if (handle) {
        clearTimeout(handle);
        this.callbackHandle = null;
      }

      /* tell whatever page was trying to execute the last event to pause */
      this.ports.sendToAll({type: 'pauseReplay', value: null});
    },
    stopReplay: function _stopReplay() {
      if (this.getStatus() == ReplayState.STOPPED)
        return;

      this.updateStatus(ReplayState.STOPPED);

      this.pause();
    },
    /* Restart by setting the next callback immediately */
    restart: function _restart() {
      if (this.callbackHandle == null) {
        if (this.getStatus() == ReplayState.ACK) {
          this.updateStatus(ReplayState.REPLAYING);
        }

        this.setNextTimeout(0);
      }
    },
    replayOne: function _replayOne() {
//      this.updateStatus(ReplayState.REPLAYING);
//      this.restart();
    },
    skip: function _skip() {
      this.incrementIndex();
      this.updateStatus(ReplayState.REPLAYING);
    },
    resend: function _resend() {
      if (this.getStatus() == ReplayState.ACK)
        this.updateStatus(ReplayState.REPLAYING);
    },
    /* Replay has finished, and now we need to call the continuation */
    finish: function _finish(errorMsg) {
      replayLog.log('finishing replay');

      if (this.getStatus() == ReplayState.STOPPED)
        return;

      this.updateStatus(ReplayState.STOPPED);

      this.pause();
      this.time = new Date().getTime() - this.startTime;
      this.record.stopRecording();

      var record = this.record;
      var replay = this;

      /* save the recorded replay execution */
      var scriptServer = this.scriptServer;
      setTimeout(function() {
        var replayEvents = record.getEvents();
        var scriptId = replay.scriptId;

        if (params.replay.saveReplay && scriptId &&
            replayEvents.length > 0) {
          scriptServer.saveScript('replay ' + scriptId, replayEvents, scriptId, "");
          replayLog.log('saving replay:', replayEvents);
        }
      }, 1000);

      if (this.cont) {
        var replay = this;
        setTimeout(function() {
          replay.cont(replay);
        }, 0);
      }
    },
    /* Given an event, find the corresponding port */
    getMatchingPort: function _getMatchingPort(v) {
      var gpmdebug = true;
      // if (gpmdebug) {console.log("gpm: _getMatchingPort: ",v);}
      var portMapping = this.portMapping;
      var tabMapping = this.tabMapping;

      var frame = v.frame;
      var port = frame.port;
      var tab = frame.tab;

      /* lets find the corresponding port */
      var replayPort = null;
      /* we have already seen this port, reuse existing mapping */
      if (port in portMapping) {
        replayPort = portMapping[port];
        //if (gpmdebug) {console.log("gpm: port in portMapping", portMapping);}
        replayLog.log('port already seen', replayPort);

      /* we have already seen this tab, find equivalent port for tab
       * for now we will just choose the last port added from this tab */
      } else if (tab in tabMapping) {
        var replayPort = this.findPortInTab(tabMapping[tab], frame); // todo: woah, just grabbing the last port from the tab doesn't seem ok
        if (gpmdebug) {console.log("gpm: tab in tabMapping", tabMapping);}

        if (replayPort) {
          portMapping[port] = replayPort;
          if (gpmdebug) {console.log('gpm: tab already seen, found port:', replayPort);}
        } else {
          this.setNextTimeout(params.replay.defaultWait);
          if (gpmdebug) {console.log('gpm: tab already seen, no port found');}
          // we can get into a loop here if (for example) we use a next button to try to get to the next page of a list
          // so we actually know the right tab because it's the same page where we had the list in the past
          // but if the network has gone down for a moment or something else went wrong during loading the next page
          // there would be no ports associated with the tab?
          
          // todo: this may be a place to do some kind of recovery by actually reloading the tab
        }
      /* nothing matched, so we need to open new tab */
      } else {
        var allTabs = Object.keys(this.ports.tabIdToTab);

        /* create list of all current tabs that are mapped to */
        var revMapping = {};
        for (var t in tabMapping) {
          revMapping[tabMapping[t]] = true;
        }

        /* find all tabs that exist, are in the target window, but are not mapped to */
        var unusedTabs = [];
        for (var i = 0, ii = allTabs.length; i < ii; ++i) {
          var tabId = allTabs[i];
          if (!revMapping[tabId])
            // now make sure it's actually in the target window, if there is one
            if (!this.targetWindowId || this.targetWindowId === this.ports.tabIdToWindowId[tabId]){
              unusedTabs.push(tabId);
            }
        }
        if (gpmdebug) {console.log("gpm: unusedTabs", unusedTabs, unusedTabs.length);}

        /* if this is not the first event, and there is exactly one unmapped
         * tab, then lets assume this new tab should match */
        if (unusedTabs.length == 1) { // if 2, one is our initial tab that explains the recording process, and the other must be the tab we want
          tabMapping[frame.tab] = unusedTabs[0]; // go ahead and make a mapping and then try going through the whole process again
          if (gpmdebug) {console.log("gpm: adding one unmatched tab mapping update");}
          this.setNextTimeout(0);
          if (gpmdebug) {console.log("Exactly one unmapped.");}
          return;
        }

        // todo: ensure commenting out the below is acceptable.  for now relying on completed events marked forceReplay to make sure we load everything that doesn't get loaded by dom events

        /* create a new tab, and update the mapping */
        /*
        var replay = this;
        var openNewTab = function() {
          replayLog.log('need to open new tab');
          chrome.tabs.create({url: frame.topURL, active: true},
            function(newTab) {
              replayLog.log('new tab opened:', newTab);
              var newTabId = newTab.id;
              replay.tabMapping[frame.tab] = newTabId;
              replay.ports.tabIdToTab[newTabId] = newTab;
              replay.setNextTimeout(params.replay.defaultWaitNewTab);
            }
          );
        };
        */

        /* automatically open up a new tab for the first event */
        /*
        if (!this.firstEventReplayed && params.replay.openNewTab) {
          openNewTab();
        }
        */

        //High level goal here:
        //Check this.events against this.record.events for a load in the same position in the trace
        //we want to look back through this.events (the events to replay) for an event of type
        //'completed' that has the same frame as the one we're trying to replay to now
        //then look through this.record.events (the events we've actually seen) for a corresponding
        //'completed' event.  Whatever port that one had, use it.  And update the port mapping.
        //Basically we're using when tabs appear as a way to line them up, build the mapping.

        var recordTimeEvents = this.events;
        var replayTimeEventsSoFar = this.record.events;
        var currEventURL = v.frame.URL;
        var currEventTabID = v.frame.tab;
        var currEventIndex = this.index;

        var recordTimeCompletedEvents = _.filter(recordTimeEvents, function(ev){return ev.type === "completed";});
        var replayTimeCompletedEvents = _.filter(replayTimeEventsSoFar, function(ev){return ev.type === "completed";});
        //console.log("recordTimeCompletedEvents", recordTimeCompletedEvents);
        //console.log("replayTimeCompletedEvents", replayTimeCompletedEvents);

        // todo: sometimes it seems like doing this loading time thing gives us the wrong answer.  when that happens, may want to revisit it after a while, clear the tabMapping mappings that were made with this, if we keep looking for a port and failing...

        for (var i = currEventIndex-1; i >= 0; i--){
          var e = recordTimeEvents[i];
          var completedCounter = 0;
          if (e.type === "completed" && e.data.type === "main_frame"){
            completedCounter++;
            if (e.data.url === currEventURL && e.data.tabId === currEventTabID){
              /* there's a record-time load event with the same url and tab id as 
              the event whose frame we're currently trying to find.
              we can try lining up this load event with a load event in the current run */
              var completedCounterReplay = 0;
              for (var j = replayTimeEventsSoFar.length - 1; j >= 0; j--){
                var e2 = replayTimeEventsSoFar[j];
                if (e2.type === "completed" && e2.data.type === "main_frame"){
                  completedCounterReplay++;
                  if (completedCounter === completedCounterReplay){
                    //this is the replay-time completed event that lines up with e
                    //use the frame in which this completed event happened
                    //fix up ports
                    //var e2Frame = ??;
                    //var ports = this.ports;
                    //var replayPort = ports.getPort(e2Frame);
                    //portMapping[port] = replayPort;
                    //return replayPort;

                    tabMapping[currEventTabID] = e2.data.tabId;
                    if (gpmdebug) {console.log("gpm: tabMapping updated for completed event alignment");}
                    this.setNextTimeout(0);
                    if (gpmdebug) {console.log("Using loading time data to make tab mapping.");}
                    if (gpmdebug) {console.log("gpm: not returning real port (refreshed tab mapping)");}
                    return; // so that simulateDom event will be called again, and we'll get back here now with good mappings
                  }
                }
              }
            }
          }
        }
      } // end the kind of top-level else

      if (!replayPort){
        if (gpmdebug) {console.log(v, portMapping, tabMapping);}
        if (gpmdebug) {console.log("Freak out.  We don't know what port to use to replay this event.");}
        // it may be the tab just isn't ready yet, not added to our mappings yet.  try again in a few.
        this.setNextTimeout(1000);
        // unless...we've been seeing this a lot, in which case this looks like a real failure
        this.currentPortMappingFailures += 1;
        // below is commented out because now we give up after 120
        /*
        if (this.currentPortMappingFailures >= 10){
          // ok, this is getting ridiculous. seems like the right port isn't arriving...
          this.setNextTimeout(60000);
          console.log("We're going to slow the port checking waaaaaaay down, since this doesn't seem to be working.");
        }
        */
        if (this.currentPortMappingFailures === 120){ // === rather than > because we don't want to call handler a bunch of times, only once
          if (this.errorConts && this.errorConts.portFailure){
            var that = this;
            var continuation = function(){
              that.currentPortMappingFailures = 0; // because the higher-level tool should have fixed it with the portFailure handler!
              that.setNextTimeout(0);
            }
            this.stopReplay();
            this.errorConts.portFailure(this, continuation);
          }
        }
        if (gpmdebug) {console.log("gpm: not returning real port");}
        return null;
      }
      //if (gpmdebug) {console.log(replayPort);}
      this.currentPortMappingFailures = 0;
      //if (gpmdebug) {console.log("gpm: returning real port");}
      return replayPort;
    },
    /* Given the frame information from the recorded trace, find a 
     * corresponding port */ 
    findPortInTab: function _findPortInTab(newTabId, frame) {
      var ports = this.ports;
      var portInfo = ports.getTabInfo(newTabId);
      replayLog.log('trying to find port in tab:', portInfo);
      var findPortInTabDebug = true;
      if (findPortInTabDebug){ console.log("no portInfo");}

      if (!portInfo){
        if (findPortInTabDebug){ console.log('trying to find port in tab:', portInfo);}
        return null;
      }

      /* if it's the top frame, use that */
      if (frame.topFrame) {
        replayLog.log('assume port is top level page');
        if (findPortInTabDebug){ console.log("top level page");}
        var topFrame = portInfo.top;
        if (topFrame) {
          return ports.getPort(topFrame.portId);
        }
      /* if it's an iframe, find all frames with matching urls */
      } else {
        replayLog.log('try to find port in one of the iframes');
        if (findPortInTabDebug){ console.log("try to find port in one of the iframes", portInfo.frames.length);}
        var frames = portInfo.frames;

        var bestFrameSoFar = null;
        var bestFrameDistanceSoFar = 99999;
        for (var i = 0, ii = frames.length; i < ii; i++) {
          var distance = MiscUtilities.levenshteinDistance(frames[i].URL, frame.URL);
          if (distance < bestFrameDistanceSoFar){
            bestFrameSoFar = frames[i];
            bestFrameDistanceSoFar = distance;
          }
          if (distance === bestFrameDistanceSoFar){
            replayLog.warn('have multiple iframes with same distance, might be the best distance:', bestFrameSoFar, frames[i]);
            if (findPortInTabDebug){ console.log('have multiple iframes with same distance, might be the best distance:', bestFrameSoFar, frames[i]);}
          }
        }

        if (findPortInTabDebug){ console.log('picked bestFrameSoFar', bestFrameSoFar, bestFrameDistanceSoFar);}

        /* no matching frames */
        if (!bestFrameSoFar) {
          if (findPortInTabDebug){ console.log('!bestFrameSoFar');}
          return null;
        } else {
          return ports.getPort(bestFrameSoFar.portId);
        }
      }
      if (findPortInTabDebug){ console.log('last line of findPortInTab');}
      return null;
    },
    /* Check if an event has already been replayed */
    checkReplayed: function _checkReplayed(eventObj) {
      var id = eventObj.meta.id;
      var recordedEvents = this.record.events;
      for (var i = recordedEvents.length - 1; i >= 0; --i) {
        var recordedEvent = recordedEvents[i];
        if (recordedEvent.meta.recordId == id)
          return true;
      }
      return false;
    },
    /* Check if executing an event has timed out */
    checkTimeout: function _checkTimeout() {
      var eventTimeout = params.replay.eventTimeout;
      if (eventTimeout != null && eventTimeout > 0) {
        var timeoutInfo = this.timeoutInfo;
        var curTime = new Date().getTime();

        /* we havent changed events */
        var index = this.index;
        if (timeoutInfo.index == index) {
          if (curTime - timeoutInfo.startTime > eventTimeout * 1000) {
            return true;
          }
        } else {
          this.timeoutInfo = {startTime: curTime, index: index};
        }
      }
      return false;
    },
    /* The main function which dispatches events to the content script */
    guts: function _guts() {
      if (this.checkTimeout()) {
        /* lets call the end of this script */
        var msg = 'event ' + this.index + ' has times out';
        replayLog.log(msg);
        this.finish(msg);
        return;
      }

      if (this.getStatus() == ReplayState.ACK) {
        var ack = this.ack;
        if (!ack) {
          // usually this means we want to keep waiting, but sometimes the port has disappeared, in which case a navigation probably happened before the replay ack could be sent, so then we should assume that's what the port's disappearance means
          if (!ports.portIdToPort[this.ackPort]){
            replayLog.log('ack port is actually gone; assume port disappearance means success');
            this.incrementIndex();
            this.setNextTimeout();
            this.updateStatus(ReplayState.REPLAYING);
          }
          this.setNextTimeout(params.replay.defaultWait);
          replayLog.log('continue waiting for replay ack');
          return;
        }

        type = ack.type;
        if (type == Ack.SUCCESS) {
          replayLog.log('found replay ack');
          this.incrementIndex();
          this.setNextTimeout();

          this.updateStatus(ReplayState.REPLAYING);
        } else if (type == Ack.PARTIAL) {
          throw 'partially executed commands';
        }
        return;
      }

      var events = this.events;
      var index = this.index;

      /* check if the script finished */
      // console.log("index", index, events.length);
      // console.log(events[index]);
      if (index >= events.length) {
        //no more events to actively replay, but may need to wait for some
        //console.log(index, "done with script");
        this.finish();
        return;
      }

      var e = events[index];
      var type = e.type;

      /* Find the replay function associated with the event type */
      var replayFunctionName = this.replayableEvents[type];
      var replayFunction = this[replayFunctionName];
      if (!replayFunction) {
        replayLog.log('skipping event:', e);
        this.incrementIndex();
        this.setNextTimeout(0);
        return;
      }

      replayFunction.call(this, e);
    },
    openTabSequenceFromTrace: function _openTabSequenceFromTrace(trace){
      var completed_events = _.filter(trace, function(event){return event.type === "completed" && event.data.type === "main_frame";});
      //console.log(completed_events);
      var eventIds = _.map(completed_events, function(event){return event.meta.id});
      return eventIds;
    },
    currentCompletedObservationFailures: 0,
    simulateCompletedEvent: function _simulateCompletedEvent(e){
      if (e.forceReplay && (!e.reset || !(e.reset.alreadyForced))){
        //console.log("forcing replay");
        if (!e.reset){e.reset = {};}
        e.reset.alreadyForced = true;  // enforce that we don't do the forceReplay a second time, but instead wait to see the completed event?
        var that = this;
        var options = {url: e.data.url, active: true};
        if (this.targetWindowId){
          options.windowId = this.targetWindowId;
        }
        //console.log("options", options);
        //console.log("event", e);
        chrome.tabs.create(options, function(){
          // not sufficient to treat tab creation as getting an ack.  must wait for it to appear in the replay-time trace
          // that.index ++; // advance to next event
          that.setNextTimeout(0); 
        });
      }
      else{
        // don't need to do anything
        // this.index ++;
        // this.setNextTimeout(0);

        if (e.data.type !== "main_frame"){
          // don't need to do anything; not a top-level load, so assume we can ignore it
          this.index ++;
          this.currentCompletedObservationFailures = 0;
          this.setNextTimeout(0);
          return;
        }

        // ok, used to think we don't need to do anything, but really we should actually wait for the completed event, at least if it's a top-level one.  let's make sure *something* has appeared in the last 5 or so events
        // todo: is it really sufficient to just check the last 5 events?  if our assumption about the last dom even causing the completed event is true, we should expect that it appears after the most recent dom event
        // can't assume it's the last event, because a top-level load often causes some script loads, that kind of thing, as well.  and those might have snuck in.

        // ok, so this may not be quite right, but let's go back to the most recent DOM event and make sure there's a top-level completed event somewhere near it
        var replayTimeEvents = this.record.events;
        var completedAfterLastDom = false;
        var domIndex = null;
        var completedWithinWindowBeforeDom = false;
        var completedBeforePriorMatchedCompletedEvent = false;
        var win = 5;
        var lastMatchedCompletedEventIndex = this.matchedCompletedEvents[this.matchedCompletedEvents.length - 1];
        for (var i = replayTimeEvents.length - 1; i >= 0; i--){
          // debug todo: remove next two lines
          var ev = replayTimeEvents[i];
          // console.log(i, domIndex, ev.type, ev.data);

          // for now, commenting out the below, deciding to be willing to go all the way back to the last top-level completed event that we've already matched
          /*
          if (domIndex !== null && i < (domIndex - win)){
            // ok, we've gone too far, we've passed the window around the domIndex
            break;
          }
          */

          if (i <= lastMatchedCompletedEventIndex){
            // ok, we've gone too far.  we've now reached a completed event that we already matched in the past, so can't use this one again
            break;
          }


          var ev = replayTimeEvents[i];
          if (domIndex === null && ev.type === "dom"){
            // we've found the last dom event
            domIndex = i;
          }
          else if (domIndex === null && ev.type === "completed" && ev.data.type === "main_frame"){
            // we've found a completed top-level after the last dom event
            completedAfterLastDom = true;
            this.matchedCompletedEvents.push(i);
            break;
          }
          else if (domIndex !== null && ev.type === "completed" && ev.data.type === "main_frame"){
            // since we're still going, but we've found the domIndex already, this is a completed event before the last dom event
            completedWithinWindowBeforeDom = true;
            this.matchedCompletedEvents.push(i);
            break;
          }
        }

        if (completedWithinWindowBeforeDom || completedAfterLastDom){
          // we've seen a corresponding completed event, don't need to do anything
          this.index ++;
          this.currentCompletedObservationFailures = 0;
          this.setNextTimeout(0);
        }
        else{
          // let's give it a while longer
          // todo: as above in waitforobserved events, question of whether it's ok to keep waiting and waiting for the exact same number of top-level completed events.  should we give it 10 tries, then just continue?
          // todo: eventually we really do need to surface this to the top-level tool.  can't just keep looping here forever
          this.currentCompletedObservationFailures += 1;
          if (this.currentCompletedObservationFailures <= 30){
            this.setNextTimeout(500); // todo: consider raising this or adding backoff.  wonder if this is the cause of occasional possibly wifi-outage related crashes
          }
          else{
            // ok, this is getting a little ridiculous.  we've tried for 15 seconds and still haven't found anything?
            // it's possible that the network connection went out momentarily and that we need to go and reload a page.  let's check for something that looks like it might suggest that, then fix it
            this.reloadLastTabIfFailed();
            this.setNextTimeout(5000); // let's also slow down our checks so we don't crash the extension
          }
        }
      }
    },
    reloadLastTabIfFailed: function _reloadLastTabIfFailed() {
        if (this.targetWindowId){
          // for now this is only going to check for failed tabs in the target window (the window created for replay), and only if there even is a target window
          var that = this;
          chrome.tabs.getAllInWindow(this.targetWindowId, function(tabs){
            WALconsole.log("We think we might have had a tab fail to load, so we're going to try reloading.");
            WALconsole.log(tabs);
            // we really prefer to only reload the very last tab, but since there's the possibility it might be earlier, we could be willing to go back further
            
            for (var i = tabs.length - 1; i >= 0; i--){
              (function(tab){
                if (MiscUtilities.looksLikeLoadingFailure(tab)){
                  // let's make sure once it's reloaded we're ready to try again
                  /*
                  var checkUntilComplete = function _checkUntilComplete(){
                    chrome.tabs.get(tab.id, function (tab) {
                      if (tab.status === 'complete') {
                        that.setNextTimeout(0);
                      }
                      else{
                        checkUntilComplete();
                      }
                    });
                  }
                  */
                  // let's go tell it to reload
                  chrome.tabs.reload(tab.id, {}, function(){
                    // ok, good, it's reloaded.  start checking for completion
                    // checkUntilComplete();
                    // for now, since even without network connection we'll get the 'complete' status, we don't want to do the loop above
                    // because it just ends up looping really really quickly, and I don't want to crash the extension.  so just wait the whole 5000 (above)
                  });
                }
              })(tabs[i]);
            }
          });
        }
    },
    /* The main function which dispatches events to the content script */
    simulateDomEvent: function _simulateDomEvent(v) {
      try {
        /* check if event has been replayed, if so skip it */
        if (params.replay.cascadeCheck && this.checkReplayed(v)) {
          replayLog.debug('skipping event: ' + v.type);
          this.incrementIndex();
          this.setNextTimeout();

          this.updateStatus(ReplayState.REPLAYING);
          return;
        }

        var meta = v.meta;
        replayLog.log('background replay:', meta.id, v);

        var replayPort = this.getMatchingPort(v);
        if (!replayPort){
          // it may be that the target tab just isn't ready yet, hasn't been added to our mappings yet.  may need to try again in a moment.
          // if no matching port, getMatchingPort will take care of trying again later 
          return;
        }

        /* sometimes we use special no-op events to make sure that a page has gone through our alignment process without actually executing a dom event on it */
        if (v.data.type === "noop"){
          this.incrementIndex();
          this.setNextTimeout(0);
        }

        /* if there is a trigger, then check if trigger was observed */
        var triggerEvent = this.getEvent(v.timing.triggerEvent);
        if (triggerEvent) {
          var recordEvents = this.record.events;

          var matchedEvent = null;
          for (var i = recordEvents.length - 1; i >= 0; --i) {
            var otherEvent = recordEvents[i];
            if (otherEvent.type == triggerEvent.type &&
                otherEvent.data.type == triggerEvent.data.type &&
                matchUrls(otherEvent.data.url,
                          triggerEvent.data.url, 0.9)) {
              matchedEvent = otherEvent;
              break;
            }
          }

          if (!matchedEvent) {
            this.setNextTimeout(params.replay.defaultWait);
            return;
          }
        }

        /* we hopefully found a matching port, lets dispatch to that port */
        var type = v.data.type;

        // console.log("this.getStatus()", this.getStatus());

        try {
          if (this.getStatus() == ReplayState.REPLAYING) {
            /* clear ack */
            this.ack = null;
            this.ackPort = replayPort.name;

            /* group atomic events */
            var eventGroup = [];
            var endEvent = meta.endEventId;
            if (params.replay.atomic && endEvent) {
              var t = this.index;
              var events = this.events;
              while (t < events.length &&
                     endEvent >= events[t].meta.pageEventId &&
                     v.frame.port == events[t].frame.port) {
                eventGroup.push(events[t]);
                t++;
              }
            } else {
              eventGroup = [v];
            }

            replayPort.postMessage({type: 'dom', value: eventGroup});
            this.updateStatus(ReplayState.ACK);

            this.firstEventReplayed = true;

            replayLog.log('sent message', eventGroup);
            replayLog.log('start waiting for replay ack');
            this.setNextTimeout(0);
          } else {
            throw 'unknown replay state';
          }
        } catch (err) {
          replayLog.error('error:', err.message, err);
          /* a disconnected port generally means that the page has been
           * navigated away from */
          if (err.message == 'Attempting to use a disconnected port object') {
            var strategy = params.replay.brokenPortStrategy;
            //console.log("using broken port strategy: ", strategy);
            if (strategy == BrokenPortStrategy.RETRY) {
              if (v.data.cascading) {
                /* skip the rest of the events */
                this.incrementIndex();
                this.setNextTimeout(0);
              } else {
                /* remove the mapping and try again */
                delete this.portMapping[v.frame.port];
                this.setNextTimeout(0);
              }
            } else {
              throw 'unknown broken port strategy';
            }
          } else {
            err.printStackTrace();
            throw err;
          }
        }
      } catch (err) {
        replayLog.error('error:', err.message, err);
        this.finish(err.toString());
      }
    },
    /* Remove any information adding during replay */
    resetEvent: function _resetEvent(v) {
      if (v.reset)
        v.reset = {};
    },
    receiveAck: function _receiveAck(ack) {
      this.ack = ack;
      if (ack.setTimeout)
        this.setNextTimeout(0);
    },
    handleNodeFindingWithUserRequiredFeaturesFailure: function _handleNodeFindingWithUserRequiredFeaturesFailure() {
      // todo: eventually this should actually provide a continuation as an argument!  null is wrong!
      if (this.errorConts && this.errorConts.nodeFindingWithUserRequiredFeaturesFailure){
        this.stopReplay();
        this.errorConts.nodeFindingWithUserRequiredFeaturesFailure(this, null); // this is the replayObject
      }
    }
  };

  return Replay;
})();

/* The interface for the user to interact with the replayer. Can be used to
 * directly query the user. */
var User = (function UserClosure() {
  var log = getLog('user');

  function User(panel) {
    this.panel = panel;
    this.activeTab = null;
  }

  User.prototype = {
    setPanel: function _setPanel(panel) {
      this.panel = panel;
    },
    /* Query the user
     *
     * @param {string} prompt Text to show the user
     * @param {function} validatioon Check whether the answer is as exepcted
     * @param defaultAnswer Answer to use during automated periods
     * @param {function} callback Continuation to pass answer into
     */
    question: function _question(prompt, validation, defaultAnswer, callback) {
      var panel = this.panel;
      var user = this;

      if (params.replay.defaultUser) {
        callback(defaultAnswer);
      } else {
        panel.question(prompt, function(answer) {
          var sanitize = validation(answer);
          if (sanitize)
            callback(sanitize);
          else
            user.question(prompt, validation, defaultAnswer, callback);
        });
      }
    },
    /* Set which tab the user has selected */
    activatedTab: function _activatedTab(tabInfo) {
      this.activeTab = tabInfo;
    },
    getActivatedTab: function _getActivatedTab() {
      return this.activeTab;
    },
    /* Question posed from the content script */
    contentScriptQuestion: function _question(prompt, port) {
      this.question(prompt, function() {return true;}, '', function(answer) {
        port.postMessage({type: 'promptResponse', value: answer});
      });
    }
  };

  return User;
})();

/* Coordinates the model (Record, Replay, User) and view (Panel) */
var Controller = (function ControllerClosure() {
  var ctlLog = getLog('controller');

  function Controller(record, replay, scriptServer, ports) {
    this.record = record;
    this.replay = replay;
    this.scriptServer = scriptServer;
    this.ports = ports;
    this.listeners = [];
  }

  Controller.prototype = {
    /* The user started recording */
    start: function() {
      ctlLog.log('start');
      this.record.startRecording();

      /* Update the UI */
      chrome.browserAction.setBadgeBackgroundColor({color: [255, 0, 0, 64]});
      chrome.browserAction.setBadgeText({text: 'ON'});
    },
    stop: function() {
      ctlLog.log('stop');
      this.record.stopRecording();

      /* Update the UI */
      chrome.browserAction.setBadgeBackgroundColor({color: [0, 0, 0, 0]});
      chrome.browserAction.setBadgeText({text: 'OFF'});
    },
    reset: function() {
      ctlLog.log('reset');
      this.record.reset();
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

/* Instantiate components */
var ports = new PortManager();
var scriptServer = null;

var user = new User(user);
var record = new Record(ports);
var replay = new Replay(ports, scriptServer, user);
var controller = new Controller(record, replay, scriptServer, ports);

/* Add event handlers */
var bgLog = getLog('background');

/* The first message content scripts send is to get a unique id */
function handleIdMessage(request, sender, sendResponse) {
  bgLog.log('background receiving:', request, 'from', sender);
  if (request.type == 'getId') {
    var portId = ports.getNewId(request.value, sender);
    if (portId)
      sendResponse({type: 'id', value: portId});
  }
}

var recordHandlers = {
  'event': function(port, request) {
    record.addEvent(request.value, port.name);
  },
  'updateEvent': function(port, request) {
    record.updateEvent(request.value, port.name);
  }
}

var replayHandlers = {
  'event': function(port, request) {
    replay.record.addEvent(request.value, port.name);
  },
  'updateEvent': function(port, request) {
    replay.record.updateEvent(request.value, port.name);
  },
  'ack': function(port, request) {
    replay.receiveAck(request.value);
  },
  'prompt': function(port, request) {
    user.contentScriptQuestion(request.value, port);
  },
  'nodeFindingWithUserRequiredFeaturesFailure': function(port, request) {
    replay.handleNodeFindingWithUserRequiredFeaturesFailure();
  }
}

var handlers = {
  'alert': function(port, request) {
    //panel.addMessage('[' + port.name + '] ' + request.value);
  },
  'getRecording': function(port, request) {
    var recStatus = record.getStatus();
    var repStatus = replay.record.getStatus();

    if (recStatus == RecordState.RECORDING)
      port.postMessage({type: 'recording', value: recStatus});
    else if (repStatus == RecordState.REPLAYING)
      port.postMessage({type: 'recording', value: repStatus});
    else
      port.postMessage({type: 'recording', value: RecordState.STOPPED});
  },
  'getParams': function(port, request) {
    port.postMessage({type: 'params', value: params});
  },
  'url': function(port, request) {
    ports.updateUrl(port, request.value);
  }
}

/* Handle messages coming from the content scripts */
function handleMessage(port, request) {
  var type = request.type;
  var state = request.state;

  bgLog.log('handle message:', request, type, state);

  if (state == RecordState.RECORDING && type in recordHandlers) {
    recordHandlers[type](port, request);
  } else if ((state == RecordState.REPLAYING && type in replayHandlers) || (state == RecordState.STOPPED && ['ack', 'updateEvent'].indexOf(type) > -1) ) { // todo: is this ok?  the stopped acks are breaking everything...
    replayHandlers[type](port, request);
  } else if (type in handlers) {
    handlers[type](port, request);
  } else {
    bgLog.error('cannot handle message:', request);
  }
}

/* Attach the event handlers to their respective events */
chrome.runtime.onMessage.addListener(handleIdMessage);

chrome.runtime.onConnect.addListener(function(port) {
  ports.connectPort(new Port(port));
});

chrome.tabs.getCurrent(function(curTab) {
  var tabId = curTab.id;
  chrome.tabs.onActivated.addListener(function _handleTabGetCurrent(activeInfo) {
    if (activeInfo.tabId != tabId)
      user.activatedTab(activeInfo);
  });
});

chrome.tabs.onRemoved.addListener(function(tabId, removeInfo) {
  ports.removeTab(tabId);
});

/* Listen to web requests */
function addBackgroundEvent(e) {
  if (record.recordState == RecordState.RECORDING)
    record.addEvent(e);
  else if (replay.record.recordState == RecordState.REPLAYING)
    replay.record.addEvent(e);
}

function addWebRequestEvent(details, type) {
  var data = {};
  data.requestId = details.requestId;
  data.method = details.method;
  data.parentFrameId = details.parentFrameId;
  data.tabId = details.tabId;
  data.type = details.type;
  data.url = details.url;
  data.reqTimeStamp = details.timeStamp;
  data.timeStamp = (new Date()).getTime();

  var v = {};
  v.data = data;
  v.type = type;

  addBackgroundEvent(v);

  // let's also figure out the window that should be associated with this web request, add that info once we get it
  // -1 means the request is not associated with a particular tab
  if (details.tabId > -1){
    chrome.tabs.get(details.tabId, function (tab) {
      v.data.windowId = tab.windowId;
    });
  }
}

var filter = {urls: ['http://*/*', 'https://*/*'],
  types: ['main_frame', 'sub_frame', 'script', 'object', 'xmlhttprequest']};

chrome.webRequest.onBeforeRequest.addListener(function(details) {
  bgLog.log('request start', details);
  addWebRequestEvent(details, 'start');
}, filter, ['blocking']);

chrome.webRequest.onCompleted.addListener(function(details) {
  bgLog.log('completed', details);
  addWebRequestEvent(details, 'completed');
}, filter);

ports.sendToAll({type: 'params', value: params});
controller.stop();

/*
function printEvents() {
  var events = record.events;
  var text = JSON.stringify(events, null, 2);
  bgLog.log(text);
}

function printReplayEvents() {
  var events = replay.record.events;
  var text = JSON.stringify(events, null, 2);
  bgLog.log(text);
}
*/
