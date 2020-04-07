import { HelenaConsole } from "../../common/utils/helena_console";
import { Highlight } from "./highlight";
import { Indexable } from "../common/utils";
import { Snapshot, Delta, NodeSnapshot, PropertyDifferentDelta } from "./snapshot";
import { Target, TargetInfo, TargetStatus } from "./target";
import { DOMUtils } from "./dom_utils";
import { RingerMessage, PortInfo, ReplayAckStatus, RecordState, GetIdMessage } from "../common/messages";
import { RingerEvent, RecordedRingerEvent, DOMRingerEvent } from "../common/event";
import { Logs } from "../common/logs";
import { CompensationAction, IRingerParams, RingerParams } from "../common/params";

/**
 * Handlers for other tools using record & replay to put data in event messages.
 * The only default handler is `___additionalData___`, for copying data from
 *   record event objects to replay event objects.
 */
interface RecordingHandlers {
  [key: string]: Function;
  ___additionalData___: Function;
}

/**
 * Toggle the handlers in {@link RecordingHandlers} on/off.
 */
interface RecordingHandlersToggle {
  [key: string]: boolean;
  ___additionalData___: boolean;
}

/**
 * Handlers for other tools using record and replay to process event even before
 *   most processing done.
 */
interface RecordingFilters {
  [key: string]: Function;
}

/**
 * Toggle the filters in {@link RecordingFilters} on/off.
 */
interface RecordingFiltersToggle {
  [key: string]: boolean;
}

interface RingerSnapshot {
  before?: NodeSnapshot;
  after?: NodeSnapshot;
  target: HTMLElement;
}

export interface TimeoutInfo {
  startTime: number;
  startIndex: number;
  events: RingerEvent[] | null;
}

export class RingerContent {
  public recording: RecordState;
  public frameId?: number;
  public port: chrome.runtime.Port;

  /**
   * Record variables
   */
  public pageEventId: number; // counter to give each event on page a unique id
  public lastRecordEvent: DOMRingerEvent | null;  // last event recorded

  // snapshot (before and after) for last event
  public lastRecordSnapshot?: RingerSnapshot;

  // snapshot (before and after) the current event
  public curRecordSnapshot?: RingerSnapshot;

  public additional_recording_handlers: RecordingHandlers;
  public additional_recording_handlers_on: RecordingHandlersToggle;

  public additional_recording_filters: RecordingFilters;
  public additional_recording_filters_on: RecordingFiltersToggle;

  /**
   * Replay variables
   */
  public lastReplayEvent: RingerEvent;    // last event replayed
  public lastReplayTarget: HTMLElement;

  // snapshot taken before the event is replayed
  public lastReplaySnapshot: RingerSnapshot;

  // snapshot taken before the next event is replayed
  public curReplaySnapshot: RingerSnapshot;

  public dispatchingEvent: boolean; // if we currently dispatching an event
  public retryTimeout: number | null; // ID to callback for retrying

  // current events we need are trying to dispatch
  public simulatedEvents: RingerEvent[] | null;

  public simulatedEventsIdx: number;
  public timeoutInfo: TimeoutInfo;

  /**
   * Addon hooks
   */
  public addonStartup: (() => void)[];
  public addonStartRecording: (() => void)[];
  public addonPreRecord: ((ev: Event) => boolean)[];
  public addonPostRecord:
    ((ev: Event, msg: RingerEvent) => boolean)[];
  public addonPreReplay: ((target: Node, ev: Event, msg: RingerEvent,
    events: RingerEvent[]) => boolean)[];
  public addonPreTarget: ((ev: RingerEvent) => boolean)[];
  public addonTarget: ((ev: RingerEvent) => Node)[];

  /**
   * Loggers
   */
  public log: Logs.Logger | Logs.NoopLogger;
  public recordLog: Logs.Logger | Logs.NoopLogger;
  public replayLog: Logs.Logger | Logs.NoopLogger;

  /**
   * Prompt
   */
  public promptCallback: ((text: string) => void) | null;

