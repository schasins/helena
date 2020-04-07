import { HelenaConsole } from "./helena_console";
import { PageVariable } from "../../mainpanel/variables/page_variable";
import { StatementTypes } from "../../mainpanel/lang/statements/statement_types";
import { RingerEvents,
  RecordedRingerEvent,
  DOMRingerEvent} from "../../ringer-record-replay/common/event";
import { Utilities } from "../../ringer-record-replay/common/utils";

export type Trace = RecordedRingerEvent[];

interface EventDisplayInfo {
  causedBy?: RecordedRingerEvent;
  causesLoads?: RecordedRingerEvent[];
  inputPageVar?: PageVariable;
  manual?: boolean;
  pageVar?: PageVariable;
  visible?: boolean;
}

export interface DisplayTraceEvent extends RecordedRingerEvent {
  additionalDataTmp: {
    display: EventDisplayInfo;
  }
}

/**
 * Handling a trace (i.e. a list of Ringer events).
 */
export namespace Traces {
  const statementToEventMapping = {
    mouse: ['click','dblclick','mousedown','mousemove','mouseout','mouseover',
      'mouseup'],
    keyboard: ['keydown','keyup','keypress','textinput','paste','input'],
    dontcare: ['blur']
  }

  export function lastTopLevelCompletedEvent(trace: Trace) {
    for (let i = trace.length - 1; i >= 0; i--){
      const ev = trace[i];
      if (RingerEvents.isComplete(ev)) {
        return ev;
      }
    }
    throw new ReferenceError("No top level completed event!");
  }

  export function tabId(ev: RecordedRingerEvent | undefined) {
    if (!ev) { return undefined; }
    return ev.data.tabId;
  }

  export function frameId(ev: RecordedRingerEvent) {
    return ev.data.frameId;
  }

  export function lastTopLevelCompletedEventTabId(trace: Trace) {
    const ev = lastTopLevelCompletedEvent(trace);
    return ev?.data.tabId;
  }

  export function tabsInTrace(trace: Trace) {
    const tabs: number[] = [];
    for (const ev of trace) {
      if (RingerEvents.isComplete(ev)){
        if (!tabs.includes(ev.data.tabId)) {
          tabs.push(ev.data.tabId);
        }
      }
    }  
    return tabs;
  }

  /**
   * Add display information placeholder to event.
   * @param ev 
   */
  export function prepareForDisplay(ev: RecordedRingerEvent) {
    let dispEv: DisplayTraceEvent = {
      ...ev,
      additionalDataTmp: {
        display: {}
      }
    };
    return dispEv;
  }

  export function getLoadURL(ev: RecordedRingerEvent) {
    const url = ev.data.url;
    // to canonicalize urls that'd be treated the same, remove slash at end
    return strip(url, "/");
  }

  export function getDOMURL(ev: RecordedRingerEvent) {
    const url = <string> ev.frame.topURL;

    // to canonicalize urls that'd be treated the same, remove slash at end
    return strip(url, "/");
  }

  export function getTabId(ev: RecordedRingerEvent) {
    if (ev.type === "dom") {
      HelenaConsole.warn("yo, this function isn't for dom events");
    }
    const tabId = ev.data.tabId;
    return tabId;
  }

  export function getDOMPort(ev: RecordedRingerEvent) {
    return ev.frame.port;
  }

  export function getVisible(ev: RecordedRingerEvent) {
    return ev.additionalDataTmp?.display?.visible;
  }

  export function setVisible(ev: DisplayTraceEvent, val: boolean) {
    ev.additionalDataTmp.display.visible = val;
  }

  export function getManual(ev: DisplayTraceEvent) {
    return ev.additionalDataTmp.display.manual;
  }

  export function setManual(ev: DisplayTraceEvent, val: boolean) {
    ev.additionalDataTmp.display.manual = val;
  }

  export function getLoadOutputPageVar(ev: DisplayTraceEvent) {
    return ev.additionalDataTmp.display.pageVar;
  }

  export function setLoadOutputPageVar(ev: DisplayTraceEvent,
      val: PageVariable) {
    ev.additionalDataTmp.display.pageVar = val;
  }

  export function getDOMInputPageVar(ev: DisplayTraceEvent): PageVariable {
    if (!ev.additionalDataTmp.display.inputPageVar) {
      throw new ReferenceError("DOM Input page variable undefined");
    }
    return ev.additionalDataTmp.display.inputPageVar;
  }

  export function setDOMInputPageVar(ev: DisplayTraceEvent, val: PageVariable) {
    ev.additionalDataTmp.display.inputPageVar = val;
  }

  export function getDOMOutputLoadEvents(ev: DisplayTraceEvent){
    if (ev.type !== "dom") { return; }
    return ev.additionalDataTmp.display.causesLoads;
  }

  export function setDOMOutputLoadEvents(ev: DisplayTraceEvent,
      val: RecordedRingerEvent[]) {
    if (ev.type !== "dom") { return; }
    ev.additionalDataTmp.display.causesLoads = val;
  }

