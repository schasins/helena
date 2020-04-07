// import { Controller } from "./controller";
import { PortManager } from "./port_manager";
import { Record } from "./record";
import { Replay, ErrorContinuations, ReplayConfig } from "./replay";
import { User } from "./user";
import { RingerMessage, RecordState, GetIdMessage } from "../common/messages";
import { Indexable } from "../common/utils";
import { HelenaConsole } from "../../common/utils/helena_console";
import { RingerEvent, RecordedRingerEvent } from "../common/event";
import { Logs } from "../common/logs";
import { RingerParams } from "../common/params";

interface WebRequestDetails
    extends chrome.webNavigation.WebNavigationCallbackDetails {
  reqTimeStamp: number;
  type: string;
  windowId: number;
}

export class RingerMainpanel {
  // public controller: Controller;
  private log = Logs.getLog('background');
  public ports: PortManager;
  public record: Record;
  public replay: Replay;
  public scriptServer: null;
  public user: User;

  constructor() {
    const self = this;

    this.ports = new PortManager();
    this.scriptServer = null;
    
    this.user = new User();
    this.record = new Record(this.ports);
    this.replay = new Replay(this.ports, this.scriptServer, this.user);
    // this.controller = new Controller(this.record, this.replay,
      // this.scriptServer, this.ports);

    // Attach the event handlers to their respective events
    chrome.runtime.onMessage.addListener(this.handleIdMessage.bind(this));

    chrome.runtime.onConnect.addListener((port) => {
      self.ports.connectPort(port);
    });

    chrome.tabs.getCurrent((curTab) => {
      const tabId = curTab?.id;
      chrome.tabs.onActivated.addListener((activeInfo) => {
        if (activeInfo.tabId !== tabId) {
          self.user.activatedTab(activeInfo);
        }
      });
    });

    chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
      self.ports.removeTab(tabId);
    });


    const filter: chrome.webRequest.RequestFilter = {
      urls: ['http://*/*', 'https://*/*'],
      types: ['main_frame', 'sub_frame', 'script', 'object', 'xmlhttprequest']
    };

    chrome.webRequest.onBeforeRequest.addListener((details) => {
      self.log.log('request start', details);
      self.addWebRequestEvent(details, 'start');
    }, filter, ['blocking']);

    chrome.webRequest.onCompleted.addListener((details) => {
      self.log.log('completed', details);
      self.addWebRequestEvent(details, 'completed');
    }, filter);

    chrome.webNavigation.onCommitted.addListener((details) => {
      self.log.log('onCommitted', details);
      const manuallyLoadedPageTypes = ["auto_bookmark",
        "reload", "typed"];
      if (manuallyLoadedPageTypes.includes(details.transitionType)) {
        // ok, this one indicates a manual load, so add it

        // as a special case, let's throw away manual loads that happen
        //   automatically when we just open a new tab (loading the new tab
        //   contents)
        console.log(details);
        self.addWebRequestEvent(details, 'manualload');
      }
      if (details.transitionQualifiers.includes("from_address_bar")) {
        // same deal.  this is a manual one
        console.log(details);
        self.addWebRequestEvent(details, 'manualload');
      }
    });

    const eventList = ['onBeforeNavigate', 'onCreatedNavigationTarget',
      'onCommitted', 'onCompleted', 'onDOMContentLoaded',
      'onErrorOccurred', 'onReferenceFragmentUpdated', 'onTabReplaced',
      'onHistoryStateUpdated'];
    for (const e of eventList) {
      (<Indexable> chrome.webNavigation)[e].addListener(
          (data: WebRequestDetails) => {
        if (typeof data) {
          data.type = e;
          self.addWebRequestEvent(data, 'webnavigation');
          //console.log(e, data);
        } else {
          console.error(chrome.i18n.getMessage('inHandlerError'), e);
        }
      });
    }

    this.ports.sendToAll({
      type: 'params',
      value: RingerParams.params
    });
    this.stop();
  }

  /**
   * Listen to web requests. TODO: describe this.
   * @param e 
   */
  public addBackgroundEvent(e: RingerEvent) {
    if (this.record.recordState === RecordState.RECORDING) {
      this.record.addEvent(e);
    } else if (this.replay.record.recordState === RecordState.REPLAYING) {
      this.replay.record.addEvent(e);
    }
  }

  /**
   * TODO: describe this.
   */
  public addWebRequestEvent(
      details: chrome.webNavigation.WebNavigationCallbackDetails,
      type: string) {
    const data = <WebRequestDetails> details;
    /*
    data.requestId = details.requestId;
    data.method = details.method;
    data.parentFrameId = details.parentFrameId;
    data.tabId = details.tabId;
    data.type = details.type;
    data.url = details.url;
    */ // all copied in by default now
    data.reqTimeStamp = details.timeStamp;
    data.timeStamp = (new Date()).getTime();

    const v = {
      data: data,
      type: type
    };

    this.addBackgroundEvent(v);

    // let's also figure out the window that should be associated with this web
    //   request, add that info once we get it
    // -1 means the request is not associated with a particular tab
    if (details.tabId > -1) {
      chrome.tabs.get(details.tabId, (tab) => {
        if (!tab && type !== "manualload") {
          HelenaConsole.warn("No tab.windowId!");
          return;
        }
        v.data.windowId = tab.windowId;
      });
    }
  }


  /**
   * Handle the getId message that the content script sends.
   * @param msg 
   * @param sender 
   * @param sendResponse 
   */
  private handleIdMessage(msg: RingerMessage,
      sender: chrome.runtime.MessageSender,
      sendResponse: (resp: RingerMessage) => void) {
    this.log.log('background receiving:', msg, 'from', sender);
    if (msg.type == 'getId') {
      const portId = this.ports.getNewId(msg.value, sender);
      if (portId) {
        const getIdMsg: GetIdMessage = {
          type: 'id',
          value: portId
        }
        sendResponse(getIdMsg);
      }
    }
  }

  /**
   * Handle messages coming from the content scripts.
   * @param port
   * @param request
   */
  public handleMessage(port: chrome.runtime.Port, request: RingerMessage) {
    const type = request.type;
    const state = request.state;

    this.log.log('handle message:', request, type, state);

    if (state === RecordState.RECORDING &&
        ['event', 'updateEvent'].includes(type)) {
      if (type === 'event') {
        this.record.addEvent(request.value, port.name);
      } else if (type === 'updateEvent') {
        this.record.updateEvent(request.value, port.name);
      } else {
        this.log.error('cannot handle message:', request);
      }
    } else if (state === RecordState.REPLAYING || 
      // todo: is this ok?  the stopped acks are breaking everything...
      (state === RecordState.STOPPED && ['ack', 'updateEvent'].includes(type))) {
        if (type === 'event') {
          this.replay.record.addEvent(request.value, port.name);
        } else if (type === 'updateEvent') {
          this.replay.record.updateEvent(request.value, port.name);
        } else if (type === 'ack') {
          this.replay.receiveAck(request.value);
        } else if (type === 'prompt') {
          this.user.contentScriptQuestion(request.value, port);
        } else if (type === 'findNodeWithoutRequiredFeatures') {
          this.replay.findNodeWithoutRequiredFeatures();
        } else {
          this.log.error('cannot handle message:', request);
        }
    } else if (['alert', 'getRecording', 'getParams', 'url'].includes(type)) {
      if (type === 'alert') {
        //panel.addMessage('[' + port.name + '] ' + request.value);
      } else if (type === 'getRecording') {
        const recStatus = this.record.getStatus();
        const repStatus = this.replay.record.getStatus();
    
        if (recStatus === RecordState.RECORDING) {
          port.postMessage({type: 'recording', value: recStatus});
        } else if (repStatus === RecordState.REPLAYING) {
          port.postMessage({type: 'recording', value: repStatus});
        } else {
          port.postMessage({type: 'recording', value: RecordState.STOPPED});
        }
      } else if (type === 'getParams') {
        port.postMessage({type: 'params', value: RingerParams.params});
      } else if (type === 'url') {
        this.ports.updateUrl(port, request.value);
      } else {
        this.log.error('cannot handle message:', request);
      }
    } else {
      this.log.error('cannot handle message:', request);
    }
  }

  /**
   * TODO
   * @param config 
   * @param cont 
   * @param errorConts 
   */
  public replayRecording(config: ReplayConfig | null,
      cont: (replay: Replay) => void, errorConts: ErrorContinuations = {}) {
    this.log.log('replay');
    this.stop();
    
    if (!config) {
      config = {};
    }

    if (!config.scriptId) {
      config.scriptId = this.record.getScriptId();
    }

    this.replay.replay(this.record.getEvents(), config, cont, errorConts);
    return this.replay;
  }

  
  /**
   * TODO
   */
  public replayScript(events: RecordedRingerEvent[],
      config: ReplayConfig | null, cont: (replay: Replay) => void,
      errorConts: ErrorContinuations = {}) {
    this.setEvents(undefined, events);
    return this.replayRecording(config, cont, errorConts);
  }

  /**
   * Reset recording status.
   */
  public reset() {
    this.log.log('reset');
    this.record.reset();
  }

  /**
   * Sets the recorded events.
   * @param scriptId 
   * @param events 
   */
  public setEvents(scriptId: number | undefined,
      events: RecordedRingerEvent[]) {
    this.record.setEvents(events);
    this.record.setScriptId(scriptId);
  }

  /**
   * Start recording.
   */
  public start() {
    this.log.log('start');
    this.record.startRecording(false);

    /* Update the UI */
    chrome.browserAction.setBadgeBackgroundColor({color: [255, 0, 0, 64]});
    // chrome.browserAction.setBadgeText({text: 'ON'});
  }

  /**
   * Stop recording.
   */
  public stop() {
    this.log.log('stop');
    this.record.stopRecording();

    /* Update the UI */
    chrome.browserAction.setBadgeBackgroundColor({color: [0, 0, 0, 0]});
    // chrome.browserAction.setBadgeText({text: 'OFF'});
  }

  /**
   * Stop replay.
   */
  public stopReplay() {
    this.replay.stopReplay();
  }
}

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