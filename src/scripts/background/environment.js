var Environment = (function _Environment() { var pub = {};

  pub.Frame = function _Frame(parent){
    this.parent = parent;
    this.map = {};

    /* Extends the environment. */
    this.envExtend = function _envExtend(parent) {
      return new pub.Frame(this); // current frame is the parent of the new frame
    };

    /* Binds a new value to the top frame. */
    this.envBind = function _envBind(name, value) {
      if (name in this.map) {
        // Don't bind names twice --- you should never be doing this.
        throw new ExecError(name + ' is already declared');
      }
      this.map[name] = value;
    };

    /* Looks up the value of a variable. */
    this.envLookup = function _envLookup(name) {
      if (this.map.hasOwnProperty(name)) {
        return this.map[name];
      } else {
        if (this.parent) {
          return this.parent.envLookup(name);
        } else {
          throw new ExecError(name + ' is not declared');
        }
      }
    };

  };

  /* Creates a root environment. */
  pub.envRoot = function _envRoot() {
    // The root doesn't have a parent.
    return new pub.Frame(null);
  };

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

return pub; }());