/**********************************************************************
 * Author: S. Chasins
 **********************************************************************/

/**********************************************************************
 * User event handlers
 **********************************************************************/

var RecordingHandlers = (function() { var pub = {};

  pub.mouseoverHandler = function(event){
    console.log(currentlyRecording(), currentlyScraping());
    if (currentlyRecording()){
      Tooltip.scrapingTooltip(MiscUtilities.targetFromEvent(event));
      RelationPreview.relationHighlight(MiscUtilities.targetFromEvent(event));
    }
    if (currentlyScraping() && currentlyRecording()){
      Scraping.scrapingMousein(event);
    }
  }

  pub.mouseoutHandler = function(event){
    if (currentlyRecording()){
      Tooltip.removeScrapingTooltip();
      RelationPreview.relationUnhighlight();
    }
    if (currentlyScraping() && currentlyRecording()){
      Scraping.scrapingMousein(event);
    }
  }

  pub.checkScrapingOn = function(event){
    console.log("checkScrapingOn", event);
    console.log(Scraping.scrapingCriteria(event));
    if (Scraping.scrapingCriteria(event)){ 
      Scraping.startProcessingScrape();
    }
  }

  pub.checkScrapingOff = function(event){
    if (currentlyScraping() && currentlyRecording() && !(Scraping.scrapingCriteria(event))){ // this is for keyup, so user is exiting the scraping mode
      Scraping.stopProcessingScrape();
    }
  }
return pub;}());

document.addEventListener('mouseover', RecordingHandlers.mouseoverHandler, true);
document.addEventListener('mouseout', RecordingHandlers.mouseoutHandler, true);
document.addEventListener('keydown', RecordingHandlers.checkScrapingOn, true);
document.addEventListener('keyup', RecordingHandlers.checkScrapingOff, true);

/**********************************************************************
 * For getting current status
 **********************************************************************/

function currentlyRecording(){
  return recording === RecordState.RECORDING && currentRecordingWindow === windowId; // recording variable is defined in scripts/lib/record-replay/content_script.js, tells whether r+r layer currently recording
}

function currentlyScraping(){
  return additional_recording_handlers_on.scrape;
}

/**********************************************************************
 * Tooltips, for giving user feedback about current node
 **********************************************************************/

var Tooltip = (function() { var pub = {};
  var tooltipColorDefault = "#DBDBDB";
  var tooltipBorderColorDefault = "#B0B0B0";
  pub.scrapingTooltip = function(node, tooltipColor, tooltipBorderColor){
    if(tooltipColor === undefined) { tooltipColor = tooltipColorDefault;}
    if(tooltipBorderColor === undefined) { tooltipBorderColor = tooltipBorderColorDefault;}
    var $node = $(node);
    var nodeText = "SHIFT + ALT + click to scrape:<br>"+NodeRep.nodeToText(node);
    var offset = $node.offset();
    var boundingBox = node.getBoundingClientRect();
    var newDiv = $('<div>'+nodeText+'<div/>');
    var width = boundingBox.width;
    if (width < 40){width = 40;}

    newDiv.attr('id', 'vpbd-hightlight');
    newDiv.css('width', width);
    newDiv.css('top', offset.top+boundingBox.height);
    newDiv.css('left', offset.left);
    newDiv.css('position', 'absolute');
    newDiv.css('z-index', 2147483647);
    newDiv.css('background-color', tooltipColor);
    newDiv.css('border', 'solid 1px '+tooltipBorderColor);
    newDiv.css('opacity', .9);
    $(document.body).append(newDiv);
  }

  pub.removeScrapingTooltip = function(){
    $('#vpbd-hightlight').remove();
  }
return pub;}());

/**********************************************************************
 * Handle scraping interaction
 **********************************************************************/

