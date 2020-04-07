/**
 * DOM events to filter (i.e. ignore) during scrape mode (e.g. when the Alt
 *   button is pressed down).
 */
export namespace ScrapeModeFilters {
  /**
   * Filter out extra Ctrl or Alt key events from being recorded, specifically
   *   for Chrome on Windows in which repeated events are fired when key is
   *   held down, whereas it is a single event on Mac.
   */
  export function ignoreExtraCtrlAlt(event: KeyboardEvent) {
    // key code 18: alt; key code 17: ctrl
    return (event.keyCode === 18 || event.keyCode === 17) &&
        (event.type === "keypress" || event.type === "keydown");
  };
}