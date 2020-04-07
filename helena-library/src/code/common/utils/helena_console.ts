export namespace HelenaConsole {
  export let debugging = false;
  export let showWarnings = true;
  export let namedDebugging: string[] = []; //["nextInteraction"]; //["getRelationItems"]; // ["prinfo"]; //["duplicates"]; //["rbb"];//["getRelationItems", "nextInteraction"];
  export let styleMinimal = true;

  function callerName(origArgs: any) {
    console.log("origArgs", origArgs);
    try {
      return origArgs.callee.caller.name;
    } catch(e) {
      return "unknown caller";
    }
  }

  function loggingGuts(args: any, origArgs: any) {
    let prefix: string[] = [];
    if (!styleMinimal){
      const caller = callerName(origArgs);
      prefix = [`[${caller}]`];
    }
    const newArgs = prefix.concat(Array.prototype.slice.call(args));
    Function.apply.call(console.log, console, newArgs);
  }

  export function log(...args: any) {
    if (debugging){
      loggingGuts(arguments, arguments);
    }
  }

  export function namedLog(...args: any) {
    const name = arguments[0];
    if (debugging || namedDebugging.includes(name)) {
      const args = Array.prototype.slice.call(arguments);
      loggingGuts(args.slice(1, arguments.length), arguments);
    }
  }

  export function warn(...args: any) {
    if (showWarnings){
      const args = Array.prototype.slice.call(arguments);
      const newArgs = ["Warning: "].concat(args);
      loggingGuts(newArgs, arguments);
    }
  }
}
