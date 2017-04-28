/**********************************************************************
 * Author: S. Chasins
 **********************************************************************/

/**********************************************************************
 * User event handlers
 **********************************************************************/

var RecordingHandlers = (function _RecordingHandlers() { var pub = {};

  pub.mouseoverHandler = function _mouseoverHandler(event){
    if (currentlyRecording()){
      Tooltip.scrapingTooltip(MiscUtilities.targetFromEvent(event));
      RelationPreview.relationHighlight(MiscUtilities.targetFromEvent(event));
    }
    // just a backup in case the checks on keydown and keyup fail to run, as seems to happen sometimes with focus issues
    pub.updateScraping(event);
    if (currentlyScraping() && currentlyRecording()){
      Scraping.scrapingMousein(event);
    }
  }

  pub.mouseoutHandler = function _mouseoutHandler(event){
    if (currentlyRecording()){
      Tooltip.removeScrapingTooltip();
      RelationPreview.relationUnhighlight();
    }
    // just a backup in case the checks on keydown and keyup fail to run, as seems to happen sometimes with focus issues
    pub.updateScraping(event);
    if (currentlyScraping() && currentlyRecording()){
      Scraping.scrapingMousein(event);
    }
  }

  // scraping is happening if ctrl and c are held down
  ctrlDown = false;
  altDown = false;

  pub.updateScraping = function _updateScraping(event){
    pub.updateScrapingTrackingVars(event);
    pub.checkScrapingOn();
    pub.checkScrapingOff();
  };

  pub.updateScrapingTrackingVars = function _updateScrapingTrackingVars(event){
    if (event.ctrlKey){
      ctrlDown = true;
    }
    else{
      ctrlDown = false;
    }

    if (event.altKey){
      altDown = true;
    }
    else{
      altDown = false;
    }
  };

  pub.checkScrapingOn = function _checkScrapingOn(){
    if (!currentlyScraping() && (altDown)){
      Scraping.startProcessingScrape();
    }
  };

  pub.checkScrapingOff = function _checkScrapingOff(){
    if (currentlyScraping() && currentlyRecording() && !(altDown)){
      Scraping.stopProcessingScrape();
    }
  }
return pub;}());

document.addEventListener('mouseover', RecordingHandlers.mouseoverHandler, true);
document.addEventListener('mouseout', RecordingHandlers.mouseoutHandler, true);
document.addEventListener('keydown', RecordingHandlers.updateScraping, true);
document.addEventListener('keyup', RecordingHandlers.updateScraping, true);

/**********************************************************************
 * For getting current status
 **********************************************************************/

function currentlyRecording(){
  return recording === RecordState.RECORDING && currentRecordingWindows.indexOf(windowId) > -1; // recording variable is defined in scripts/lib/record-replay/content_script.js, tells whether r+r layer currently recording
}

function currentlyScraping(){
  return additional_recording_handlers_on.scrape;
}

/**********************************************************************
 * Tooltips, for giving user feedback about current node
 **********************************************************************/

