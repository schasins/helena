/**********************************************************************
 * Author: S. Chasins
 **********************************************************************/

/**********************************************************************
 * Listeners and general set up
 **********************************************************************/
 var tabID = "setme";

//user event handling
document.addEventListener('mouseover', outline, true);
document.addEventListener('mouseout', unoutline, true);
document.addEventListener('click', scrapingClick, true);
document.addEventListener('keydown', checkScrapingOn, true);
document.addEventListener('keyup', checkScrapingOff, true);

//for debugging purposes, print this tab's tab id
utilities.listenForMessage("background", "content", "tabID", function(msg){tabID = msg; console.log("tab id: ", msg);});
utilities.sendMessage("content", "background", "requestTabID", {});

/**********************************************************************
 * Color guide to show users the node they're about to select
 **********************************************************************/

 var stored_background_colors = {};
 var stored_outlines = {};

 function off(){
  return !currentlyScraping();
 }

 function targetFromEvent(event){
  var $target = $(event.target);
  return $target.get(0);
}

function outline(event){
  var node = targetFromEvent(event);
  var $node = $(node);
  var nodeText = nodeToText(node);
  if (nodeText == null){
    return; // scraping empty text doesn't make sense
  }
  $node.attr('data-tip', "CTRL+SHIFT+click to scrape:\n"+nodeText);
  if (!$node.hasClass("tip")){
    $node.addClass("tip");
    $node.tipr();
  }
  if (off()){return;}
  outlineTarget(node);
}

function outlineTarget(target){
  current_target = target;
  $target = $(target);
  targetString = $target.html(); // todo: is this actually an ok identifier?
  // stored_background_colors[$target.html()] = $target.css('background-color');
  stored_background_colors[targetString] = window.getComputedStyle(target, null).getPropertyValue('background-color');
  // stored_outlines[$target.html()] = $target.css('outline');
  stored_outlines[targetString] = window.getComputedStyle(target, null).getPropertyValue('outline');
  $target.css('background-color', '#FFA245');
  $target.css('outline', '#FFA245 1px solid');
  // todo: see about maybe having a timeout to unoutline also
}

function unoutline(event){
  if (off()){return;}
  unoutlineTarget(targetFromEvent(event));
}

function unoutlineTarget(target){
  $target = $(target);
  targetString = $target.html(); // is this actually an ok identifier?
  $target.css('background-color', stored_background_colors[targetString]);
  $target.css('outline', stored_outlines[targetString]);
}

/**********************************************************************
 * The various node representations we may need
 **********************************************************************/

function nodeToMainpanelNodeRepresentation(node,parameterize){
  if(typeof(parameterize)==='undefined') {parameterize = true;}
  if (node === null){
    return {text: "", xpath: "", frame: SimpleRecord.getFrameId(), parameterize:parameterize};
  }
  return {text: nodeToText(node), xpath: nodeToXPath(node), frame: SimpleRecord.getFrameId(), parameterize: parameterize};
}

function nodeToText(node){
  //var text = node.innerText;
  return getElementText(node);
}

function getElementText(el){
  var text = getElementTextHelper(el);
  if (text == null || text == undefined || text == ""){ // should empty text also be null?
    return null;
  }
  text = text.trim();
  return text;
}

function getElementTextHelper(el) {
    var text = '';
    // Text node (3) or CDATA node (4) - return its text
    if ( (el.nodeType === 3) || (el.nodeType === 4) ) {
        return el.nodeValue.trim();
    // If node is an element (1) and an img, input[type=image], or area element, return its alt text
    }
    else if ( (el.nodeType === 1) && (
            (el.tagName.toLowerCase() == 'img') ||
            (el.tagName.toLowerCase() == 'area') ||
            ((el.tagName.toLowerCase() == 'input') && el.getAttribute('type') && (el.getAttribute('type').toLowerCase() == 'image'))
            ) ) {
        altText = el.getAttribute('alt')
        if (altText == null || altText == undefined){
          altText = ''
        }
        return altText.trim();
        return el.getAttribute('alt').trim() || '';
    }
    // Traverse children unless this is a script or style element
    else if ( (el.nodeType === 1) && !el.tagName.match(/^(script|style)$/i)) {
        var text = "";
        var children = el.childNodes;
        for (var i = 0, l = children.length; i < l; i++) {
            var childClassName = children[i].className;
            if (childClassName != undefined && childClassName.indexOf("tipr_container") > -1){
              continue; // this was added to give the user a tooltip.  shouldn't be in text
            }
            var newText = getElementText(children[i]);
            if (newText == null || newText == undefined){
              newText = "";
            }
            if (newText.length > 0){
              text+=newText+"\n";
            }
        }
        return text;
    }
}


/**********************************************************************
 * Handle scraping interaction
 **********************************************************************/

 $(function(){
  additional_recording_handlers.scrape = function(node, eventData){
    if (eventData.type !== "click") {return null;} //only care about clicks
    var data = nodeToMainpanelNodeRepresentation(node,false);
    utilities.sendMessage("content", "mainpanel", "scrapedData", data);
    console.log("scrape", data);
    return data;
  };
}); //run once page loaded, because else runs before r+r content script


// functions for letting the record and replay layer know whether to run the additional handler above
function startProcessingScrape(){
  additional_recording_handlers_on.scrape = true;
}

function stopProcessingScrape(){
  additional_recording_handlers_on.scrape = false;
}

function scrapingClick(event){
  if (additional_recording_handlers_on.scrape){
    event.stopPropagation();
    event.preventDefault();
  }
}

function currentlyScraping(){
  return additional_recording_handlers_on.scrape;
}

function checkScrapingOn(event){
  if (event.ctrlKey && event.keyCode == 67){ // convention is we need ctrl+c+click to scrape
    startProcessingScrape();
  }
}

function checkScrapingOff(event){
  if (currentlyScraping() && event.keyCode == 67){ // this is for keyup, so user is exiting the scraping mode
    stopProcessingScrape();
  }
}