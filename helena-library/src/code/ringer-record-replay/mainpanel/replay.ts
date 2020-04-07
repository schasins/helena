import { PortManager } from "./port_manager";
import { User } from "./user";
import { Record } from "./record";
import { RingerMessage, ReplayAckStatus } from "../common/messages";
import { RingerEvents, RecordedRingerEvent, RecordedRingerFrameInfo } from "../common/event";
import { Utilities } from "../common/utils";
import { HelenaConsole } from "../../common/utils/helena_console";
import { Logs } from "../common/logs";
import { BrokenPortStrategy, TimingStrategy, RingerParams } from "../common/params";

enum ReplayState {
  STOPPED = 'stopped',
  REPLAYING = 'replaying', // replaying the next command
  ACK = 'ack' // waiting for an ack from the content script
}

interface ReplayTimeoutInfo {
  startTime: number;
  index: number;
}

export interface ReplayConfig {
  frameMapping?: { [key: string]: string };
  scriptId?: number;
  tabMapping?: { [key: string]: number };
  targetWindowId?: number;
}

export type ErrorContinuations = {
  [key: string]: (replay: Replay, ringerCont: Function | null) => void
}

export interface ScriptServer {
  saveScript: (id: string, replayEvents: RecordedRingerEvent[],
    scriptId: number, whatsthis: string) => void;
}

interface ReplayAck {
  setTimeout?: boolean;
  type: ReplayAckStatus;
}

/**
 * Handles replaying scripts.
 */
export class Replay {
  public static replayableEvents = ['dom', 'completed', 'manualload',
    'webnavigation'];

  public ack: ReplayAck | null;    // stores responses from the content script
  public ackPort: string;
  public addonReset: ((replay: Replay) => void)[];
  public addonTiming: ((replay: Replay) => number)[];
  public callbackHandle: number | null;
  
  // callback executed after replay has finished
  public cont: ((replay: Replay) => void) | null;

  private currentCompletedObservationFailures: number;

  // stores # of failures to find port for given event
  private currentPortMappingFailures: number;

  public errorConts: ErrorContinuations;
  public events: RecordedRingerEvent[]; 
  public firstEventReplayed: boolean;
  public index: number;       // current event index
  public listeners: ((msg: RingerMessage) => void)[];
  private log = Logs.getLog('replay');

  // whether a completed event has happened
  public matchedCompletedEvents: number[];
  
  // mapping record ports and replay ports
  public portMapping: { [key: string]: chrome.runtime.Port };

  public ports: PortManager;
  public record: Record;
  public replayState: ReplayState;

  // links replayed events with the original recording
  public scriptId: number | null;

  public scriptServer: ScriptServer | null;
  public startTime: number;
  
  // mapping record tabs and replay tabs
  public tabMapping: { [key: string]: number};

  public targetWindowId?: number;
  public time?: number;
  public timeoutInfo: ReplayTimeoutInfo;
  public user: User;

  constructor(ports: PortManager, scriptServer: null, user: User) {
    this.addonReset = [];
    this.addonTiming = [];
    this.currentCompletedObservationFailures = 0;
    this.currentPortMappingFailures = 0;
    this.ports = ports;
    this.scriptServer = scriptServer;
    /* The user interface to interact with the replayer */
    this.user = user;
    this.record = new Record(ports);
    this.listeners = [];

    this.reset();
  }

  /**
   * Add a listener.
   * @param listener 
   */
  public addListener(listener: (msg: RingerMessage) => void) {
    this.listeners.push(listener);
  }

  /**
   * Check if an event has already been replayed.
   * @param ev
   */
  private checkReplayed(ev: RecordedRingerEvent) {
    for (const recordedEvent of this.record.events) {
      if (recordedEvent.meta.recordId === ev.meta.id)
        return true;
    }
    return false;
  }

  /**
   * Check if executing an event has timed out.
   */
  private checkTimeout() {
    const eventTimeout = RingerParams.params.replay.eventTimeout;
    if (eventTimeout !== null && eventTimeout > 0) {
      const timeoutInfo = this.timeoutInfo;
      const curTime = new Date().getTime();

      // we havent changed events
      const index = this.index;
      if (timeoutInfo.index === index) {
        if (curTime - timeoutInfo.startTime > eventTimeout * 1000) {
          return true;
        }
      } else {
        this.timeoutInfo = {startTime: curTime, index: index};
      }
    }
    return false;
  }

