export namespace Highlight {
  let counter = 0;
  
  /**
   * Highlight a node with a green rectangle. Uesd to indicate the target.
   * @param target the node
   * @param time delay after which to unhighlight
   */
  export function highlightNode(target: HTMLElement, time: number) {
    const offset = $(target).offset();
    const boundingBox = target.getBoundingClientRect();
    const newDiv = $('<div/>');
    const idName = 'ringer-highlight-' + counter;
    newDiv.attr('id', idName);
    newDiv.css('width', boundingBox.width);
    newDiv.css('height', boundingBox.height);
    if (offset) {
      newDiv.css('top', offset.top);
      newDiv.css('left', offset.left);
    }
    newDiv.css('position', 'absolute');
    newDiv.css('z-index', 1000);
    newDiv.css('background-color', '#00FF00');
    newDiv.css('opacity', .4);
    $(document.body).append(newDiv);
  
    if (time) {
      setTimeout(function() {
        dehighlightNode(idName);
      }, time);
    }
  
    return idName;
  }
  
  export function dehighlightNode(id: string) {
    $('#' + id).remove();
  }
}