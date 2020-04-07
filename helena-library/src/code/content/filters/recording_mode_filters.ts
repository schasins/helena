/**
 * DOM events to filter (i.e. ignore) during recording.
 */
export namespace RecordingModeFilters {
  /**
   * Because Windows has this habit of producing multiple keypress, keydown
   *   events for a continued key press, we want to throw out events that are
   *   repeats of events we've already seen. This change fixes a major issue
   *   with running Helena on Windows, in that the top-level tool chooses to
   *   ignore events that can be accomplished without running Ringer (e.g.
   *   scraping relation items), but keydown events can only be accomplished by
   *   Ringer.  So replay gets slow because of having to replay all the Ringer
   *   events for each row of the relation.
   * Note: if we run into issues where holding a key down in a recording
   *   produces a bad replay, look here first.
   */
  export function ignoreExtraKeydowns(event: KeyboardEvent) {
    if (!window.helenaContent || !window.helenaContent.currentlyPressedKeys) {
      throw new ReferenceError("HelenaContent not loaded correctly.");
    }
    
    // for now, we'll ignore multiple keypresses for all keys
    //   (not just ctrl and alt)
    if (event.type === "keypress" || event.type === "keydown") { 
      // first seen, record that it's being pressed down
      if (!window.helenaContent.currentlyPressedKeys[event.keyCode]) { 
        window.helenaContent.currentlyPressedKeys[event.keyCode] = true;
        return false;
      } else {  // not first seen, ignore
        return true;
      }
    } else if (event.type === "keyup") {
      // key is no longer being pressed, no longer need to keep track of it
      window.helenaContent.currentlyPressedKeys[event.keyCode] = false;
      return false;
    }
    return false;
  }
}