  /**
   * Dispatches events to the content script.
   */
  private dispatchToContentScript() {
    if (this.checkTimeout()) {
      // lets call the end of this script
      const msg = `event ${this.index} has timed out`;
      this.log.log(msg);
      this.finish();
      return;
    }

    if (this.getStatus() === ReplayState.ACK) {
      const ack = this.ack;
      if (!ack) {
        // usually this means we want to keep waiting, but sometimes the port
        //   has disappeared, in which case a navigation probably happened
        //   before the replay ack could be sent, so then we should assume
        //   that's what the port's disappearance means
        if (!this.ports.portIdToPort[this.ackPort]) {
          this.log.log("ack port is actually gone; assume port disappearance " +
            "means success");
          this.incrementIndex();
          this.setNextTimeout();
          this.updateStatus(ReplayState.REPLAYING);
        }
        this.setNextTimeout(RingerParams.params.replay.defaultWait);
        this.log.log('continue waiting for replay ack');
        return;
      }

      const type = ack.type;
      if (type === ReplayAckStatus.SUCCESS) {
        this.log.log('found replay ack');
        this.incrementIndex();
        this.setNextTimeout();

        this.updateStatus(ReplayState.REPLAYING);
      } else if (type === ReplayAckStatus.PARTIAL) {
        throw new ReferenceError('partially executed commands');
      }
      return;
    }

    const events = this.events;
    const index = this.index;

    /* check if the script finished */
    // console.log("index", index, events.length);
    // console.log(events[index]);
    if (index >= events.length) {
      //no more events to actively replay, but may need to wait for some
      //console.log(index, "done with script");
      this.finish();
      return;
    }

    const e = events[index];
    const type = e.type;
    // console.log("event running", e);

    // Find the replay function associated with the event type
    if (Replay.replayableEvents.includes(type)) {
      if (type === 'dom') {
        this.simulateDomEvent(e);
      } else if (type === 'completed') {
        this.simulateCompletedEvent(e);
      } else if (type === 'manualload') {
        this.simulateManualLoadEvent(e);
      } else if (type === 'webnavigation') {
        this.simulateWebNavigationEvent(e);
      } else {
        throw new ReferenceError("Replayable event with unspecified behavior");
      }
    } else {
      this.log.log('skipping event:', e);
      this.incrementIndex();
      this.setNextTimeout(0);
    }
  }

  /**
   * Looks for a node when required features failed.
   */
  public findNodeWithoutRequiredFeatures() {
    // todo: eventually this should actually provide a continuation as an
    //   argument!  null is wrong!
    if (this.errorConts && this.errorConts.findNodeWithoutRequiredFeatures) {
      this.stopReplay();
      this.errorConts.findNodeWithoutRequiredFeatures(this, null);
    }
  }

  /**
   * Given the frame information from the recorded trace, find a 
   * corresponding port.
   * @param newTabId
   */ 
  private findPortInTab(newTabId: number, frame: RecordedRingerFrameInfo) {
    const ports = this.ports;
    const portInfo = ports.getTabInfo(newTabId);
    this.log.log('trying to find port in tab:', portInfo);

    if (!portInfo) {
      return null;
    }

    // if it's the top frame, use that
    if (frame.topFrame) {
      this.log.log('assume port is top level page');
      const topFrame = portInfo.top;
      if (topFrame && topFrame.portId) {
        return ports.getPort(topFrame.portId);
      }
    } else {
      // if it's an iframe, find all frames with matching urls
      this.log.log('try to find port in one of the iframes');
      var frames = portInfo.frames;

      let bestFrameSoFar = null;
      let bestFrameDistanceSoFar = 99999;
      for (let i = 0; i < frames.length; i++) {
        const distance = Utilities.levenshteinDistance(frames[i].URL, frame.URL);
        if (distance < bestFrameDistanceSoFar){
          bestFrameSoFar = frames[i];
          bestFrameDistanceSoFar = distance;
        }
        if (distance === bestFrameDistanceSoFar) {
          this.log.warn("have multiple iframes with same distance, might be " +
            "the best distance:", bestFrameSoFar, frames[i]);
        }
      }

      // no matching frames
      if (!(bestFrameSoFar && bestFrameSoFar.portId)) {
        return null;
      } else {
        return ports.getPort(bestFrameSoFar.portId);
      }
    }
    return null;
  }

  /**
   * Replay has finished, and now we need to call the continuation.
   */
  private finish() {
    const self = this;
  
    this.log.log('finishing replay');

    if (this.getStatus() === ReplayState.STOPPED) {
      return;
    }

    this.updateStatus(ReplayState.STOPPED);

    this.pause();

    this.time = new Date().getTime() - this.startTime;
    this.record.stopRecording();

    // save the recorded replay execution
    setTimeout(() => {
      const replayEvents = self.record.getEvents();
      const scriptId = self.scriptId;

      if (RingerParams.params.replay.saveReplay && scriptId &&
          replayEvents.length > 0) {
        self.scriptServer?.saveScript('replay ' + scriptId, replayEvents,
          scriptId, "");
        self.log.log('saving replay:', replayEvents);
      }
    }, 1000);

    setTimeout(() => {
      if (self.cont) {
        self.cont(self);
      }
    }, 0);
  }