  constructor() {
    this.recording = RecordState.STOPPED;
    this.pageEventId = 0;

    this.additional_recording_filters = {};
    this.additional_recording_filters_on = {};
    this.additional_recording_handlers = {
      ___additionalData___: () => {}
    };
    this.additional_recording_handlers_on = {
      ___additionalData___: true
    };

    this.dispatchingEvent = false;
    this.retryTimeout = null;
    this.simulatedEvents = null;
    this.simulatedEventsIdx = 0;
    this.timeoutInfo = {
      startTime: 0,
      startIndex: 0,
      events: null
    };

    this.addonStartup = [];
    this.addonStartRecording = [];
    this.addonPreRecord = [];
    this.addonPostRecord = [];
    this.addonPreReplay = [];
    this.addonPreTarget = [];
    this.addonTarget = [];

    this.log = Logs.getLog('content');
    this.recordLog = Logs.getLog('record');
    this.replayLog = Logs.getLog('replay');

    // We need to add all the events now before and other event listeners are
    //   added to the page. We will remove the unwanted handlers once params is
    //   updated.
    this.addListenersForRecording();

    // Need to check if we are in an iframe
    const value: PortInfo = {
      top: (window === window.top),
      URL: document.URL
    };

    // Add all the other handlers
    chrome.runtime.sendMessage({type: 'getId', value: value},
        (resp: GetIdMessage) => {
      if (!resp) return;
      
      this.log.log(resp);

      this.frameId = parseInt(resp.value);
      this.port = chrome.runtime.connect({ name: resp.value });
      this.port.onMessage.addListener(this.handleMessage.bind(this));

      // see if recording is going on
      this.port.postMessage({
        type: 'getParams',
        value: null,
        state: this.recording
      });
      this.port.postMessage({
        type: 'getRecording',
        value: null,
        state: this.recording
      });

      // handle any startup the addons need
      for (const addonHandler of this.addonStartup) {
        addonHandler();
      }
    });

    // TODO: cjbaik: should this polling ever stop? seems to check when the URL
    //   on the document changes. Could we implement an event listener for this?
    window.setInterval(function() {
      if (value.URL !== document.URL) {
        const url = document.URL;
        value.URL = url;
        this.port.postMessage({
          type: 'url',
          value: url,
          state: this.recording
        });
        this.log.log('url change: ', url);
      }
    }, 1000);

  }

  /**
   * Attach the event handlers to their respective events.
   */
  public addListenersForRecording() {
    const events = RingerParams.params.events;
    for (const eventType in events) {
      const listOfEvents = events[eventType];
      for (const e in listOfEvents) {
        listOfEvents[e] = true;
        document.addEventListener(e, this.recordEvent.bind(this), true);
        HelenaConsole.namedLog("tooCommon", "adding listener content", e);
      }
    }
  }

  /**
   * Check if the current event has timed out.
   *
   * @param events The current list of events to replay.
   * @param startIndex The index into {@link events} which is needs to be
   *     replayed.
   * @returns {boolean} True if timeout has occured
   */
  public checkTimeout(events: RingerEvent[], startIndex: number) {
    let timeout = RingerParams.params.replay.targetTimeout;
    if (events[startIndex] && events[startIndex].targetTimeout){
      timeout = <number> events[startIndex].targetTimeout;
    }
    console.log("Checking for timeout:", timeout);
    if (!(timeout === null || timeout === undefined) && timeout > 0) {
      var curTime = new Date().getTime();

      /* we havent changed event */
      if (this.timeoutInfo.events == events &&
          this.timeoutInfo.startIndex == startIndex) {
        if ((curTime - this.timeoutInfo.startTime) > (timeout * 1000)) {
          return true;
        }
      } else {
        this.timeoutInfo = {
          startTime: curTime,
          startIndex: startIndex,
          events: events
        };
      }
    }
    return false;
  }

