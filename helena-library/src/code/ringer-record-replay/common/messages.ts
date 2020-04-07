export interface RingerMessage {
  state?: string;
  type: string;
  value: any;
}

export interface PortInfo {
  portId?: string;
  top: boolean;
  URL: string;
}

export interface UpdateEventMessage {
  pageEventId: number;
  updates: {
    field: string;
    value: any;
  }[];
}

export interface GetIdMessage extends RingerMessage {
  type: "id";
  value: string;
}

export enum ReplayAckStatus {
  SUCCESS = 'success',
  PARTIAL ='partial' // only some of the commands replayed were successful
}

export enum RecordState {
  STOPPED = 'stopped',
  RECORDING = 'recording',
  REPLAYING = 'replaying' // the recorder is recording replayed actions
}