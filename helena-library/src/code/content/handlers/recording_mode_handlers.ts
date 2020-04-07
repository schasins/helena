import { ScrapeModeHandlers } from "./scrape_mode_handlers";
import { ScrapingTooltip } from "../ui/scraping_tooltip";

import { HelenaConsole } from "../../common/utils/helena_console";
import { Highlight } from "../ui/highlight";

/** 
 * Handlers for user events on the content side while recording.
 */
export namespace RecordingModeHandlers {
    /**
     * Prevents the right-click menu from opening during recording. Important
     *   because interactions with the context menu won't be recorded, and
     *   Helena won't be able to replay them.
     * @param event context menu event
     */
    export function preventOpeningContextMenu(event: MouseEvent) {
      if (window.helenaContent.currentlyRecording()) {
        // prevents right click from working
        event.preventDefault();
        if (navigator.appVersion.toLocaleLowerCase().indexOf("win") !== -1) {
          alert("Trying to open a new tab? Try CTRL+click instead!");
        } else if (navigator.appVersion.toLocaleLowerCase().indexOf("mac") !== -1) {
          alert("Trying to open a new tab? Try CMD+click instead!");
        } else { // linux or unix, depends on computer 
          alert("Trying to open a new tab? Use a keyboard shortcut (like CTRL+click) instead!");
        }
      }
    }
  
    /**
     * Handler for mouseover events. 
     * @param event mouseover event
     */
    export function mouseoverHandler(event: MouseEvent) {
      if (window.helenaContent.currentlyRecording()) {
        new ScrapingTooltip(<HTMLElement> event.target);
        window.helenaContent.highlightRelevantRelation(
          <HTMLElement> event.target);
      }
      // just a backup in case the checks on keydown and keyup fail to run, as
      //   seems to happen sometimes with focus issues
      updateScraping(event);
      if (window.helenaContent.currentlyScraping() &&
          window.helenaContent.currentlyRecording()) {
        ScrapeModeHandlers.highlightMouseinElement(event);
      }
    }
  
    /**
     * Handler for mouseout events. 
     * @param event mouseout event
     */
    export function mouseoutHandler(event: MouseEvent) {
      if (window.helenaContent.currentlyRecording()) {
        ScrapingTooltip.destroy(<HTMLElement> event.target);
        window.helenaContent.unhighlightRelation();
      }
      // just a backup in case the checks on keydown and keyup fail to run, as
      //   seems to happen sometimes with focus issues
      updateScraping(event);
      if (window.helenaContent.currentlyScraping() && window.helenaContent.currentlyRecording()) {
        ScrapeModeHandlers.unhighlightMouseoutElement(event);
      }
    }
  
    let altDown = false;
  
    export function updateScraping(event: MouseEvent) {
      updateScrapingTrackingVars(event);
      checkScrapingOn();
      checkScrapingOff();
    };
  
    function updateScrapingTrackingVars(event: MouseEvent) {
      if (event.altKey) {
        altDown = true;
      }
      else{
        altDown = false;
      }
    };
  
    function checkScrapingOn() {
      if (!window.helenaContent.currentlyScraping() && (altDown)) {
        window.helenaContent.activateScrapeMode();
  
        if (!window.helenaContent.currentlyRecording()) {
          // don't want to run this visualization stuff if we're in replay mode
          //   rather than recording mode, even though of course we're recording
          //   during replay
          return;
        }
        // want highlight shown now, want clicks to fall through
        if (window.helenaContent.mostRecentMousemoveTarget) {
          window.helenaContent.highlightedElement = Highlight.highlightNode(
            <HTMLElement> window.helenaContent.mostRecentMousemoveTarget,
            "#E04343", true, false);
        }
      }
    };
  
    function checkScrapingOff() {
      if (window.helenaContent.currentlyScraping() &&
          window.helenaContent.currentlyRecording() && !(altDown)) {
        window.helenaContent.disableScrapeMode();  
        Highlight.clearHighlight(window.helenaContent.highlightedElement);
      }
    };
  
    function addOverlayDiv(observer: MutationObserver) {
      // TODO: cjbaik: move to separate file/use some form of templating framework
      let overlay = $("<div id='helena_overlay' style='position: fixed; width: 100%; height: 100%; \
                                    top: 0; left: 0; right: 0; bottom: 0; \
                                    background-color: rgba(0,0,0,0); \
                                    z-index: 2147483647; cursor: pointer;'></div>");
      let messageDiv = $("<div style='background-color: rgba(0,255,0,0.85); padding: 10px;'>\
        <div style='font-size:20px'>This page is being controlled by Helena.</div>\
        If you want to interact with this page anyway, click here to remove the overlay. Keep in mind that navigating away from the current page may disrupt the Helena process.\
        </div>");
      overlay.append(messageDiv);
  
      // if the user clicks on the box with the warning, go ahead and remove the
      //   whole overlay but stop the observer first, becuase we don't want to add
      //   it again because of the user's click and resultant removal
      messageDiv.click(function() {
        observer.disconnect();
        overlay.remove();
      });
  
      $("body").append(overlay);
    }
  
    let addedOverlay = false;
    export function applyReplayOverlayIfAppropriate(replayWindowId: number) {
      HelenaConsole.namedLog("tooCommon", "applyReplayOverlayIfAppropriate",
        replayWindowId, window.helenaContent.windowId, addedOverlay);
      
      // only apply it if we're in the replay window, if we haven't already
      //   applied it, and if we're the top-level frame
      if (window.helenaContent.windowId &&
          replayWindowId === window.helenaContent.windowId && !addedOverlay &&
          self === top) {
        // ok, we're a page in the current replay window.  put in an overlay
  
        // and remember, don't add the overlay again in future
        addedOverlay = true;
  
        // ok, now one weird thing about this is this alters the structure of the
        // page if other nodes are added later which can prevent us from finding
        // things like, say, relations.  so we have to make sure to put it back at
        // the end of the body nodes list whenever new stuff gets added
  
        // select the target node
        let target = document.body;
        // create an observer instance
        // configuration of the observer:
        let config = { childList: true }
        let observer = new MutationObserver(function(mutations) {
            mutations.forEach(function(mutation) { 
                // stop observing while we edit it ourself
                console.log("paused observing");
                observer.disconnect();
                $("#helena_overlay").remove();
                addOverlayDiv(observer);
                // and start again
                observer.observe(target, config);
            });
        });
        // pass in the target node, as well as the observer options
        observer.observe(target, config);
  
        // now actually add the overlay
        addOverlayDiv(observer);
      }
    };
  }