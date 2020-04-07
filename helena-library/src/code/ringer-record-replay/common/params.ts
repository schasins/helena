import { LogLevel } from "./logs";

/**
 * Compensation actions scheme, should be used when element properties differ
 *   between record and replay executions.
 */
export enum CompensationAction {
  NONE = 'none',
  FORCED = 'forced'
}

/**
 * Strategy to apply when an exception is thrown because of a disconnected
 *   port.
 */ 
export enum BrokenPortStrategy {
  RETRY = 'retry',
  SKIP = 'skip'
}

/**
 * Strategy for how much time should be spent between events
 */
export enum TimingStrategy {
  MIMIC = 'mimic',
  SPEED = 'speed',
  SLOWER = 'slower',
  SLOWEST = 'slowest',
  FIXED_1 = 'fixed_1',
  RANDOM_0_3 = 'random_0_3',
  PERTURB_0_3 = 'perturb_0_3',
  PERTURB = 'purterb'
}

/**
 * Strategy for action to take after a timeout
 */
export enum TimeoutStrategy {
  ERROR = 'error',
  SKIP = 'skip'
}


export interface IRingerParams {
  capture: {
    saveCaptureLocal: boolean;
  };
  compensation: {
    enabled: boolean;
    omittedProps: string[];
  };
  ctrlOnlyEvents: string[];
  defaultProps: { [key: string]: any };
  events: {
    [key: string]: {
      [key: string]: boolean
    }
  };
  logging: {
    level: LogLevel;
    enabled: string;
    print: boolean;
    saved: boolean;
  };
  record: {
    allEventProps?: boolean;
    cancelUnrecordedEvents: boolean;
    listenToAllEvents: boolean;
    recordAllEventProps: boolean;
  };
  replay: {
    atomic: boolean;
    cascadeCheck: boolean;
    brokenPortStrategy: BrokenPortStrategy;
    cancelUnknownEvents: boolean;
    captureWait: number;
    compensation: CompensationAction;
    defaultUser: boolean;
    defaultWait: number;
    defaultWaitNewTab: number;
    defaultWaitNextEvent: number;
    eventTimeout: null;
    highlightTarget: boolean;
    openNewTab: boolean;
    saveReplay: boolean;
    skipCascadingEvents: boolean;
    targetTimeout: number;
    timingStrategy: TimingStrategy;
    urlSimilarity: number;
  };
}

export namespace RingerParams {
  /**
   * List of all events and whether or not we should capture them
   */
  let events = {
    'Event': {
      // 'abort': true,
      'change': true,  // change event occurs before focus is lost (blur)
      'copy': true,
      'cut': true,
      'error': false,
      'input': true,  // input event occurs on each keystroke (or cut/paste)
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

  let defaultProps = {
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
      'timeStamp': 0,
      'selectionStart': 0,
      'selectionEnd': 0
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
      'keyIdentifier': '',  // nonstandard to Chrome
      'keyLocation': 0      // nonstandard to Chrome
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

  export let params: IRingerParams = {
    events: events,
    ctrlOnlyEvents: ["mouseover"],
    defaultProps: defaultProps,
    /*
    panel: {
      enableEdit: true,
      enableRequest: true
    },*/
    logging: {
      level: 4,
      enabled: 'all',
      print: true,
      saved: true
    },
    compensation: {
      enabled: true,
      omittedProps: ['innerHTML', 'outerHTML', 'innerText', 'outerText',
          'textContent', 'className', 'childElementCount', 'clientHeight',
          'clientWidth', 'clientTop', 'clientLeft', 'offsetHeight',
          'offsetWidth', 'offsetTop', 'offsetLeft', 'text', 'valueAsNumber',
          'id', 'class', 'xpath', 'baseURI'],
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
      defaultWait: 1000,
      defaultWaitNewTab: 5000,
      defaultWaitNextEvent: 5000,
      captureWait: 0,
      highlightTarget: true,
      brokenPortStrategy: BrokenPortStrategy.RETRY,
      atomic: true,
      cascadeCheck: true,
      urlSimilarity: 0.2,
      defaultUser: false
    },
    capture: {
      saveCaptureLocal: true,
    },
    /*
    server: {
      // url: 'http://sbarman.webfactional.com/api/',
      url: 'http://127.0.0.1:8000/api/',
      user: 'sbarman',
    },*/
  };
}