var Scraping = (function() { var pub = {};

  // note that this line must run after the r+r content script runs (to produce the additional_recording_handlers object)
  additional_recording_handlers.scrape = function(node, eventMessage){
    if (eventMessage.data.type !== "click") {return true;} //only actually scrape on clicks, but still want to record that we're in scraping mode
    var data = NodeRep.nodeToMainpanelNodeRepresentation(node,false);
    utilities.sendMessage("content", "mainpanel", "scrapedData", data);
    return data;
  };

  // must keep track of current hovered node so we can highlight it when the user enters scraping mode
  var mostRecentMousemoveTarget = null;
  document.addEventListener('mousemove', updateMousemoveTarget, true);
  function updateMousemoveTarget(event){
    mostRecentMousemoveTarget = event.target;
  }

  // functions for letting the record and replay layer know whether to run the additional handler above
  var currentHighlightNode = null
  pub.startProcessingScrape = function(){
    additional_recording_handlers_on.scrape = true;
    currentHighlightNode = Highlight.highlightNode(mostRecentMousemoveTarget, "#E04343", true, false); // want highlight shown now, want clicks to fall through
  }

  pub.stopProcessingScrape = function(){
    additional_recording_handlers_on.scrape = false;
    Highlight.clearHighlight(currentHighlightNode);
  }

  pub.scrapingMousein = function(event){
    Highlight.clearHighlight(currentHighlightNode);
    currentHighlightNode = Highlight.highlightNode(MiscUtilities.targetFromEvent(event), "#E04343", true, false);
  };

  pub.scrapingMouseout = function(event){
    Highlight.clearHighlight(currentHighlightNode);
  };

  // clicks during scraping mode are special.  don't want to follow links for example
  document.addEventListener('click', scrapingClick, true);
  function scrapingClick(event){
    if (currentlyScraping()){
      event.stopPropagation();
      event.preventDefault();
    }
  }

  pub.scrapingCriteria = function(event){
    return event.shiftKey && event.altKey; // convention is we need shift+alt+click to scrape
  }
return pub;}());

/**********************************************************************
 * For visualization purposes, it is useful for us if we can get 'snapshots' of the nodes with which we interact
 **********************************************************************/

var Visualization = (function() { var pub = {};
  $(function(){
    additional_recording_handlers.visualization = function(node, eventMessage){
      if (eventMessage instanceof KeyboardEvent){
        // ignore below.  this was when we were also checking if there was no node.value;  but in general we're having issues with trying to screenshot things for keyboard events when we really shouldn't so for now changing presentation so that there is no 'target node' for typing in the user-facing representation of the script
        // for now we're using this to determine whether the user is actually typing text into a particular node or not.  since no node.value, probably not, and we are likely to be 'focus'ed on something big, so don't want to freeze the page by screenshoting
        // this is a weird case to include, but practical.  we'll still raise the events on the right nodes, but it will be easier for the user to interact with the recording phase if we don't show the node
        // may want to send a different message in future
        updateExistingEvent(eventMessage, "additional.visualization", "whole page");
        return;
      }
      if (node.html2canvasDataUrl){
        // yay, we've already done the 'screenshot', need not do it again
        updateExistingEvent(eventMessage, "additional.visualization", node.html2canvasDataUrl);
        return;
      }
      if (node.waitingForRender){
        setTimeout(function(){additional_recording_handlers.visualization(node, eventMessage);}, 100);
        return;
      }
      if (node === document.body){
        // never want to screenshot the whole page...can really freeze the page, and we have an easier way to refer to it
        updateExistingEvent(eventMessage, "additional.visualization", "whole page");
        return;
      }
      // ok, looks like this is actually the first time seeing this, better actually canvasize it
      node.waitingForRender = true;
      console.log("going to render: ", node);
      html2canvas(node, {
        onrendered: function(canvas) { 
          canvas = identifyTransparentEdges(canvas);
          var dataUrl = canvas.toDataURL();
          node.html2canvasDataUrl = dataUrl;
          updateExistingEvent(eventMessage, "additional.visualization", dataUrl);
        }
      });
      return null;
    };
  additional_recording_handlers_on.visualization = true;
  }); //run once page loaded, because else runs before r+r content script

  function identifyTransparentEdges(canvas){
    var context = canvas.getContext("2d");
    var imgData = context.getImageData(0,0,canvas.width,canvas.height);
    var data = imgData.data;

    // what rows and columns are empty?

    var columnsEmpty = [];
    for (var i = 0; i < canvas.width; i++){
      columnsEmpty.push(true);
    }
    var rowsEmpty = [];
    for (var i = 0; i < canvas.height; i++){
      rowsEmpty.push(true);
    }

    for(var i=0; i<data.length; i+=4) {
      var currX = (i / 4) % canvas.width,
        currY = ((i / 4) - currX) / canvas.width;
      var alpha = data[i+3];
      if (alpha > 0){
        columnsEmpty[currX] = false;
        rowsEmpty[currY] = false;
      }
    }

    // how far should we crop?

    var left = 0;
    var i = left;
    while (columnsEmpty[i]){
      left = i;
      i += 1;
    }

    var right = canvas.width - 1;
    var i = right;
    while (columnsEmpty[i]){
      right = i;
      i -= 1;
    }

    var top = 0;
    var i = top;
    while (rowsEmpty[i]){
      top = i;
      i += 1;
    }
    
    var bottom = canvas.height - 1;
    var i = bottom;
    while (rowsEmpty[i]){
      bottom = i;
      i -= 1;
    }

    if (left === 0 && right === (canvas.width - 1) && top === 0 && bottom === (canvas.height - 1)){
      // no need to do any cropping
      return canvas;
    }

    // use a temporary canvas to crop
    var tempCanvas = document.createElement("canvas"),
        tContext = tempCanvas.getContext("2d");
    tempCanvas.width = (right - left);
    tempCanvas.height = (bottom - top);
    tContext.drawImage(canvas, left, top, tempCanvas.width, tempCanvas.height, 0, 0, tempCanvas.width, tempCanvas.height);

    console.log(canvas.width, canvas.height);
    console.log(left, right, top, bottom);
    console.log(tempCanvas.width, tempCanvas.height);

    return tempCanvas;
  }

return pub;}());

