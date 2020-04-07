import { HelenaConsole } from "../../common/utils/helena_console";

interface Highlightable {
  highlightElement?: HTMLElement;
}

export namespace Highlight {
  let counter = 0;
  let highlights: JQuery<HTMLElement>[] = [];
  
  export function highlightNode(target: HTMLElement, color: string,
      display = true, pointerEvents = false) {
    if (!target){
      HelenaConsole.log("Woah woah woah, why were you trying to highlight a " +
        "null or undefined thing?");
      return $('<div/>');
    }
    counter += 1;
    const $target = $(target);
    const offset = $target.offset();
    if (!target.getBoundingClientRect){
      // document sometimes gets hovered, and there's no getboundingclientrect
      //   for it
      return;
    }
    const boundingBox = target.getBoundingClientRect();
    const newDiv: JQuery<HTMLElement> & Highlightable = $('<div/>');
    const idName = 'vpbd-hightlight-' + counter;
    newDiv.attr('id', idName);
    newDiv.css('width', boundingBox.width);
    newDiv.css('height', boundingBox.height);
    if (offset) {
      newDiv.css('top', offset.top);
      newDiv.css('left', offset.left);
    }
    newDiv.css('position', 'absolute');
    newDiv.css('z-index', 2147483640);
    newDiv.css('background-color', color);
    newDiv.css('opacity', .4);
    if (!display) {
      newDiv.css('display', 'none');
    }
    if (!pointerEvents) {
      newDiv.css('pointer-events', 'none');
    }
    $(document.body).append(newDiv);
    highlights.push(newDiv);
    (<Highlightable> newDiv.get(0)).highlightElement = target;
    return newDiv;
  }

  export function isHighlight(node: HTMLElement){
    var id = $(node).attr("id");
    return id !== null && id !== undefined &&
           id.indexOf("vpbd-hightlight") > -1;
  }

  export function getHighlightedElement(node: HTMLElement & Highlightable) {
    return node.highlightElement;
  }

  export function clearHighlight(highlightNode?: JQuery<HTMLElement>) {
    if (!highlightNode){
      return;
    }
    highlights = highlights.filter((node) => node !== highlightNode);
    highlightNode.remove();
  }

  export function clearAllHighlights() {
    for (const highlight of highlights) {
      highlight.remove();
    }
    highlights = [];
  }
}