import { Messages } from "../../common/messages";
import { MainpanelNode } from "../../common/mainpanel_node";
import MainpanelNodeI = MainpanelNode.Interface;
import { Highlight } from "../ui/highlight";
import { DOMRingerEvent } from "../../ringer-record-replay/common/event";

/**
 * Handlers during "scrape mode" when scraping is activated (e.g. when the Alt
 *   button is pressed down).
 */
export namespace ScrapeModeHandlers {
  /**
   * Send scraped data to the mainpanel for visualization. This line must run
   *   after the Ringer content script runs so that the
   *   additional_recording_handlers object exists.
   */
  export function sendScrapedDataToMainpanel(node: Node, ev: DOMRingerEvent) {
    let data: MainpanelNodeI = MainpanelNode.fromDOMNode(node);
    // convention is SHIFT means we want to scrape the link, not the text 
    let linkScraping = ev.data.shiftKey || ev.data.metaKey;
    data.linkScraping = linkScraping;
    if (ev.data.type === "click") {
      Messages.sendMessage("content", "mainpanel", "scrapedData", data);
    } // send it to the mainpanel for visualization
    return data;
  };

  /**
   * Updates {@link HelenaContent.mostRecentMousemoveTarget} on mousemove.
   * @param event mousemove event
   */
  export function updateMousemoveTarget(event: Event) {
    window.helenaContent.mostRecentMousemoveTarget = event.target;
  }

  /**
   * Highlights element that triggered a mousein event.
   * @param event mousein event
   */
  export function highlightMouseinElement(event: Event) {
    if (!window.helenaContent.currentlyRecording()) {
      // don't want to run this visualization stuff if we're in replay mode
      //   rather than recording mode, even though of course we're recording
      //   during replay
      return;
    }
    Highlight.clearHighlight(window.helenaContent.highlightedElement);
    window.helenaContent.highlightedElement = Highlight.highlightNode(
      <HTMLElement> event.target, "#E04343", true, false);
  }

  /**
   * Clears highlight on mouseout.
   * @param event mouseout event
   */
  export function unhighlightMouseoutElement(event: Event) {
    Highlight.clearHighlight(window.helenaContent.highlightedElement);
  }

  /**
   * Prevents click from propagating such that links won't be followed, etc.
   * @param event click event
   */
  export function preventClickPropagation(event: Event) {
    if (window.helenaContent.currentlyScraping()) {
      event.stopImmediatePropagation();
      event.preventDefault();
    }
  }
}