import { Indexable } from "./utils";
import { RingerParams } from "./params";

export enum LogLevel {
  LOG = 1,
  INFO,
  DEBUG,
  WARN,
  ERROR,
}

/*
 * Logging utility. Allows logs to be disabled based upon name and level.
 */
export namespace Logs {
  export let logRecord: string[] = [];

  /**
   * Check to see if the log is enabled and return a Logger.
   */
  export function getLog(...names: string[]) {
    const enabledLogs = RingerParams.params.logging.enabled;
    if (enabledLogs == 'all') {
      return new Logger(names);
    }

    for (const name of names) {
      if (enabledLogs.includes(name)) {
        return new Logger(names);
      }
    }

    return new NoopLogger();
  };

  export class Logger {
    private level = RingerParams.params.logging.level;
    private tag: string;

    constructor(tags: string[]) {
      let tagString = '';
      for (let i = 0; i < tags.length; ++i) {
        tagString += tags[i];
        if (i !== tags.length - 1) {
          tagString += ',';
        }
      }
      this.tag = `[${tagString}]`;
    }
    
    public debug(...args: any[]) {
      if (this.level <= LogLevel.DEBUG) {
        this.print('debug', args);
      }
    }

    public error(...args: any[]) {
      if (this.level <= LogLevel.ERROR) {
        this.print('error', args);
      }
    }
    
    public info(...args: any[]) {
      if (this.level <= LogLevel.INFO) {
        this.print('info', args);
      }
    }

    public log(...args: any[]) {
      if (this.level <= LogLevel.LOG) {
        this.print('log', args);
      }
    }

    public warn(...args: any[]) {
      if (this.level <= LogLevel.WARN) {
        this.print('warn', args);
      }
    }

    public print(f: string, origArgs: any[]) {
      const args = [this.tag];
      for (const origArg of origArgs) {
        args.push(origArg.toString());
      }

      if (RingerParams.params.logging.saved) {
        logRecord.push(args.toString());
      }
      if (RingerParams.params.logging.print) {
        (<Indexable> console)[f].apply(console, args);
      }
    }
  }

  export class NoopLogger {
    public debug() {}
    public error() {}
    public info() {}
    public log() {}
    public warn() {}
  }
}