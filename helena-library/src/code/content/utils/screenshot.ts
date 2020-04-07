import * as html2canvas from "html2canvas";
import { DOMRingerEvent } from "../../ringer-record-replay/common/event";

interface ScreenshotHTMLElement extends HTMLElement {
  html2canvasDataUrl: string;
  waitingForRender: boolean;
}

/**
 * Handles taking screenshots of nodes.
 */
export namespace Screenshot {
  /**
   * Identifies transparent edges.
   * [cjbaik: Not completely sure what this means?]
   * @param canvas the canvas element
   */
  function identifyTransparentEdges(canvas: HTMLCanvasElement) {
    let context = canvas.getContext("2d");

    if (!context) {
      throw new ReferenceError("Context does not exist for canvas element.");
    }

    let imgData = context.getImageData(0, 0, canvas.width, canvas.height);
    let data = imgData.data;

    // what rows and columns are empty?

    let columnsEmpty = [];
    for (let i = 0; i < canvas.width; i++) {
      columnsEmpty.push(true);
    }
    let rowsEmpty = [];
    for (let i = 0; i < canvas.height; i++) {
      rowsEmpty.push(true);
    }

    for(let i = 0; i < data.length; i += 4) {
      let currX = (i / 4) % canvas.width,
        currY = ((i / 4) - currX) / canvas.width;
      let alpha = data[i+3];
      if (alpha > 0) {
        columnsEmpty[currX] = false;
        rowsEmpty[currY] = false;
      }
    }

    // how far should we crop?
    let left = 0;
    let left_i = left;
    while (columnsEmpty[left_i]) {
      left = left_i;
      left_i += 1;
    }

    let right = canvas.width - 1;
    let right_i = right;
    while (columnsEmpty[right_i]) {
      right = right_i;
      right_i -= 1;
    }

    let top = 0;
    let top_i = top;
    while (rowsEmpty[top_i]) {
      top = top_i;
      top_i += 1;
    }
    
    let bottom = canvas.height - 1;
    let bottom_i = bottom;
    while (rowsEmpty[bottom_i]) {
      bottom = bottom_i;
      bottom_i -= 1;
    }

    if (left === 0 && right === (canvas.width - 1) && top === 0 &&
        bottom === (canvas.height - 1)) {
      // no need to do any cropping
      return canvas;
    }

    // use a temporary canvas to crop
    let tempCanvas = document.createElement("canvas");
    let tContext = tempCanvas.getContext("2d");
    tempCanvas.width = (right - left);
    tempCanvas.height = (bottom - top);

    if (!tContext) {
      throw new ReferenceError("Context does not exist for canvas element.");
    }
    tContext.drawImage(canvas, left, top, tempCanvas.width, tempCanvas.height,
      0, 0, tempCanvas.width, tempCanvas.height);

    // HelenaConsole.log(canvas.width, canvas.height);
    // HelenaConsole.log(left, right, top, bottom);
    // HelenaConsole.log(tempCanvas.width, tempCanvas.height);

    return tempCanvas;
  }
  /**
   * Take a screenshot of the referenced element.
   * @param element element
   * @param traceEvent event message
   */
  export function take(element: ScreenshotHTMLElement,
    traceEvent: DOMRingerEvent) {
    if (!window.helenaContent.currentlyRecording()) {
      // don't want to run this visualization stuff if we're in replay mode
      //   rather than recording mode, even though of course we're recording
      //   during replay
      return;
    }
    if (traceEvent instanceof KeyboardEvent) {
      // ignore below.  this was when we were also checking if there was no
      // node.value;  but in general we're having issues with trying to
      // screenshot things for keyboard events when we really shouldn't so for
      // now changing presentation so that there is no 'target node' for
      // typing in the user-facing representation of the script for now we're
      // using this to determine whether the user is actually typing text into
      // a particular node or not.  since no node.value, probably not, and we
      // are likely to be 'focus'ed on something big, so don't want to freeze
      // the page by screenshoting this is a weird case to include, but
      // practical.  we'll still raise the events on the right nodes, but it
      // will be easier for the user to interact with the recording phase if
      // we don't show the node may want to send a different message in future
      // updateExistingEvent(TraceEvent, "additional.visualization",
      //   "whole page");
      return "whole page";
    }
    if (element.html2canvasDataUrl) {
      // yay, we've already done the 'screenshot', need not do it again
      // updateExistingEvent(TraceEvent, "additional.visualization",
      //   node.html2canvasDataUrl);
      return element.html2canvasDataUrl;
    }
    if (element.waitingForRender) {
      setTimeout(function() {
        window.ringerContent.additional_recording_handlers.visualization(
          element, traceEvent);
      }, 100);
      return;
    }
    if (element === document.body) {
      // never want to screenshot the whole page...can really freeze the page,
      //   and we have an easier way to refer to it
      // updateExistingEvent(TraceEvent, "additional.visualization",
      //   "whole page");
      return "whole page";
    }
    // ok, looks like this is actually the first time seeing this, better
    //   actually canvasize it
    element.waitingForRender = true;
    // HelenaConsole.log("going to render: ", node);

    html2canvas(element).then(function(canvas: HTMLCanvasElement) {
      canvas = identifyTransparentEdges(canvas);
      let dataUrl = canvas.toDataURL();
      element.html2canvasDataUrl = dataUrl;
      window.ringerContent.updateExistingEvent(traceEvent,
        "additional.visualization", dataUrl);
    });
    return null;
  };
}