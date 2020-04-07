import { TargetInfo } from "../content/target";
import { Delta } from "../content/snapshot";
import { RecordState } from "./messages";

export interface RingerFrameInfo {
  iframeIndex?: number;
  innerHeight: number;
  innerWidth: number;
  outerHeight: number;
  outerWidth: number;
  port?: string;
  tab?: number;
  topFrame?: boolean;
  topURL?: string | ParameterizedTopURL;
  URL: string;
  windowId?: number;
}

export interface RecordedRingerFrameInfo extends RingerFrameInfo {
  iframeIndex: number;
  innerHeight: number;
  innerWidth: number;
  outerHeight: number;
  outerWidth: number;
  port: string;
  tab: number;
  topFrame: boolean;
  topURL: string | ParameterizedTopURL;
  URL: string;
  windowId: number;
}

export interface RingerEventMeta {
  deltas?: Delta[];
  dispatchType?: string;
  forceProp?: { [key: string]: any };
  id?: string;
  nodeName?: string;
  pageEventId?: number;
  recordId?: string;
  recordState?: RecordState;
}

export interface RecordedRingerEventMeta extends RingerEventMeta {
  endEventId?: number;
  id: string;
  pageEventId?: number;
}

export interface RingerTiming {
  ignoreWait?: boolean;
  triggerEvent?: string;
  waitTime?: number;
}

export interface RecordedRingerTiming extends RingerTiming {
  waitTime: number;
}

export interface RingerEvent {
  additionalDataTmp?: {
    display?: {
      visible?: boolean;
    };
  };
  additional?: {
    [key: string]: any;
  };
  data: {
    [key: string]: any;

    timeStamp: number;
    type: string;
  };
  deltas?: Delta[];
  frame?: RingerFrameInfo | ParameterizedFrame;
  pageEventId?: number;
  meta?: RingerEventMeta;
  relatedTarget?: TargetInfo;
  replayed?: boolean;
  target?: TargetInfo | ParameterizedTarget;
  targetTimeout?: number;
  timing?: RingerTiming;
  type: string;
}

export interface DOMRingerEvent extends RingerEvent {
  additional: {
    [key: string]: any;
  };
  frame: RingerFrameInfo;
  meta: RingerEventMeta;
  target: TargetInfo;
  timing: RingerTiming;
  type: "dom";
}

export interface RecordedRingerEvent extends RingerEvent {
  forceReplay?: boolean;
  frame: RecordedRingerFrameInfo;
  mayBeSkippable?: boolean;
  meta: RecordedRingerEventMeta;
  reset?: {
    alreadyForced?: boolean;
  };
  target: TargetInfo | ParameterizedTarget;
  timing: RecordedRingerTiming;
}

export interface ParameterizedXPath {
	name: string;
	value: null;
	orig_value: string;
}

export interface ParameterizedTopURL {
  name: string;
  value: string | null;
}

interface ParameterizedFrame extends RecordedRingerFrameInfo {
  topURL: ParameterizedTopURL;
}

interface ParameterizedTarget {
  xpath: ParameterizedXPath;
}

export interface ParameterizedRingerEvent extends RecordedRingerEvent {
  frame: ParameterizedFrame;
	target: ParameterizedTarget;
}

export interface StringParameterizeEvent {
  orig_value: string;
  parameter_name: string;
  text_input_event: RecordedRingerEvent;
  type: "string_parameterize";
  value: string;
}

export namespace RingerEvents {
  export function isComplete(ev: RingerEvent) {
    return (ev.type === "completed" && ev.data.type === "main_frame") ||
           (ev.type === "webnavigation" && ev.data.type === "onCompleted" &&
              ev.data.parentFrameId === -1);
  }
}