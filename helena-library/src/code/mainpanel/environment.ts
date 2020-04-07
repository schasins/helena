import { RecorderUI } from "./ui/recorder_ui";

export namespace Environment {
  let UIObject: RecorderUI | null = null;

  export function setUIObject(obj: RecorderUI) {
    if (obj) {
      UIObject = obj;
    }
  }

  export class Frame {
    public parent: Frame | null;
    public map: {
      [key: string]: any;
    };

    constructor(parent: Frame | null) {
      this.parent = parent;
      this.map = {};
    }

    /* Extends the environment. */
    public envExtend() {
      return new Frame(this); // current frame is the parent of the new frame
    }

    /**
     * Binds a new value to the top frame.
     */
    public envBind(name: string, value: any) {
      if (name in this.map) {
        // Don't bind names twice --- you should never be doing this.
        console.log("WARNING: The variable " + name + " was defined twice." +
          " Please rename one.");
      }
      this.map[name] = value;
    }

    /**
     * Looks up the value of a variable.
     */
    public envLookup(name: string): any {
      if (this.map.hasOwnProperty(name)) {
        return this.map[name];
      } else {
        if (this.parent) {
          return this.parent.envLookup(name);
        } else {
          UIObject?.addDialog("Couldn't find item", "Tried to use something " +
            "called " + name + ", but we don't know anything about it.", {});
          throw new ReferenceError(name + ' is not declared');
        }
      }
    }
  }

  /* Creates a root environment. */
  export function envRoot() {
    // The root doesn't have a parent.
    return new Frame(null);
  }

  /* Updates the value binding of a variable. */
  /* currently only way to create a variable is to scrape it from a relation, and shouldn't do that twice for same variable, so we'll leave this out for now */
  /*
  pub.envUpdate = function _envUpdate(frame, name, value) {
    if (frame.hasOwnProperty(name)) {
      // frame.hasOwnProperty allows us to avoid accessing things like
      // frame.toString, which are not defined in the environment but will
      // exist anyway because of JS quirks.
      frame[name] = value;
      return value;
    } else {
      // If it isn't in this frame, check the parent, if it exists.
      if (frame['*parent']) {
        // Recursively check the parent. Remember we go towards the root for
        // shadowing of names to work.
        return pub.envUpdate(frame['*parent'], name, value);
      } else {
        // We have reached the root without finding the name. Panic.
        throw new ExecError(name + ' is not declared');
      }
    }
  };
  */
}