var Tooltip = (function _Tooltip() { var pub = {};
  var tooltipColorDefault = "#DBDBDB";
  var tooltipBorderColorDefault = "#B0B0B0";
  pub.scrapingTooltip = function _scrapingTooltip(node, tooltipColor, tooltipBorderColor){
    if(tooltipColor === undefined) { tooltipColor = tooltipColorDefault;}
    if(tooltipBorderColor === undefined) { tooltipBorderColor = tooltipBorderColorDefault;}
    var $node = $(node);
    // var nodeText = MiscUtilities.scrapeConditionString+" to scrape:<br>"+NodeRep.nodeToText(node)+"<br>"+MiscUtilities.scrapeConditionLinkString+" to scrape:<br>"+NodeRep.nodeToLink(node);
    var nodeText = NodeRep.nodeToText(node);
    if (nodeText.length > 100){
      nodeText = nodeText.slice(0,50)+"..."+nodeText.slice(nodeText.length - 50, nodeText.length);
    }
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

  pub.removeScrapingTooltip = function _removeScrapingTooltip(){
    $('#vpbd-hightlight').remove();
  }
return pub;}());

/**********************************************************************
 * Handle scraping interaction
 **********************************************************************/

var Scraping = (function _Scraping() { var pub = {};

  // note that this line must run after the r+r content script runs (to produce the additional_recording_handlers object)
  additional_recording_handlers.scrape = function(node, eventMessage){
    var data = NodeRep.nodeToMainpanelNodeRepresentation(node,false);
    var linkScraping = eventMessage.data.shiftKey || eventMessage.data.metaKey; // convention is SHIFT means we want to scrape the link, not the text 
    data.linkScraping = linkScraping;
    if (eventMessage.data.type === "click") {
      utilities.sendMessage("content", "mainpanel", "scrapedData", data);
    } // send it to the mainpanel for visualization
    return data;
  };

  additional_recording_filters.scrape = function(eventData){
    return false;

    /*
    if (eventData.keyCode === 66 && (eventData.type === "keypress" || eventData.type === "keydown")){
      // we're going to see a ton of these because holding c for scraping mode makes them.  we're going to ignore, although this could cause problems for some interactions
      return true;
    }
    return false;
    */
    /*
    if (eventData.type === "click"){
      return false; // this is a scraping event, so want to keep it; don't filter
    }
    else if (eventData.keyCode === 18){
      return false; // 18 is alt.  need to listen to this so we can have that turned on for link scraping
    } 
    else if (eventData.type === "keyup"){
      return false; // keyup events can end our scraping mode, so keep those
    }
    return true; // filter everything else
    */
    /*
    else if (eventData.keyCode === "c" && eventData.type !== "keyup") { // c is the special case because this is the one we're pressing down so we'll get a ton if we're not careful
      return true; // true says to drop the event.  c is the one we want to get rid of, unless it's 
    }
    return false;
    */
  }

  // must keep track of current hovered node so we can highlight it when the user enters scraping mode
  var mostRecentMousemoveTarget = null;
  document.addEventListener('mousemove', updateMousemoveTarget, true);
  function updateMousemoveTarget(event){
    mostRecentMousemoveTarget = event.target;
  }

  // functions for letting the record and replay layer know whether to run the additional handler above
  var currentHighlightNode = null
  pub.startProcessingScrape = function _startProcessingScrape(){
    additional_recording_handlers_on.scrape = true;
    additional_recording_filters_on.scrape = true;
    currentHighlightNode = Highlight.highlightNode(mostRecentMousemoveTarget, "#E04343", true, false); // want highlight shown now, want clicks to fall through
  }

  pub.stopProcessingScrape = function _stopProcessingScrape(){
    additional_recording_handlers_on.scrape = false;
    additional_recording_filters_on.scrape = false;
    Highlight.clearHighlight(currentHighlightNode);
  }

  pub.scrapingMousein = function _scrapingMousein(event){
    Highlight.clearHighlight(currentHighlightNode);
    currentHighlightNode = Highlight.highlightNode(MiscUtilities.targetFromEvent(event), "#E04343", true, false);
  };

  pub.scrapingMouseout = function _scrapingMouseout(event){
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

  pub.scrapingCriteria = function _scrapingCriteria(event){
    return event.shiftKey && event.altKey; // convention is we need shift+alt+click to scrape
  }
return pub;}());

/**********************************************************************
 * For visualization purposes, it is useful for us if we can get 'snapshots' of the nodes with which we interact
 **********************************************************************/

var Visualization = (function _Visualization() { var pub = {};
  $(function(){
    additional_recording_handlers.visualization = function(node, eventMessage){
      if (!currentlyRecording()){
        // don't want to run this visualization stuff if we're in replay mode rather than recording mode, even though of course we're recording during replay
        return;
      }
      if (eventMessage instanceof KeyboardEvent){
        // ignore below.  this was when we were also checking if there was no node.value;  but in general we're having issues with trying to screenshot things for keyboard events when we really shouldn't so for now changing presentation so that there is no 'target node' for typing in the user-facing representation of the script
        // for now we're using this to determine whether the user is actually typing text into a particular node or not.  since no node.value, probably not, and we are likely to be 'focus'ed on something big, so don't want to freeze the page by screenshoting
        // this is a weird case to include, but practical.  we'll still raise the events on the right nodes, but it will be easier for the user to interact with the recording phase if we don't show the node
        // may want to send a different message in future
        // updateExistingEvent(eventMessage, "additional.visualization", "whole page");
        return "whole page";
      }
      if (node.html2canvasDataUrl){
        // yay, we've already done the 'screenshot', need not do it again
        // updateExistingEvent(eventMessage, "additional.visualization", node.html2canvasDataUrl);
        return node.html2canvasDataUrl;
      }
      if (node.waitingForRender){
        setTimeout(function(){additional_recording_handlers.visualization(node, eventMessage);}, 100);
        return;
      }
      if (node === document.body){
        // never want to screenshot the whole page...can really freeze the page, and we have an easier way to refer to it
        // updateExistingEvent(eventMessage, "additional.visualization", "whole page");
        return "whole page";
      }
      // ok, looks like this is actually the first time seeing this, better actually canvasize it
      node.waitingForRender = true;
      // WALconsole.log("going to render: ", node);
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

    // WALconsole.log(canvas.width, canvas.height);
    // WALconsole.log(left, right, top, bottom);
    // WALconsole.log(tempCanvas.width, tempCanvas.height);

    return tempCanvas;
  }

return pub;}());

/**********************************************************************
 * We may want to give users previews of the relations we can find on their pages.  When hover, highlight.
 **********************************************************************/

var RelationPreview = (function _RelationPreview() { var pub = {};
  var knownRelations = [];
  function setup(){
    WALconsole.log("running setup");
    // have to use postForMe right now to make the extension do the acutal post request, because modern Chrome won't let us
    // requrest http content from https pages and we don't currently have ssl certificate for kaofang
    utilities.sendMessage("content", "background", "postForMe", {url: 'http://kaofang.cs.berkeley.edu:8080/allpagerelations', params: { url: window.location.href }});
    utilities.listenForMessageOnce("background", "content", "postForMe", function(resp){
      WALconsole.log(resp);
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
      selectorObj = ServerTranslationUtilities.unJSONifyRelation(selectorObj);
      var relationOutput = RelationFinder.interpretRelationSelector(selectorObj);
      var nodeList = _.flatten(relationOutput);
      var highlightNodes = RelationFinder.highlightRelation(relationOutput, false, false);
      knownRelationsInfo.push({selectorObj: selectorObj, nodes: nodeList, highlightNodes: highlightNodes, highlighted: false});
    }  
  }

  pub.relationHighlight = function _relationHighlight(node){
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

  pub.relationUnhighlight = function _relationUnhighlight(){
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