  export function addDOMOutputLoadEvent(ev: DisplayTraceEvent,
      val: RecordedRingerEvent) {
    if (!ev.additionalDataTmp.display.causesLoads) {
      ev.additionalDataTmp.display.causesLoads = [];
    }
    ev.additionalDataTmp.display.causesLoads.push(val);
  }

  export function getLoadCausedBy(ev: DisplayTraceEvent) {
    return ev.additionalDataTmp.display.causedBy;
  }

  export function setLoadCausedBy(ev: DisplayTraceEvent,
      val: RecordedRingerEvent) {
    ev.additionalDataTmp.display.causedBy = val;
  }

  export function getDisplayInfo(ev: DisplayTraceEvent) {
    return ev.additionalDataTmp.display;
  }

  function cleanEvent(ev: DisplayTraceEvent): DisplayTraceEvent {
    const displayData = Traces.getDisplayInfo(ev);
    Traces.clearDisplayInfo(ev);
    const cleanEvent = Utilities.clone(ev);
    // now restore the true trace object
    Traces.setDisplayInfo(ev, displayData);
    return cleanEvent;
  }

  export function cleanTrace(trace: Trace) {
    const cleanTrace = [];
    for (const event of trace) {
      cleanTrace.push(cleanEvent(<DisplayTraceEvent> event));
    }
    return cleanTrace;
  }

  export function clearDisplayInfo(ev: DisplayTraceEvent) {
    delete ev.additionalDataTmp.display;
  }

  export function setDisplayInfo(ev: DisplayTraceEvent,
      displayInfo: EventDisplayInfo) {
    ev.additionalDataTmp.display = displayInfo;
  }

  export function setTemporaryStatementIdentifier(ev: RecordedRingerEvent,
      id: number) {
    if (!ev.additional) {
      // not a dom event, can't copy this stuff around
      return;
    }
    // this is where the r+r layer lets us store data that will actually be
    //   copied over to the new events (for dom events);  recall that it's
    //   somewhat unreliable because of cascading events; sufficient for us
    //   because cascading events will appear in the same statement, so can
    //   have same statement id, but be careful
    ev.additional.___additionalData___.temporaryStatementIdentifier = id;
  }


  export function firstScrapedContentEventInTrace(trace: Trace) {
    for (const event of trace) {
      if (event.additional && event.additional.scrape &&
          event.additional.scrape.text) {
        return event;
      }
    }
    return null;
  }

  export function getTemporaryStatementIdentifier(ev: RecordedRingerEvent) {
    if (!ev.additional) {
      // not a dom event, can't copy this stuff around
      return null;
    }
    return ev.additional.___additionalData___.temporaryStatementIdentifier;
  }

  export function statementType(ev: RecordedRingerEvent) {
    if (ev.type === "completed" || ev.type === "manualload" ||
        ev.type === "webnavigation") {
      if (!Traces.getVisible(ev)) {
        return null; // invisible, so we don't care where this goes
      }
      return StatementTypes.LOAD;
    } else if (ev.type === "dom") {
      const domEv = <DOMRingerEvent & RecordedRingerEvent> ev;
      if (statementToEventMapping.dontcare.includes(domEv.data.type)) {
        return null; // who cares where blur events go
      }
      let lowerXPath = domEv.target.xpath.toLowerCase();
      if (lowerXPath.indexOf("/select[") > -1) {
        // this was some kind of interaction with a pulldown, so we have
        //   something special for this
        return StatementTypes.PULLDOWNINTERACTION;
      } else if (statementToEventMapping.mouse.includes(ev.data.type)) {
        const domEv = <DOMRingerEvent> ev;
        if (domEv.additional.scrape) {
          if (domEv.additional.scrape.linkScraping) {
            return StatementTypes.SCRAPELINK;
          }
          return StatementTypes.SCRAPE;
        }
        return StatementTypes.MOUSE;
      } else if (statementToEventMapping.keyboard.includes(ev.data.type)) {
        /*
        if (ev.data.type === "keyup") {
          return StatementTypes.KEYUP;
        }
        */
        //if ([16, 17, 18].indexOf(ev.data.keyCode) > -1) {
        //  // this is just shift, ctrl, or alt key.  don't need to show these to the user
        //  return null;
        //}
        return StatementTypes.KEYBOARD;
      }
    }
    // these events don't matter to the user, so we don't care where this goes
    return null;
  }

  export function firstVisibleEvent(trace: Trace) {
    for (const ev of trace) {
      const st = statementType(ev);
      if (st !== null) {
        return <DisplayTraceEvent> ev;
      }
    }
    throw new ReferenceError("No visible events in trace!");
  }
}

function strip(str: string, remove: string) {
  while (str.length > 0 && remove.includes(str.charAt(0))) {
    str = str.substr(1);
  }
  while (str.length > 0 && remove.includes(str.charAt(str.length - 1))) {
    str = str.substr(0, str.length - 1);
  }
  return str;
}