  /**
   * Get event, given an event id.
   * @param eventId
   */
  public getEvent(eventId?: string) {
    if (!this.events || !eventId) {
      return null;
    }

    for (const e of this.events) {
      if (e.meta?.id === eventId) {
        return e;
      }
    }
    return null;
  }

  /**
   * Given an event, find the corresponding port
   * @param 
   */
  private getMatchingPort(ev: RecordedRingerEvent) {
    const self = this;
    const portMapping = this.portMapping;
    const tabMapping = this.tabMapping;

    const frame = ev.frame;
    const port = frame.port;
    const tab = frame.tab;

    // lets find the corresponding port
    let replayPort = null;
    // we have already seen this port, reuse existing mapping
    if (port in portMapping) {
      replayPort = portMapping[port];
      //if (gpmdebug) {console.log("gpm: port in portMapping", portMapping);}
      this.log.log('port already seen', replayPort);
    } else if (tab in tabMapping) {
      // we have already seen this tab, find equivalent port for tab
      //   for now we will just choose the last port added from this tab
      // todo: woah, just grabbing the last port from the tab doesn't seem ok
      replayPort = this.findPortInTab(tabMapping[tab], frame);

      if (replayPort) {
        // tab already seen, found port
        portMapping[port] = replayPort;
      } else {
        // tab already seen, no port found
        this.setNextTimeout(RingerParams.params.replay.defaultWait);
        
        // we can get into a loop here if (for example) we use a next button to
        //   try to get to the next page of a list
        // so we actually know the right tab because it's the same page where we
        //   had the list in the past
        // but if the network has gone down for a moment or something else went
        //   wrong during loading the next page
        // there would be no ports associated with the tab?
        
        // todo: should probably actually have our own counter for this, in case
        //   the tab just loaded at this particular iteration or something
        if (this.currentPortMappingFailures > 0 &&
           (this.currentPortMappingFailures % 50) === 0) {

          // let's see if there are no ports associated with the tab we should
          //   be using, and let's reload
          const portInfo = this.ports.getTabInfo(tabMapping[tab]);
          if (!portInfo || !(portInfo.top)) {
            // why don't we have port info for the tab that we think is the
            //   right tab?  try reloading
            chrome.tabs.reload(tabMapping[tab], {}, () => {
              // it's reloaded. not actually anything to do here I don't think
            });
          }
        }

        // todo: this may be a place to do some kind of recovery by actually
        //   reloading the tab
      }
    } else {
      // nothing matched, so we need to open new tab
      const allTabs = Object.keys(this.ports.tabIdToTab).map(
        (tabId) => parseInt(tabId));

      // create list of all current tabs that are mapped to
      const revMapping: { [key: number]: boolean } = {};
      for (const t in tabMapping) {
        revMapping[tabMapping[t]] = true;
      }

      // find all tabs that are in the target window, but are not mapped to
      const unusedTabs = [];
      for (const tabId of allTabs) {
        if (!revMapping[tabId]) {
          // now make sure it's actually in the target window, if there is one
          if (!this.targetWindowId ||
              this.targetWindowId === this.ports.tabIdToWindowId[tabId]) {
            unusedTabs.push(tabId);
          }
        }
      }

      // if this is not the first event, and there is exactly one unmapped
      //   tab, then lets assume this new tab should match

      // if 2, one is our initial tab that explains the recording process, and
      //   the other must be the tab we want
      if (unusedTabs.length === 1) {
        // go ahead and make a mapping and then try going through the whole
        //   process again
        tabMapping[frame.tab] = unusedTabs[0];
        this.setNextTimeout(0);
        return;
      }

      // todo: ensure commenting out the below is acceptable. for now relying on
      //   completed events marked forceReplay to make sure we load everything
      //   that doesn't get loaded by dom events

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

      // High level goal here:
      // Check this.events against this.record.events for a load in the same
      //   position in the trace
      // We want to look back through this.events (the events to replay) for an
      //   event of type 'completed' that has the same frame as the one we're
      //   trying to replay to now then look through this.record.events (the
      //   events we've actually seen) for a corresponding 'completed' event.
      //   Whatever port that one had, use it.  And update the port mapping.
      //   Basically we're using when tabs appear as a way to line them up,
      //   build the mapping.

      const recordTimeEvents = this.events;
      const replayTimeEventsSoFar = this.record.events;
      const currEventURL = ev.frame.URL;
      const currEventTabID = ev.frame.tab;
      const currEventIndex = this.index;

      // todo: sometimes it seems like doing this loading time thing gives us
      //   the wrong answer.  when that happens, may want to revisit it after a
      //   while, clear the tabMapping mappings that were made with this, if we
      //   keep looking for a port and failing...

      for (let i = currEventIndex - 1; i >= 0; i--) {
        const e = recordTimeEvents[i];
        let completedCounter = 0;
      
        if (RingerEvents.isComplete(e)) {
          completedCounter++;
          if (e.data.url === currEventURL && e.data.tabId === currEventTabID) {
            // there's a record-time load event with the same url and tab id as 
            //   the event whose frame we're currently trying to find.
            //   we can try lining up this load event with a load event in the
            //   current run
            let completedCounterReplay = 0;
            for (let j = replayTimeEventsSoFar.length - 1; j >= 0; j--){
              const e2 = replayTimeEventsSoFar[j];
              if (RingerEvents.isComplete(e2)) {
                completedCounterReplay++;
                if (completedCounter === completedCounterReplay){
                  //this is the replay-time completed event that lines up with e
                  //  use the frame in which this completed event happened
                  //fix up ports
                  //var e2Frame = ??;
                  //var ports = this.ports;
                  //var replayPort = ports.getPort(e2Frame);
                  //portMapping[port] = replayPort;
                  //return replayPort;

                  // update tabMapping for completed event alignments
                  tabMapping[currEventTabID] = e2.data.tabId;

                  this.setNextTimeout(0);

                  // not returning real port (refreshed tab mapping) so that
                  //   simulateDom event will be called again, and we'll get
                  ///  back here now with good mappings
                  return;
                }
              }
            }
          }
        }
      }
    } // end the kind of top-level else

    if (!replayPort) {
      // Freak out.  We don't know what port to use to replay this event.
      // it may be the tab just isn't ready yet, not added to our mappings yet.
      //   try again in a few.
      this.setNextTimeout(1000);
      // unless...we've been seeing this a lot, in which case this looks like a
      //   real failure
      this.currentPortMappingFailures += 1;
      // below is commented out because now we give up after 120
      /*
      if (this.currentPortMappingFailures >= 10){
        // ok, this is getting ridiculous. seems like the right port isn't arriving...
        this.setNextTimeout(60000);
        console.log("We're going to slow the port checking waaaaaaay down, since this doesn't seem to be working.");
      }
      */
     // === rather than > because we don't want to call handler a bunch of
     //   times, only once
      if (this.currentPortMappingFailures === 120) {
        if (this.errorConts && this.errorConts.portFailure) {
          // now keep in mind that this continuation may never be called if the
          //   top-level tool doesn't want to continue where we left off
          // so any cleanup must happen now
          // for instance, must put the currentPortMappingFailures back to 0
          // by the time this code gets used again, the top level tool should
          //   have fixed it so we can find the port
          this.currentPortMappingFailures = 0;
          // or alternatively it should have decided not to carry on trying to
          //   find the port anymore
          var continuation = () => {
            self.setNextTimeout(0);
          }
          this.stopReplay();
          this.errorConts.portFailure(this, continuation);
        }
      }
      
      // not returning real port
      return null;
    }
    //if (gpmdebug) {console.log(replayPort);}
    this.currentPortMappingFailures = 0;
    //if (gpmdebug) {console.log("gpm: returning real port");}
    return replayPort;
  }

