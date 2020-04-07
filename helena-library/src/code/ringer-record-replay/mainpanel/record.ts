import { PortManager } from "./port_manager";
import { RingerMessage, UpdateEventMessage, RecordState } from "../common/messages";
import { RingerEvent, RecordedRingerEvent } from "../common/event";
import { Indexable } from "../common/utils";
import { Logs } from "../common/logs";

/**
 * Handles recording of events from the content scripts.
 */
export class Record {
  public events: RecordedRingerEvent[];
  public lastTime: number;
  public listeners: ((msg: RingerMessage) => void)[];
  public log = Logs.getLog('record');
  public ports: PortManager;
  public recordState: RecordState;
  public scriptId?: number;

  constructor(ports: PortManager) {
    this.ports = ports;
    this.listeners = [];

    this.reset();
  }

  /**
   * Add the event to be recorded.
   *
   * @param e Details of about the saved event
   * @param portId Optional name of the port for the event
   * @param index Index where put the event. Defaults to the end of the event
   *   array if undefined
   *
   * @returns id assigned to the event
   */
  public addEvent(e: RingerEvent, portId?: string, index?: number) {
    this.log.log('added event:', e, portId);

    const recordedEv = <RecordedRingerEvent> e;

    // Check if the event is coming from a content script
    if (portId) {
      const ports = this.ports;
      const tab = ports.getTabId(portId);
      const win = ports.getWindowId(portId);
      const tabInfo = ports.getTabInfo(tab);
      
      const topURL = tabInfo?.top?.URL;
      if (!topURL) {
        throw new ReferenceError("Tab had no topURL.");
      }

      let iframeIndex = -1;
      let topFrame = (tabInfo?.top?.portId === portId);

      if (topFrame) {
        topFrame = true;
      } else {
        topFrame = false;
        const frames = tabInfo?.frames;
        if (frames) {
          for (let i = 0; i < frames.length; ++i) {
            if (frames[i].portId == portId) {
              iframeIndex = i;
              break;
            }
          }
        }
      }

      recordedEv.frame.port = portId;
      recordedEv.frame.topURL = topURL;
      recordedEv.frame.topFrame = topFrame;
      recordedEv.frame.iframeIndex = iframeIndex;
      recordedEv.frame.tab = tab;
      recordedEv.frame.windowId = win;
    }

    // Save timing info
    const time = recordedEv.data.timeStamp;
    const lastTime = this.lastTime;
    let waitTime;
    if (lastTime === 0) {
      waitTime = 0;
    } else {
      // the time to wait between running the last event and running this one.
      waitTime = time - lastTime;
    }

    if (!e.timing) {
      recordedEv.timing = {
        waitTime: waitTime
      };
    } else {
      recordedEv.timing.waitTime = waitTime;
    }
    this.lastTime = time;

    // Give this event an unique id
    const events = this.events;
    if (!e.meta) {
      recordedEv.meta = {
        id: 'event' + events.length
      };
    } else {
      recordedEv.meta.id = 'event' + events.length;
    }

    if (index === undefined) {
      this.events.push(recordedEv);
      this.updateListeners({
        type: 'event',
        value: { event: recordedEv }
      });
    } else {
      this.events.splice(index, 0, recordedEv);
      this.updateListeners({
        type: 'event', 
        value: {
          event: recordedEv,
          index: index
        }
      });
    }
    return recordedEv.meta.id;
  }

  /**
   * Add a listener.
   * @param listener 
   */
  public addListener(listener: (msg: RingerMessage) => void) {
    this.listeners.push(listener);
  }

  /**
   * Get event, given an event id.
   * @param eventId
   */
  public getEvent(eventId: string) {
    if (!this.events) {
      return null;
    }

    for (const e of this.events) {
      if (e.meta?.id === eventId) 
        return e;
    }
    return null;
  }

  /**
   * Create a copy of the events recorded.
   */
  public getEvents(): RecordedRingerEvent[] {
    return jQuery.extend(true, [], this.events);
  }

  /**
   * Get the script id.
   */
  public getScriptId() {
    return this.scriptId;
  }

  /**
   * Get current record state.
   */
  public getStatus() {
    return this.recordState;
  }

  /**
   * Reset recording state.
   */
  public reset() {
    this.updateStatus(RecordState.STOPPED);
    this.scriptId = undefined;
    this.events = [];
    // the time the last event was recorded
    this.lastTime = 0;

    this.updateListeners({
      type: 'reset',
      value: null
    });
    this.ports.sendToAll({
      type: 'reset', 
      value: null
    });
  }

  /**
   * Set the recorded events.
   */
  public setEvents(events: RecordedRingerEvent[]) {
    this.reset();
    this.events = events;
    for (const event of events) {
      this.updateListeners({
        type: 'event',
        value: { event: event }
      });
    }
  }

  /**
   * Set the script id.
   * @param id
   */
  public setScriptId(id?: number) {
    this.scriptId = id;
  }

  /**
   * Begin recording events.
   *
   * @param replaying Whether we are recording a user's interactions or the
   *   events raised by the replayer. 
   */
  public startRecording(replaying: boolean) {
    this.log.log('starting record');
    const s = replaying ? RecordState.REPLAYING : RecordState.RECORDING;
    this.updateStatus(s);

    // Tell the content scripts to begin recording
    this.ports.sendToAll({
      type: 'recording',
      value: this.getStatus()
    });
  }


  /**
   * Stop recording.
   */
  public stopRecording() {
    this.log.log('stopping record');
    this.updateStatus(RecordState.STOPPED);

    // Tell the content scripts to stop recording
    this.ports.sendToAll({
      type: 'stop',
      value: null
    });
    this.ports.sendToAll({
      type: 'recording',
      value: this.getStatus()
    });
  }


  /**
   * Update the properties of an event. {@link request} should contain the
   * pageEventId so that the event can be matched.
   *
   * @param request Updates to be made and meta data used to identify event
   * @param portId id of port which requests came through
   */
  public updateEvent(request: UpdateEventMessage, portId: string) {
    const pageEventId = request.pageEventId;
    const updates = request.updates;

    this.log.log('updating event:', updates, pageEventId);

    const events = this.events;

    for (let i = events.length - 1; i >= 0; --i) {
      const value = events[i];
      // Check if its the right event
      if (value.frame && value.frame.port === portId &&
          value.meta && value.meta.pageEventId === pageEventId) {
        const id = value.meta.id;
        for (const u of updates) {
          this.userUpdate(id, u.field, u.value); 
        }
        break;
      }
    }
  }

  /**
   * Update all listeners with message.
   * @param msg 
   */
  public updateListeners(msg: RingerMessage) {
    for (const listener of this.listeners) {
      listener(msg);
    }
  }

  /**
   * Update recording state.
   * @param newStatus 
   */
  public updateStatus(newStatus: RecordState) {
    this.recordState = newStatus;
    this.updateListeners({
      type: 'status',
      value: 'record:' + newStatus
    });
    this.ports.sendToAll({
      type: 'recording',
      value: newStatus
    });
  }


  /**
   * Finds the event based upon the eventId and updates the event's
   *   {@link field} to {@link newVal}.
   * @param eventId
   * @param field
   * @param newVal
   */
  public userUpdate(eventId: string, field: string, newVal: any) {
    const updateProp = (obj: Indexable, path: string[], i: number) => {
      if (i === path.length - 1) {
        obj[path[i]] = newVal;
      } else {
        updateProp(obj[path[i]], path, i + 1);
      }
    }

    for (const event of this.events) {
      if (event.meta?.id === eventId) {
        updateProp(event, field.split('.'), 0);
      }
    }
  }
}