  /**
   * Stop the next execution of {@link simulate}.
   */
  public clearRetry() {
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }
  }

  /**
   * Update the last target, so that the record and replay deltas match.
   * @param recordDeltas deltas from recording
   * @param replayDeltas deltas from replay
   * @param lastTarget last target
   */
  public fixDeltas(recordDeltas: Delta[], replayDeltas: Delta[],
      lastTarget: HTMLElement & Indexable) {
    this.replayLog.info('record deltas:', recordDeltas);
    this.replayLog.info('replay deltas:', replayDeltas);

    /* effects of events that were found in record but not replay */
    const recordDeltasNotMatched = Snapshot.filterDeltas(recordDeltas,
      replayDeltas);
    /* effects of events that were found in replay but not record */
    const replayDeltasNotMatched = Snapshot.filterDeltas(replayDeltas,
      recordDeltas);

    this.replayLog.info('record deltas not matched: ', recordDeltasNotMatched);
    this.replayLog.info('replay deltas not matched: ', replayDeltasNotMatched);

    const element = lastTarget;

    for (const delta of replayDeltasNotMatched) {
      this.replayLog.debug('unmatched replay delta', delta);

      if (delta.type === 'Property is different.') {
        const propDiffDelta = <PropertyDifferentDelta> delta;
        const divProp = propDiffDelta.divergingProp;
        if (RingerParams.params.replay.compensation === CompensationAction.FORCED) {
          try {
            element[divProp] = propDiffDelta.orig.prop[divProp];
            HelenaConsole.log("updated prop", divProp, " to ",
              propDiffDelta.orig.prop[divProp]);
          } catch (err) {
            HelenaConsole.warn("Attempted to update prop", divProp,
              propDiffDelta.orig.prop[divProp]);
          }
        }
      }
    }

    /* the thing below is the stuff that's doing divergence synthesis */
    for (const delta of recordDeltasNotMatched) {
      this.replayLog.debug('unmatched record delta', delta);

      if (delta.type == 'Property is different.') {
        const diffPropDelta = <PropertyDifferentDelta> delta;
        const divProp = diffPropDelta.divergingProp;
        if (RingerParams.params.replay.compensation == CompensationAction.FORCED) {
          try {
            element[divProp] = diffPropDelta.changed.prop[divProp];
            HelenaConsole.log("updated prop", divProp, " to ",
              diffPropDelta.changed.prop[divProp]);
          } catch (err) {
            HelenaConsole.warn("Attempted to update prop", divProp,
              diffPropDelta.orig.prop[divProp]);
          }
          
        }
      }
    }
  }

  /**
   * Returns the default event properties for an event.
   * @param type The DOM event type
   */
  public getEventProps(type: string) {
    const eventType = this.getEventType(type);
    return RingerParams.params.defaultProps[eventType];
  }

  /**
   * Get the class of an event, which is used to init and dispatch it
   *
   * @param type The DOM event type
   * @returns The class type, such as MouseEvent, etc.
   */
  public getEventType(type: string) {
    for (const eventType in RingerParams.params.events) {
      const eventTypes = RingerParams.params.events[eventType];
      for (const e in eventTypes) {
        if (e === type) {
          return eventType;
        }
      }
    }
    throw new ReferenceError("Invalid eventType.");
  }


  /**
   * Find matching event in simulatedEvents. Needed to ensure that an event is
   *   not replayed twice, i.e. once by the browser and once by the tool.
   */
  public getMatchingEvent(eventData: Event) {
    if (!this.dispatchingEvent) {
      return null;
    }

    if (this.simulatedEvents === null ||
        this.simulatedEventsIdx >= this.simulatedEvents.length) {
      return null;
    }

    const eventObject = this.simulatedEvents[this.simulatedEventsIdx];
    if (eventObject.data.type === eventData.type) {
      return eventObject;
    }

    return null;
  }

  /**
   * Handle messages coming from the background page.
   */
  public handleMessage(request: RingerMessage) {
    const type = request.type;

    this.log.log(`[${this.frameId}] handle message:`, request, type);

    if (type === 'recording') {
      this.recording = request.value;
      if (this.recording === RecordState.RECORDING) {
        /* handle any startup the addons need once a tab knows it's recording */
        for (const addonHandler of this.addonStartRecording) {
          addonHandler();
        }
      }
    } else if (type === 'params') {
      this.updateParams(request.value);
    } else if (type === 'dom') {
      this.simulate(request.value, 0);
    } else if (type === 'stop') {
      this.updateDeltas();
      this.resetRecord();
    } else if (type === 'reset') {
      this.resetRecord();
    } else if (type === 'pauseReplay') {
      this.clearRetry();
    } else if (type === 'url') {
      this.port.postMessage({
        type: 'url',
        value: document.URL,
        state: this.recording
      });
    } else if (type === 'promptResponse') {
      this.promptResponse(request.value);
    } else {
      this.log.error('cannot handle message:', request);      
    }
  }

  /**
   * Increment matched event counter.
   */
  public incrementMatchedEventIndex() {
    this.simulatedEventsIdx++;
  }

  /**
   * Does this send a prompt to the user?
   * @param text 
   * @param callback 
   */
  public promptUser(text: string, callback: ((text: string) => void)) {
    if (!this.promptCallback) {
      this.log.warn('overwriting old prompt callback');
    }

    this.promptCallback = callback;
    this.port.postMessage({
      type: 'prompt',
      value: text,
      state: this.recording
    });
  }

  /**
   * Does this provide a response to a user prompt?
   * @param text
   */
  public promptResponse(text: string) {
    if (this.promptCallback) {
      this.promptCallback(text);
    }

    this.promptCallback = null;
  }

  /**
   * Create an event record given the data from the event handler.
   */
  public recordEvent(eventData: Event & Indexable) {
    /* check if we are stopped, then just return */
    if (this.recording == RecordState.STOPPED) {
      return true;
    }

    for (const key in this.additional_recording_filters_on) {
      // on may be false, or may lack a handler if user attached something silly
      if (!this.additional_recording_filters_on[key] ||
          !this.additional_recording_filters[key]) {
        continue;
      }
      const filterIt = this.additional_recording_filters[key](eventData);
      if (filterIt){
        // the message including the eventMessage will never be sent, so this
        //   event will never be recorded
        return;
      }
    }

    const type = eventData.type;
    const dispatchType = this.getEventType(type);
    let shouldRecord = RingerParams.params.events[dispatchType][type];
    if (RingerParams.params.ctrlOnlyEvents.includes(type) &&
        !(<MouseEvent | KeyboardEvent> eventData).ctrlKey) {
      //console.log("Ignoring "+type+" because CTRL key not down.");
      shouldRecord = false;
    }

    const matched = this.getMatchingEvent(eventData);

    if (!matched && type == 'change' &&
        this.recording == RecordState.REPLAYING) {
      eventData.stopImmediatePropagation();
      eventData.preventDefault();
      return false;
    }

    /* cancel the affects of events which are not extension generated or are not
    * picked up by the recorder */
    if (RingerParams.params.replay.cancelUnknownEvents && 
        this.recording === RecordState.REPLAYING && !this.dispatchingEvent) {
      this.recordLog.debug(
        `[${this.frameId}] cancel unknown event during replay:`, type,
        dispatchType, eventData);
      eventData.stopImmediatePropagation();
      eventData.preventDefault();
      return false;
    }

    if (RingerParams.params.record.cancelUnrecordedEvents &&
        this.recording === RecordState.RECORDING && !shouldRecord) {
      this.recordLog.debug(`[${this.frameId}] cancel unrecorded event:`, type, 
          dispatchType, eventData);
      eventData.stopImmediatePropagation();
      eventData.preventDefault();
      return false;
    }

    /* if we are not recording this type of event, we should exit */
    if (!shouldRecord) {
      return true;
    }

    /* handle any event recording the addons need */
    for (const addonHandler of this.addonPreRecord) {
      if (!addonHandler(eventData))
        return false;
    }

    /* continue recording the event */
    this.recordLog.debug(`[${this.frameId}] process event:`, type, dispatchType,
        eventData);
    this.sendAlert('Recorded event: ' + type);

    const properties = this.getEventProps(type);
    const target = <HTMLElement> eventData.target;
    const nodeName = target.nodeName.toLowerCase();

    const eventMessage: DOMRingerEvent = {
      additional: {},
      data: {
        timeStamp: 0,  // will be set below
        type: ''       // will be set below
      },
      frame: {
        innerHeight: window.innerHeight,
        innerWidth: window.innerWidth,
        outerHeight: window.outerHeight,
        outerWidth: window.outerWidth,
        URL: document.URL
      },
      meta: {
        dispatchType: dispatchType,
        nodeName: nodeName,
        pageEventId: this.pageEventId++,
        recordState: this.recording
      },
      
      // TODO: cjbaik: moved this above `replayUpdateDeltas` and `updateDeltas`,
      //   does it break?
      target: Target.saveTargetInfo(target, this.recording),
    
      timing: {},
      type: 'dom'
    };

    /* deal with all the replay mess that we can't do in simulate */
    if (this.recording === RecordState.REPLAYING) {
      this.replayUpdateDeltas(eventData, eventMessage);
    }

    /* deal with snapshotting the DOM, calculating the deltas, and sending
    * updates */
    this.updateDeltas(target);

    const relatedTarget = eventData.relatedTarget;
    if (relatedTarget) {
      eventMessage.relatedTarget = Target.saveTargetInfo(relatedTarget,
        this.recording);
    }

    /* record all properties of the event object */
    if (RingerParams.params.record.allEventProps) {
      for (const prop in eventData) {
        try {
          const value = eventData[prop];
          const t = typeof(value);
          if (t === 'number' || t === 'boolean' || t === 'string' || 
              t === 'undefined') {
            eventMessage.data[prop] = value;
          }
        } catch (err) {
          this.recordLog.error(`[${this.frameId}] error recording property:`,
            prop, err);
        }
      }
    } else {
      /* only record the default event properties */
      for (const prop in properties) {
        if (prop in eventData) {
          eventMessage.data[prop] = eventData[prop];
        }
      }
    }

    // now we need to handle the timeStamp, which is milliseconds from epoch in
    //   old Chrome, but milliseconds from start of current page load in new
    //   Chrome
    if (eventMessage.data.timeStamp < 307584000000) {
      // if you've been waiting on this page for 10 years, you're out of luck
      // we're assuming this is new Chrome's time since page loaeventMessage.d
      eventMessage.data.timeStamp = eventMessage.data.timeStamp +
        performance.timing.navigationStart;
    }

    /* handle any event recording the addons need */
    for (const addonHandler of this.addonPostRecord) {
      addonHandler(eventData, eventMessage);
    }
    
    for (const key in this.additional_recording_handlers_on) {
      // on may be false, or may lack a handler if user attached something silly
      if (!this.additional_recording_handlers_on[key] ||
          !this.additional_recording_handlers[key]) {
        continue;
      }
      const handler = this.additional_recording_handlers[key];
      const ret_val = handler(target, eventMessage);
      if (ret_val === false) {
        // additional recording handlers are allowed to throw out events by returning false
        // this may not be a good design, so something to consider in future
        // also, is false really the value that should do this?
        return; // the message including the eventMessage will never be sent, so this event will never be recorded
      }
      if (ret_val !== null) {
        eventMessage.additional[key] = ret_val;
      }
    }

    /* save the event record */
    this.recordLog.debug(`[${this.frameId}] saving event message:`,
      eventMessage);
    this.port.postMessage({
      type: 'event',
      value: eventMessage,
      state: this.recording
    });
    this.lastRecordEvent = eventMessage;

    /* check to see if this event is part of a cascade of events. we do this 
    * by setting a timeout, which will execute after the cascade of events */
    setTimeout(() => {
      if (!this.lastRecordEvent) {
        throw new ReferenceError("lastRecordEvent is null.");
      }
      const update = {
        type: 'updateEvent',
        value: {
          pageEventId: eventMessage.meta.pageEventId,
          updates: [
            {
              field: 'meta.endEventId',
              value: this.lastRecordEvent.meta.pageEventId
            }
          ]
        },
        state: this.lastRecordEvent.meta.recordState
      };
      this.recordLog.debug('Update:', update);
      this.port.postMessage(update);
    }, 0);

    // TODO: special case with mouseover, need to return false
    return true;
  }

  /**
   * Fix deltas that did not occur during replay.
   */
  public replayUpdateDeltas(eventData: Event, eventMessage: DOMRingerEvent) {
    const replayEvent = this.getMatchingEvent(eventData);
    if (replayEvent) {
      this.incrementMatchedEventIndex();
        
      replayEvent.replayed = true;

      eventMessage.meta.recordId = replayEvent.meta?.id;
      const target = <HTMLElement> eventData.target;
      this.snapshotReplay(target);

      /* make sure the deltas from the last event actually happened */
      if (RingerParams.params.compensation.enabled && this.lastReplayEvent) {
        let recordDeltas = this.lastReplayEvent.meta?.deltas;
        if (recordDeltas === undefined) {
          this.recordLog.error('no deltas found for last event:',
            this.lastReplayEvent);
          recordDeltas = [];
        }

        /* make sure replay matches recording */
        if (this.lastReplaySnapshot) {
          const replayDeltas = Snapshot.getDeltas(
            this.lastReplaySnapshot.before, this.lastReplaySnapshot.after);
          /* check if these deltas match the last simulated event
          * and correct for unmatched deltas */
          this.fixDeltas(recordDeltas, replayDeltas, this.lastReplayTarget);
        }

        /* Resnapshot to record the changes caused by fixing the deltas */
        this.resnapshotBefore(target);
      }
      this.lastReplayEvent = replayEvent;
      this.lastReplayTarget = target;
    }
  }

  /**
   * Reset all of the record-time variables.
   */
  public resetRecord() {
    this.lastRecordEvent = null;
    this.lastRecordSnapshot = undefined;
    this.curRecordSnapshot = undefined;
  }

  /**
   * Update the snapshot.
   */
  public resnapshotBefore(target: HTMLElement) {
    this.curReplaySnapshot.before = Snapshot.snapshotNode(target);
  }

  /**
   * Send an alert that will be displayed in the main panel.
   */
  public sendAlert(msg: string) {
    this.port.postMessage({
      type: 'alert',
      value: msg,
      state: this.recording
    });
  }

  /**
   * Set properties on events, even if they are read-only.
   * @param e the event
   * @param prop the property
   * @param value the value
   */
  public setEventProp(e: Event & Indexable, prop: string, value: any) {
    try {
      if (e[prop] !== value) {
        e[prop] = value;
      }
    } catch (err) {}

    try {
      if (e[prop] !== value) {
        Object.defineProperty(e, prop, { value: value });
      }
    } catch (err) {}
  
    try {
      if (e[prop] !== value) {
        let v = value;
        Object.defineProperty(e, prop, {
          get: () => v,
          set: (arg) => { v = arg; }
        });
        Object.defineProperty(e, prop, { value: v });
      }
    } catch (err) {
      this.replayLog.log(err);
    }
  }

  /**
   * Try simulating again in a bit of time.
   * @param events events to simulate
   * @param startIndex
   * @param timeout time until retry
   */
  public setRetry(events: RecordedRingerEvent[], startIndex: number,
      timeout: number) {
    const self = this;
    this.retryTimeout = setTimeout(() => {
      self.simulate(events, startIndex);
    }, timeout);
    return;
  }

  /**
   * Replays a set of events atomically.
   * @param events The current list of events to replay.
   * @param startIndex The index into {@link events} which needs to be
   *     replayed.
   */
  public simulate(events: RecordedRingerEvent[], startIndex: number) {
    /* since we are simulating new events, lets clear out any retries from
    * the last request */
    this.clearRetry();

    this.simulatedEvents = events;
    this.simulatedEventsIdx = 0;

    for (let i = startIndex; i < events.length; ++i) {
      /* Should not replay non-dom events here */
      if (events[i].type !== 'dom') {
        this.replayLog.error('Simulating unknown event type');
        throw new ReferenceError('Unknown event type');
      }
      
      const eventRecord = <DOMRingerEvent> events[i];

      const eventData = eventRecord.data;
      const eventName = eventData.type;

      /* this event was detected by the recorder, so lets skip it */
      if (RingerParams.params.replay.cascadeCheck && eventRecord.replayed) {
        continue;
      }

      /* handle any event replaying the addons need */
      for (const addonHandler of this.addonPreTarget) {
        addonHandler(eventRecord);
      }

      this.replayLog.debug('simulating:', eventName, eventData);

      let target = null;
      let targetInfo: TargetInfo | null = null;
      if (this.addonTarget.length > 0) {
        // use the addon's target
        for (const addonHandler of this.addonTarget) {
          target = addonHandler(eventRecord);
          if (target) {
            break;
          }
        }
      } else {
        targetInfo = <TargetInfo> eventRecord.target;
        // const xpath = targetInfo.xpath;
    
        /* find the target */
        target = Target.getTarget(targetInfo);
      }

      // for debugging purposes it's sometimes helpful to fake node finding
      //   failures
      /*
      if (Math.random() < 0.1){
        this.port.postMessage({
          type: 'findNodeWithoutRequiredFeatures',
          value: null, state: recording});
        setRetry(events, i, params.replay.defaultWait);
        return;
      }
      */

      // there are some cases where we're sure we have no node, in which case we
      //   should just continue
      if (target === TargetStatus.REQUIRED_FEATURE_FAILED_CERTAIN ||
          target === TargetStatus.TIMED_OUT_CERTAIN) {
        i++;
        this.setRetry(events, i, 0); // todo: is waiting 0 here ok?
        return;
      }

      if (!target && eventRecord.data.type === "blur") {
        // never wait to run blur event on node that doesn't currently exist. 
        //   doesn't make any sense to do that
        this.replayLog.warn(
          'timeout finding target for blur event, skip event: ', events, i);
        // we timed out with this target, so lets skip the event
        i++;
      }

      /* if no target exists, lets try to dispatch this event a little bit in
       * the future, and hope the page changes */
      if (!target || target === TargetStatus.REQUIRED_FEATURE_FAILED) {
        if (this.checkTimeout(events, i)) {
          if (target === TargetStatus.REQUIRED_FEATURE_FAILED &&
              eventRecord.additional.scrape) {
            if (!targetInfo) {
              throw new ReferenceError("TargetInfo is null.");
            }
            // if we have a required feature failure, but it's just a scraping
            //   event, go ahead and just don't scrape anything
            const reqFeatures = <string[]> targetInfo.requiredFeatures;
            const reqValues = reqFeatures.map((f) =>
              (<TargetInfo> targetInfo).snapshot[f]);
            this.replayLog.warn(
              'REQUIREDFEATUREFAILURE finding scraping target, skip event: ',
              events, i, reqFeatures, reqValues);
            Target.markAsMissingFeatures(targetInfo);
            // we timed out with this target, so lets skip the event
            i++;
          } else if (target === TargetStatus.REQUIRED_FEATURE_FAILED) {
            // if we have a required feature failure and it's a node with which
            //   we need to interact, should fail here or let top-level tool
            //   decide
            // todo: is this really where we shoudl be making these calls?
            console.log(eventName, eventData, eventRecord);
            // this is a special case, because the user has insisted on a few
            //   special features, and we want
            // the top-level tool to be allowed to decide what happens if node
            //   addressing fails in this case
            // so there will be a special error handler at the mainpanel for this
            this.port.postMessage({
              type: 'findNodeWithoutRequiredFeatures',
              value: null,
              state: this.recording
            });
          } else {
            if (!targetInfo) {
              throw new ReferenceError("TargetInfo is null.");
            }

            // todo: is this really what we want?  perhaps we should let the
            //   higher-level tool know what happened
            // we can thus let it pick the strategy.  perhaps when it isn't
            //   found, we should quit
            this.replayLog.warn('timeout finding target, skip event: ', events,
              i);
            Target.markTimedOut(targetInfo);
            // we timed out with this target, so lets skip the event
            i++;
          }
        }

        this.setRetry(events, i, RingerParams.params.replay.defaultWait);
        return;
      }

      if (RingerParams.params.replay.highlightTarget) {
        if (!["blur", "focus"].includes(eventName)){
          Highlight.highlightNode(<HTMLElement> target, 100);
        }
      }
          
      // additional handlers should run in replay only if ran in record
      for (const key in this.additional_recording_handlers_on) {
        this.additional_recording_handlers_on[key] = false;
      }
      for (const key in eventRecord.additional) {
        this.additional_recording_handlers_on[key] = true;
      }
      // want to copy over any data in additionalData, so let's remember what's
      //   in current event object's additionalData field
      this.additional_recording_handlers_on.___additionalData___ = true;
      this.additional_recording_handlers.___additionalData___ = () => {
        if (eventRecord.additional &&
            eventRecord.additional.___additionalData___) {
          return eventRecord.additional.___additionalData___; 
        }
        return {};
      };

      /* Create an event object to mimick the recorded event */
      const eventType = this.getEventType(eventName);
      const defaultProperties = this.getEventProps(eventName);

      if (!eventType) {
        this.replayLog.error("can't find event type ", eventName);
        return;
      }

      const options = jQuery.extend({}, defaultProperties, eventData);

      // sometimes to adapt a script from mac to linux, want to switch from
      //   metakey pressed to ctrl key pressed
      if (eventData.ctrlKeyOnLinux &&
          window.navigator.platform.indexOf("Linux") > -1){
        options.ctrlKey = true;
      }
      // sometimes to adapt a script from linux to mac, want to switch from ctrl
      //   pressed to meta key pressed
      if (eventData.metaKeyOnMac &&
          window.navigator.platform.indexOf("Mac") > -1){
        options.metaKey = true;
      }

      let oEvent: Event & Indexable = document.createEvent(eventType);
      if (eventType === 'Event') {
        oEvent = new Event(eventName, {
          bubbles: options.bubbles,
          cancelable: options.cancelable
        });
      } else if (eventType === 'FocusEvent') {
        let relatedTarget = null;

        if (eventRecord.relatedTarget) {
          relatedTarget = Target.getTarget(eventData.relatedTarget);
        }

        oEvent = new UIEvent(eventName, {
          bubbles: options.bubbles,
          cancelable: options.cancelable,
          detail: options.detail,
          view: document.defaultView
        });
        this.setEventProp(oEvent, 'relatedTarget', relatedTarget);
      } else if (eventType == 'MouseEvent') {
        let relatedTarget = null;

        if (eventRecord.relatedTarget) {
          let foundRelatedTarget = Target.getTarget(eventRecord.relatedTarget);
          if (foundRelatedTarget instanceof Node) {
            relatedTarget = foundRelatedTarget;
          }
        }

        oEvent = new MouseEvent(eventName, {
          altKey: options.altKey,
          bubbles: options.bubbles,
          button: options.button,
          cancelable: options.cancelable,
          clientX: options.clientX,
          clientY: options.clientY,
          ctrlKey: options.ctrlKey,
          detail: options.detail,
          metaKey: options.metaKey,
          relatedTarget: relatedTarget,
          screenX: options.screenX,
          screenY: options.screenY,
          shiftKey: options.shiftKey,
          view: document.defaultView
        });
      } else if (eventType == 'KeyboardEvent') {
        // TODO: nonstandard initKeyboardEvent
        oEvent = new KeyboardEvent(eventName, {
          altKey: options.altKey,
          bubbles: options.bubbles,
          cancelable: options.cancelable,
          ctrlKey: options.ctrlKey,
          key: options.keyIdentifier,
          location: options.keyLocation,
          metaKey: options.metaKey,
          shiftKey: options.shiftKey,
          view: document.defaultView
        });

        const propsToSet = ['charCode', 'keyCode'];

        for (const prop of propsToSet) {
          this.setEventProp(oEvent, prop, options[prop]);
        }
      } else if (eventType == 'TextEvent') {
        oEvent = new InputEvent(eventName, {
          bubbles: options.bubbles,
          cancelable: options.cancelable,
          data: options.data,
          inputType: options.inputMethod,
          // locale: options.locale,
          view: document.defaultView
        });
      } else {
        this.replayLog.error('unknown type of event');
      }

      /* used to detect extension generated events */
      oEvent.extensionGenerated = true;
      if (eventData.cascading) {
        oEvent.cascading = eventData.cascading;
        oEvent.cascadingOrigin = eventData.cascadingOrigin;
      }

      this.replayLog.debug(`[${this.frameId}] dispatchEvent`, eventName,
        options, target, oEvent);

      /* send the update to the injected script so that the event can be 
      * updated on the pages's context */
      const detail: { [key: string]: any } = {};
      for (const prop in oEvent) {
        const data = oEvent[prop];
        const type = typeof(data);

        if (type === 'number' || type === 'boolean' || type === 'string' ||
            type === 'undefined') {
          detail[prop] = data;
        } else if (prop === 'relatedTarget' && data instanceof HTMLElement) {
          detail[prop] = DOMUtils.nodeToXPath(data);
        }
      }
      document.dispatchEvent(new CustomEvent('webscript', { detail: detail }));

      /* update panel showing event was sent */
      this.sendAlert('Dispatched event: ' + eventData.type);

      /* handle any event replaying the addons need */
      for (const preReplayHandler of this.addonPreReplay) {
        preReplayHandler(target, oEvent, eventRecord, events);
      }

      // sometimes a tool will want to force us to set a target property before
      //   dispatching event
      if (eventRecord.meta.forceProp) {
        for (const key in eventRecord.meta.forceProp){
          target = <Indexable & Node> target;
          target[key] = eventRecord.meta.forceProp[key];
        }
      }

      /* actually dispatch the event */ 
      this.dispatchingEvent = true;
      target.dispatchEvent(oEvent);
      this.dispatchingEvent = false;
    }
    /* let the background page know that all the events were replayed (its
    * possible some/all events were skipped) */
    this.port.postMessage({
      type: 'ack',
      value: { type: ReplayAckStatus.SUCCESS },
      state: this.recording
    });
    this.replayLog.debug('sent ack: ', this.frameId);
  }


  /**
   * Create a snapshot of the target element.
   */
  public snapshotRecord(target: HTMLElement) {
    this.lastRecordSnapshot = this.curRecordSnapshot;
    if (this.lastRecordSnapshot)
      this.lastRecordSnapshot.after =
        Snapshot.snapshotNode(this.lastRecordSnapshot.target);

    this.curRecordSnapshot = {
      before: Snapshot.snapshotNode(target),
      target: target
    };
  }

  /**
   * Take a snapshot of the target.
   * @param target
   */
  public snapshotReplay(target: HTMLElement) {
    this.replayLog.log('snapshot target:', target);
    this.lastReplaySnapshot = this.curReplaySnapshot;
    if (this.lastReplaySnapshot) {
      this.lastReplaySnapshot.after =
        Snapshot.snapshotNode(this.lastReplaySnapshot.target);
    }

    this.curReplaySnapshot = {
      before: Snapshot.snapshotNode(target),
      target: target
    };
  }

  /**
   * Update the deltas for the previous event.
   * @param target the event target
   */
  public updateDeltas(target?: HTMLElement) {
    if (target) {
      this.snapshotRecord(target);
    }

    if (this.lastRecordEvent && this.lastRecordSnapshot) {
      const deltas = Snapshot.getDeltas(this.lastRecordSnapshot.before,
        this.lastRecordSnapshot.after);
      this.lastRecordEvent.deltas = deltas;
      var update = {
        type: 'updateEvent',
        value: {
          pageEventId: this.lastRecordEvent.meta.pageEventId,
          updates: [
            {
              field: 'meta.deltas',
              value: deltas
            },
            {
              field: 'meta.nodeSnapshot', 
              value: Snapshot.snapshotNode(this.lastRecordSnapshot.target)
            }
          ]
        },
        state: this.recording
      };
      this.port.postMessage(update);
    }
  }

  /**
   * Sends a message indicating an update to an existing event.
   * @param eventMessage event to update
   * @param field field of event to update
   * @param value value of event to update
   */
  public updateExistingEvent(eventMessage: DOMRingerEvent, field: string,
      value: string) {
    const update = {
      type: 'updateEvent',
      value: {
        pageEventId: eventMessage.meta.pageEventId,
        updates: [
          {
            field: field,
            value: value
          }
        ]
      },
      state: this.recording
    };
    this.port.postMessage(update);
  }


  /**
   * Update the parameters for this script's scope.
   * @param newParams
   */
  public updateParams(newParams: IRingerParams) {
    const oldParams = RingerParams.params;
    RingerParams.params = newParams;

    const oldEvents = oldParams.events;
    const events = RingerParams.params.events;

    // if we are listening to all events, then we don't need to do anything
    //   since we should have already added listeners to all events at the very
    //   beginning
    if (RingerParams.params.record.listenToAllEvents) {
      return;
    }

    for (const eventType in events) {
      const listOfEvents = events[eventType];
      const oldListOfEvents = oldEvents[eventType];
      for (const e in listOfEvents) {
        if (listOfEvents[e] && !oldListOfEvents[e]) {
          this.log.log(`[${this.frameId}] extension listening for ${e}`);
          document.addEventListener(e, this.recordEvent.bind(this), true);
        } else if (!listOfEvents[e] && oldListOfEvents[e]) {
          this.log.log(`[${this.frameId}] extension stopped listening for ${e}`);
          document.removeEventListener(e, this.recordEvent.bind(this), true);
        }
      }
    }
  }
}

/*
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
}*/

// TODO(sbarman): need to wrap these so variables don't escape into the
// enclosing scope
//injectScripts(["scripts/lib/record-replay/common_params.js", 
//               "scripts/lib/record-replay/content_dom.js",
//               "scripts/lib/record-replay/content_injected.js"]);
 