  /**
   * Return the index of the next event that should be replayed.
   */ 
  private getNextReplayableEventIndex() {
    for (let i = this.index; i < this.events.length; ++i) {
      if (this.events[i].type in Replay.replayableEvents) {
        return i;
      }
    }
    return this.events.length;
  }


  /**
   * Return the time in the future the next replayable event should be
   *   executed based upon the current timing strategy.
   */
  private getNextTime() {
    let time;

    for (const timingHandler of this.addonTiming) {
      time = timingHandler.call(this);
      if (typeof time === 'number') {
        return time;
      }
    }

    const timing = RingerParams.params.replay.timingStrategy;

    const curIndex = this.index;
    const nextIndex = this.getNextReplayableEventIndex();
    const events = this.events;
    let waitTime = 0;

    // Check if there are any events to replay
    if (nextIndex >= events.length) {
      return 0;
    }
    if (curIndex === 0) {
      // note: this used to be 1,000, not sure why
      // may need to look into this at some point.
      return 0;
    }

    let defaultTime = 0;
    for (let i = curIndex; i <= nextIndex; ++i) {
      let timeToAdd = events[i].timing.waitTime;
      if (events[i].timing.ignoreWait && timeToAdd > 5) {
        timeToAdd = timeToAdd / 5;
      }
      defaultTime += timeToAdd; 
    }

    if (defaultTime > 10000) {
      defaultTime = 10000;
    }

    if (timing === TimingStrategy.MIMIC) {
      waitTime = defaultTime;
    } else if (timing === TimingStrategy.SPEED) {
      waitTime = 0;
    } else if (timing === TimingStrategy.SLOWER) {
      waitTime = defaultTime * 2;
    } else if (timing === TimingStrategy.SLOWEST) {
      waitTime = defaultTime * 4;
    } else if (timing === TimingStrategy.FIXED_1) {
      waitTime = 1000;
    } else if (timing === TimingStrategy.RANDOM_0_3) {
      waitTime = Math.round(Math.random() * 3000);
    } else if (timing === TimingStrategy.PERTURB_0_3) {
      waitTime = defaultTime + Math.round(Math.random() * 3000);
    } else if (timing === TimingStrategy.PERTURB) {
      var scale = 0.7 + (Math.random() * 0.6);
      waitTime = Math.round(defaultTime * scale);
    } else {
      throw new ReferenceError('unknown timing strategy');
    }

    this.log.log('wait time:', waitTime);
    return waitTime;
  }