/**********************************************************************
 * We may want to give users previews of the relations we can find on their pages.  When hover, highlight.
 **********************************************************************/

var RelationPreview = (function() { var pub = {};
  var knownRelations = [];
  function setup(){
    console.log("running setup");
    $.post('https://visual-pbd-scraping-server.herokuapp.com/allpagerelations', { url: window.location.href }, function(resp){ 
      console.log(resp);
      knownRelations = resp.relations;
      preprocessKnownRelations();
    });
  }
  // we need to tell the record+replay layer what we want to do when a tab leanrs it's recording
  addonStartRecording.push(setup);

  var knownRelationsInfo = [];
  function preprocessKnownRelations(){
    // first let's apply each of our possible relations to see which nodes appear in them
    // then let's make a set of highlight nodes for each relation, so we can toggle them between hidden and displayed based on user's hover behavior.
    for (var i = 0; i < knownRelations.length; i++){
      var selectorObj = knownRelations[i];
      ServerTranslationUtilities.unJSONifyRelation(selectorObj);
      var relationOutput = RelationFinder.interpretRelationSelector(selectorObj);
      var nodeList = _.flatten(relationOutput);
      var highlightNodes = RelationFinder.highlightRelation(relationOutput, false, false);
      knownRelationsInfo.push({selectorObj: selectorObj, nodes: nodeList, highlightNodes: highlightNodes, highlighted: false});
    }  
  }

  pub.relationHighlight = function(node){
    // for now we'll just pick whichever node includes the current node and has the largest number of nodes on the current page
    var winningRelation = null;
    var winningRelationSize = 0;
    for (var i = 0; i < knownRelationsInfo.length; i++){
      var relationInfo = knownRelationsInfo[i];
      if (relationInfo.nodes.indexOf(node) > -1){
        if (relationInfo.nodes.length > winningRelationSize){
          winningRelation = relationInfo;
          winningRelationSize = relationInfo.nodes.length;
        }
      }
    }
    if (winningRelation !== null){
      // cool, we have a relation to highlight
      winningRelation.highlighted = true;
      for (var i = 0; i < winningRelation.highlightNodes.length; i++){
        var n = winningRelation.highlightNodes[i];
        n.css("display", "block");
      }
    }

  };

  pub.relationUnhighlight = function(){
    for (var i = 0; i < knownRelationsInfo.length; i++){
      var relationInfo = knownRelationsInfo[i];
      if (relationInfo.highlighted){
        for (var j = 0; j < relationInfo.highlightNodes.length; j++){
          var node = relationInfo.highlightNodes[j];
          node.css("display", "none");
        }
      }
    }
  };

return pub;}());