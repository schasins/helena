import * as _ from "underscore";

import { HelenaConsole } from "../common/utils/helena_console";

/**
 * A very important set of utilities for reviving objects that have been
 *   stringified (as for sending to the server) but have returned to us, and
 *   need to be used as proper objects again.
 * We always store all the fields; it's the methods we lose. So we basically,
 *   when it comes time to revive it, want to union the attributes of the now
 *   unstringified dict and the prototype, grabbing the methods back from the
 *   prototype.
 */
export namespace Revival {
  export interface Revivable {
    ___revivalLabel___: string;
  }
  export type Prototype = {
    new(...args: any[]): Revivable;
    createDummy: () => Revivable;
  };

  const revivalLabels: {
    [key: string]: Prototype
  } = {};

  export function introduceRevivalLabel(label: string,
      prototype: Prototype) {
    revivalLabels[label] = prototype;
  }

  export function addRevivalLabel(object: Revivable) {
    for (const prop in revivalLabels) {
      if (object instanceof revivalLabels[prop]){
        object.___revivalLabel___ = prop;
        return;
      }
    }
    HelenaConsole.log("No known revival label for the type of " +
      "object:", object);
  }

  export function revive(attrs: { [key: string]: any }){
    // we're going to be handling circular objects, so have to keep track of
    //   what we've already handled
    const seen: { [key: string]: any }[] = [];
    const fullSeen: { [key: string]: any }[] = [];

    const reviveHelper = (attrs: { [key: string]: any }) => {
      // ok, now let's figure out what kind of case we're dealing with
      
      // why is null even an object?
      if (typeof attrs !== "object" || attrs === null) {
        return attrs; // nothing to do here
      } else if (seen.includes(attrs)){
        // already seen it
        const i = seen.indexOf(attrs);
        return fullSeen[i]; // get the corresponding revived object
      } else {
        // ok, it's an object and we haven't processed it before
        let fullObj = attrs;
        if (attrs.___revivalLabel___) {
          // ok, we actually want to revive this very object
          const prototype = revivalLabels[attrs.___revivalLabel___];
          fullObj = prototype.createDummy();
          _.extend(fullObj, attrs);
          // now the fullObj is restored to having methods and such
        }
        seen.push(attrs);
        fullSeen.push(fullObj);
        // ok, whether we revived this obj or not, we definitely have to descend
        for (const prop in attrs){
          const val = attrs[prop];
          const fullVal = reviveHelper(val);

          // must replace the old fields-only val with the proper object val
          fullObj[prop] = fullVal;
        }
        return fullObj;
      }
    };
    var obj = reviveHelper(attrs);
    return obj;
  };
}