  /**
   * Get current replay state.
   */
  public getStatus() {
    return this.replayState;
  }

  /**
   * Increase the index and update the listeners.
   */
  private incrementIndex() {
    this.index += 1;

    if (this.index < this.events.length) {
      const e = this.events[this.index];
      if (e.meta) {
        this.updateListeners({type: 'simulate', value: e.meta.id});
      }
    }
  }

  /*
  private openTabSequenceFromTrace(trace){
    var completed_events = _.filter(trace, function(event){return RingerEvents.isComplete(event);});
    //console.log(completed_events);
    var eventIds = _.map(completed_events, function(event){return event.meta.id});
    return eventIds;
  }*/

  /* Pause the execution by clearing out the callback */
  public pause() {
    var handle = this.callbackHandle;
    if (handle) {
      clearTimeout(handle);
      this.callbackHandle = null;
    }

    /* tell whatever page was trying to execute the last event to pause */
    this.ports.sendToAll({type: 'pauseReplay', value: null});
  }

  /**
   * Receive a replay acknowledgement from the content script.
   * @param ack 
   */
  public receiveAck(ack: ReplayAck) {
    this.ack = ack;
    if (ack.setTimeout) {
      this.setNextTimeout(0);
    }
  }

  /**
   * TODO
   */
  private reloadLastTabIfFailed() {
    const self = this;
    if (this.targetWindowId){
      // for now this is only going to check for failed tabs in the target
      //   window (the window created for replay), and only if there even is a
      //   target window
      chrome.tabs.query({ windowId: this.targetWindowId }, (tabs) => {
        HelenaConsole.log("We think we might have had a tab fail to load, so " +
          "we're going to try reloading.");
        HelenaConsole.log(tabs);
        // we really prefer to only reload the very last tab, but since there's the possibility it might be earlier, we could be willing to go back further
        
        for (let i = tabs.length - 1; i >= 0; i--){
          const tab = tabs[i];
          if (isTabLoadFailed(tab)) {
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
            if (tab.id) {
              chrome.tabs.reload(tab.id, {}, () => {
                // ok, good, it's reloaded.  start checking for completion
                // checkUntilComplete();
                // for now, since even without network connection we'll get the
                //  'complete' status, we don't want to do the loop above
                // because it just ends up looping really really quickly, and I
                //   don't want to crash the extension.  so just wait the whole
                //   5000 (above)
              });
            }
          }
        }
      });
    }
  }

  /**
   * Begin replaying a list of events.
   *
   * @param events List of events
   * @param config
   * @param cont Callback thats executed after replay is finished
   * @param errorConts map from errors to callbacks that should be executed for
   *   those errors
   */
  public replay(events: RecordedRingerEvent[], config: ReplayConfig,
      cont: (replay: Replay) => void, errorConts: ErrorContinuations = {}) {
    this.log.log('starting replay');

    /* Pause and reset and previous executions */
    this.pause();
    this.reset();

    // Record start time for debugging
    this.startTime = new Date().getTime();
  
    // If these events were already replayed, we may need to reset them
    this.events = events;
    for (const event of events) {
      this.resetEvent(event);
    }

    if (config) {
      if (config.scriptId) {
        this.scriptId = config.scriptId;
      }
      
      if (config.frameMapping) {
        const frameMapping = config.frameMapping;
        for (const k in frameMapping) {
          this.portMapping[k] = this.ports.getPort(frameMapping[k]);
        }
      }
      if (config.tabMapping) {
        var tabMapping = config.tabMapping;
        for (var k in tabMapping) {
          this.tabMapping[k] = tabMapping[k];
        }
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
  }

  /**
   * Resets Replay to initial state.
   */
  public reset() {
    // execution proceeds as callbacks so that the page's JS can execute, this
    //   is the handle to the current callback
    this.callbackHandle = null;
    this.updateStatus(ReplayState.STOPPED);

    // record the first execution attempt of the first event
    this.timeoutInfo = {
      startTime: 0,
      index: -1
    };
    
    this.ack = null;

    this.events = [];
  
    this.index = 0;
    this.portMapping = {};
    this.tabMapping = {};
    this.scriptId = null;
    this.cont = null;
    this.firstEventReplayed = false;
    this.startTime = 0;
    this.matchedCompletedEvents = [];

    for (const resetHandler of this.addonReset) {
      resetHandler.call(this);
    }

    this.record.reset();
  }

  /**
   * Remove any information added to an event during replay.
   * @param ev
   */
  private resetEvent(ev: RecordedRingerEvent) {
    if (ev.reset) {
      ev.reset = {};
    }
  }

  /**
   * Set the callback to replay the next event
   *
   * @param time Optional delay when callback should be executed. The
   *     default will use whatever strategy is set in the parameters.
   */
  private setNextTimeout(time?: number) {
    const self = this;
    if (this.callbackHandle) {
      // we'll always choose the next time to run based on the most recent
      //   setNextTimeout, so clear out whatever might already be there 
      clearTimeout(this.callbackHandle);
    }
    if (time === undefined) {
      time = this.getNextTime();
    }

    this.callbackHandle = setTimeout(() => {
      self.dispatchToContentScript();
    }, time);
  }


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
    /*
    public subReplay(events, scriptId, tabMapping, portMapping,
          check, cont, timeout) {
    // copy the properties of the replayer (so they can be later reset)
    var props = Object.keys(this);
    var copy = {};
    for (var i = 0, ii = props.length; i < ii; ++i) {
    var prop = props[i];
    copy[prop] = this[prop];
    }

    // replay the events
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

    // set the mappings
    this.tabMapping = tabMapping;
    this.portMapping = portMapping;

    if (timeout) {
    var timeoutId = setTimeout(function() {
    replay.finish();
    }, timeout);
    }
  }*/

  /*
  public replayOne() {
    //      this.updateStatus(ReplayState.REPLAYING);
    //      this.restart();
  }*/

  /**
   * TODO
   */
  public resend() {
    if (this.getStatus() === ReplayState.ACK) {
      this.updateStatus(ReplayState.REPLAYING);
    }
  }

  /**
   * Restart by setting the next callback immediately.
   */
  public restart() {
    if (this.callbackHandle === null) {
      if (this.getStatus() === ReplayState.ACK) {
        this.updateStatus(ReplayState.REPLAYING);
      }

      this.setNextTimeout(0);
    }
  }

  /** 
   * Replays an event of type "completed".
   * @param ev
   */
  private simulateCompletedEvent(ev: RecordedRingerEvent) {
    const self = this;
    if (ev.forceReplay && (!ev.reset || !(ev.reset.alreadyForced))) {
      //console.log("forcing replay");
      if (!ev.reset) { ev.reset = {}; }
      // enforce that we don't do the forceReplay a second time, but instead 
      //   wait to see the completed event?
      ev.reset.alreadyForced = true;
      const options: chrome.tabs.CreateProperties = {
        active: true,
        url: ev.data.url
      };
      if (this.targetWindowId) {
        options.windowId = this.targetWindowId;
      }
      //console.log("options", options);
      //console.log("event", e);
      chrome.tabs.create(options, () => {
        // not sufficient to treat tab creation as getting an ack. must wait for
        //   it to appear in the replay-time trace
        // that.index ++; // advance to next event
        self.setNextTimeout(0); 
      });
    } else {
      // don't need to do anything
      // this.index ++;
      // this.setNextTimeout(0);

      if (!RingerEvents.isComplete(ev)) {
        // not a top-level load, so assume we can ignore it
        this.index++;
        this.currentCompletedObservationFailures = 0;
        this.setNextTimeout(0);
        return;
      }

      // ok, used to think we don't need to do anything, but really we should
      //   actually wait for the completed event, at least if it's a top-level
      //   one.  let's make sure *something* has appeared in the last 5 or so
      //   events
      // todo: is it really sufficient to just check the last 5 events? if our
      //   assumption about the last dom even causing the completed event is
      //   true, we should expect that it appears after the most recent dom
      //   event
      // can't assume it's the last event, because a top-level load often causes
      //   some script loads, that kind of thing, as well.  and those might have
      //   snuck in.

      // ok, so this may not be quite right, but let's go back to the most
      //   recent DOM event and make sure there's a top-level completed event
      //   somewhere near it
      const replayTimeEvents = this.record.events;
      let completedAfterLastDom = false;
      let bestBetMatchedIndex = null;
      let domIndex = null;
      let completedWithinWindowBeforeDom = false;
      const completedBeforePriorMatchedCompletedEvent = false;
      const win = 5;
      const lastMatchedCompletedEventIndex =
        this.matchedCompletedEvents[this.matchedCompletedEvents.length - 1];
      for (let i = replayTimeEvents.length - 1; i >= 0; i--){
        // debug todo: remove next two lines
        const ev = replayTimeEvents[i];
        // console.log(i, domIndex, ev.type, ev.data);

        // for now, commenting out the below, deciding to be willing to go all
        //   the way back to the last top-level completed event that we've
        //   already matched
        /*
        if (domIndex !== null && i < (domIndex - win)){
          // ok, we've gone too far, we've passed the window around the domIndex
          break;
        }
        */

        if (i <= lastMatchedCompletedEventIndex){
          // ok, we've gone too far.  we've now reached a completed event that
          //   we already matched in the past, so can't use this one again
          break;
        }

        if (domIndex === null && ev.type === "dom"){
          // we've found the last dom event
          domIndex = i;
        } else if (domIndex === null && RingerEvents.isComplete(ev)) {
          // we've found a completed top-level after the last dom event
          completedAfterLastDom = true;
          // don't add this index to matchedCompletedEvents yet, because we
          //   might find something even earlier
          // (some pages do weird things where it looks like the page loads
          //   twice)
          // but if we reach the end of the loop and this is the last one we
          //   found, then we'll use it
          // this.matchedCompletedEvents.push(i);
          bestBetMatchedIndex = i;
        } else if (domIndex !== null && RingerEvents.isComplete(ev)) {
          // since we're still going, but we've found the domIndex already, this
          //   is a completed event before the last dom event
          completedWithinWindowBeforeDom = true;
          this.matchedCompletedEvents.push(i);
          break;
        }
      }
      if (completedAfterLastDom && bestBetMatchedIndex) {
        this.matchedCompletedEvents.push(bestBetMatchedIndex);
      }

      if (completedWithinWindowBeforeDom || completedAfterLastDom) {
        // we've seen a corresponding completed event, don't need to do anything
        this.index ++;
        this.currentCompletedObservationFailures = 0;
        this.setNextTimeout(0);
      } else {
        // one thing that might have happened - some versions of chrome produce
        //   'completed' events while others produce webnavigation onCompletion
        // and some produce both.  but if we try to wait for both on a version
        //   that will only have one, we'll wait forever
        // so here let's check if the url for the event we're waiting for is the
        //   same as the url for the last completion-related event we were
        //   waiting for
        if (this.currentCompletedObservationFailures > 3 && ev.mayBeSkippable) {
          // we think maybe we don't need to see a corresponding completed event
          // so let's not do anything
          this.index ++;
          this.currentCompletedObservationFailures = 0;
          this.setNextTimeout(0);
        }

        // let's give it a while longer
        // todo: as above in waitforobserved events, question of whether it's ok
        //   to keep waiting and waiting for the exact same number of top-level
        //   completed events.  should we give it 10 tries, then just continue?
        // todo: eventually we really do need to surface this to the top-level
        //   tool.  can't just keep looping here forever
        this.currentCompletedObservationFailures += 1;
        if (this.currentCompletedObservationFailures <= 30) {
          // todo: consider raising this or adding backoff.  wonder if this is
          //   the cause of occasional possibly wifi-outage related crashes
          this.setNextTimeout(500);
        } else {
          // ok, this is getting a little ridiculous.  we've tried for 15
          //   seconds and still haven't found anything?
          // it's possible that the network connection went out momentarily and
          //   that we need to go and reload a page.  let's check for something
          //   that looks like it might suggest that, then fix it
          this.reloadLastTabIfFailed();

          // let's also slow down our checks so we don't crash the extension
          this.setNextTimeout(5000);
        }
      }
    }
  }


  /**
   * Replays a DOM event.
   * @param ev
   */
  private simulateDomEvent(ev: RecordedRingerEvent) {
    try {
      // check if event has been replayed, if so skip it
      if (RingerParams.params.replay.cascadeCheck && this.checkReplayed(ev)) {
        this.log.debug('skipping event: ' + ev.type);
        this.incrementIndex();
        this.setNextTimeout();

        this.updateStatus(ReplayState.REPLAYING);
        return;
      }

      const meta = ev.meta;
      this.log.log('background replay:', meta.id, ev);

      const replayPort = this.getMatchingPort(ev);
      if (!replayPort) {
        // it may be that the target tab just isn't ready yet, hasn't been added
        //   to our mappings yet.  may need to try again in a moment.
        // if no matching port, getMatchingPort wiill try again later 
        return;
      }

      // we have a replay port, which also means we know which tab it's going to
      // let's make the tab be the active/visible tab so we can see what's
      //   happening
      if (replayPort.sender?.tab?.id) {
        chrome.tabs.update(replayPort.sender.tab.id, {selected: true});
      }

      // sometimes we use special no-op events to make sure that a page has gone
      //   through our alignment process without actually executing a dom event
      if (ev.data.type === "noop") {
        this.incrementIndex();
        this.setNextTimeout(0);
      }

      // if there is a trigger, then check if trigger was observed
      const triggerEvent = this.getEvent(ev.timing.triggerEvent);
      if (triggerEvent) {
        const recordEvents = this.record.events;

        let matchedEvent = null;
        for (var i = recordEvents.length - 1; i >= 0; --i) {
          const otherEvent = recordEvents[i];
          if (otherEvent.type == triggerEvent.type &&
              otherEvent.data.type == triggerEvent.data.type &&
              Utilities.matchUrls(otherEvent.data.url,
                triggerEvent.data.url, 0.9)) {
            matchedEvent = otherEvent;
            break;
          }
        }

        if (!matchedEvent) {
          this.setNextTimeout(RingerParams.params.replay.defaultWait);
          return;
        }
      }

      // we hopefully found a matching port, lets dispatch to that port
      const type = ev.data.type;

      // console.log("this.getStatus()", this.getStatus());

      try {
        if (this.getStatus() === ReplayState.REPLAYING) {
          // clear ack
          this.ack = null;
          this.ackPort = replayPort.name;

          // group atomic events
          let eventGroup = [];
          const endEvent = meta.endEventId;
          if (RingerParams.params.replay.atomic && endEvent) {
            let t = this.index;
            const events = this.events;
            const curEvent = events[t];
            while (t < events.length && curEvent.meta.pageEventId &&
                    endEvent >= curEvent.meta.pageEventId &&
                    ev.frame.port == curEvent.frame.port) {
              eventGroup.push(curEvent);
              t++;
            }
          } else {
            eventGroup = [ev];
          }

          replayPort.postMessage({type: 'dom', value: eventGroup});
          this.updateStatus(ReplayState.ACK);

          this.firstEventReplayed = true;

          this.log.log('sent message', eventGroup);
          this.log.log('start waiting for replay ack');
          this.setNextTimeout(0);
        } else {
          throw 'unknown replay state';
        }
      } catch (err) {
        this.log.error('error:', err.message, err);
        // a disconnected port generally means that the page has been
        //   navigated away from
        if (err.message === 'Attempting to use a disconnected port object') {
          const strategy = RingerParams.params.replay.brokenPortStrategy;
          //console.log("using broken port strategy: ", strategy);
          if (strategy === BrokenPortStrategy.RETRY) {
            if (ev.data.cascading) {
              // skip the rest of the events
              this.incrementIndex();
              this.setNextTimeout(0);
            } else {
              // remove the mapping and try again
              delete this.portMapping[ev.frame.port];
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
      this.log.error('error:', err.message, err);
      this.finish();
    }
  }

  /**
   * Replay event where user manually loaded page.
   * @param e 
   */
  private simulateManualLoadEvent(ev: RecordedRingerEvent) {
    this.index++; // advance to next event
    this.setNextTimeout(0);
    /*
    console.log("simulating manual load", e);
    var that = this;
    var options = {url: e.data.url, active: true};
    if (this.targetWindowId){
      options.windowId = this.targetWindowId;
    }
    chrome.tabs.create(options, function(){
      that.index ++; // advance to next event
      that.setNextTimeout(0); 
    });
    */
    // commented out the above because for now we just do it via forced
    //   completed events (with forceReplay); may want to change this in future
  }

  /**
   * Replays a Chrome web navigation event.
   * @param e 
   */
  private simulateWebNavigationEvent(ev: RecordedRingerEvent) {
    if (RingerEvents.isComplete(ev)) {
      // unfortunately chrome has changed so that sometimes these webnavigation
      //   oncompleted events
      // are the only way we know a page load completion has happened
      // (no completed event gets raised), so we need to treat this is a
      //   completed event
      this.simulateCompletedEvent(ev);
    } else {
      this.index++; // advance to next event
      this.setNextTimeout(0);
    }
  }

  /**
   * TODO
   */
  public skip() {
    this.incrementIndex();
    this.updateStatus(ReplayState.REPLAYING);
  }

  /**
   * Stop the replay.
   */
  public stopReplay() {
    if (this.getStatus() == ReplayState.STOPPED) {
      return;
    }

    this.updateStatus(ReplayState.STOPPED);

    this.pause();
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
   * Update replay state.
   * @param newStatus 
   */
  public updateStatus(newStatus: ReplayState) {
    this.replayState = newStatus;
    this.updateListeners({
      type: 'status',
      value: 'replay:' + newStatus
    });
  }
}

/**
 * Return whether it seems a tab load failed. Criteria are if there's no favicon
 *   URL and if the page title is just a segment of the URL.
 * @param tab 
 */
function isTabLoadFailed(tab: chrome.tabs.Tab) {
  if (!tab.favIconUrl && tab.title && tab.url?.includes(tab.title)){
    return true;
  }
  return false;
}