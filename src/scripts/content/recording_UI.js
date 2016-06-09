/**********************************************************************
 * Author: S. Chasins
 **********************************************************************/

/**********************************************************************
 * User event handlers
 **********************************************************************/

var RecordingHandlers = (function() { var pub = {};
  function targetFromEvent(event){
    return event.target;
  }

  pub.mouseoverHandler = function(event){
    if (currentlyRecording()){
      Tooltip.scrapingTooltip(targetFromEvent(event));
      RelationPreview.relationHighlight(targetFromEvent(event));
    }
    if (currentlyScraping()){
      Highlight.highlight(targetFromEvent(event));
    }
  }

  pub.mouseoutHandler = function(event){
    if (currentlyRecording()){
      Tooltip.removeScrapingTooltip();
      RelationPreview.relationUnhighlight();
    }
    if (currentlyScraping()){
      Highlight.unhighlight(targetFromEvent(event));
    }
  }

  pub.checkScrapingOn = function(event){
    if (Scraping.scrapingCriteria(event)){ 
      Scraping.startProcessingScrape();
    }
  }

  pub.checkScrapingOff = function(event){
    if (currentlyScraping() && !(Scraping.scrapingCriteria(event))){ // this is for keyup, so user is exiting the scraping mode
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
  return recording == RecordState.RECORDING; // recording variable is defined in scripts/lib/record-replay/content_script.js, tells whether r+r layer currently recording
}

function currentlyScraping(){
  return additional_recording_handlers_on.scrape;
}

/**********************************************************************
 * Highlighting, tooltips, for giving user feedback about current node
 **********************************************************************/

var Highlight = (function() { var pub = {};
  var highlightColorDefault = "#E04343";
  var currNodes = [];
  pub.highlight = function(target, highlightColor){
    if(highlightColor === undefined) { highlightColor = highlightColorDefault;}
    $target = $(target);
    $target.data("stored_background_color", window.getComputedStyle(target, null).getPropertyValue('background-color'));
    $target.data("stored_outline", window.getComputedStyle(target, null).getPropertyValue('outline'));
    currNodes.push(target);
    $target.css('background-color', highlightColor);
    $target.css('outline', highlightColor+' 1px solid');
  }

  pub.unhighlight = function(target){
    $target = $(target);
    targetString = $target.text(); // is this actually an ok identifier?
    $target.css('background-color', $target.data("stored_background_color"));
    $target.css('outline', $target.data("stored_outline"));
    var index = currNodes.indexOf(target);
    currNodes.splice(index, 1);
  }

  pub.unhighlightIfHighlighted = function(target){
    var index = currNodes.indexOf(target);
    if (index > -1){
      Highlight.unhighlight(target);
      return true;
    }
    return false;
  }

  pub.unhighlightRemaining = function(){
    for (var i = 0; i < currNodes.length; i++){
      Highlight.unhighlight(currNodes[i]);
    }
  }
return pub;}());

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
  $(function(){
    additional_recording_handlers.scrape = function(node, eventMessage){
      if (eventMessage.data.type !== "click") {return true;} //only actually scrape on clicks, but still want to record that we're in scraping mode
      var data = NodeRep.nodeToMainpanelNodeRepresentation(node,false);
      utilities.sendMessage("content", "mainpanel", "scrapedData", data);
      return data;
    };
  }); //run once page loaded, because else runs before r+r content script

  // must keep track of current hovered node so we can highlight it when the user enters scraping mode
  var mostRecentMousemoveTarget = null;
  document.addEventListener('mousemove', updateMousemoveTarget, true);
  function updateMousemoveTarget(event){
    mostRecentMousemoveTarget = event.target;
  }

  // functions for letting the record and replay layer know whether to run the additional handler above
  pub.startProcessingScrape = function(){
    additional_recording_handlers_on.scrape = true;
    Highlight.highlight(mostRecentMousemoveTarget);
  }

  pub.stopProcessingScrape = function(){
    additional_recording_handlers_on.scrape = false;
    console.log(additional_recording_handlers_on);
    console.log(currentlyScraping());
    Highlight.unhighlightRemaining();
  }

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
      var currentlyHighlighted = Highlight.unhighlightIfHighlighted(node);
      html2canvas(node, {
        onrendered: function(canvas) { 
          if (currentlyHighlighted){
            Highlight.highlight(node);
          }
          updateExistingEvent(eventMessage, "additional.visualization", canvas.toDataURL());
        }
      });
      return null;
    };
  additional_recording_handlers_on.visualization = true;
  }); //run once page loaded, because else runs before r+r content script

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
      var highlightNodes = RelationFinder.highlightRelation(relationOutput, false);
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
      // but remember we don't want to highlight the node currently being hovered in the same way
      var hoveredNodeIndex = winningRelation.nodes.indexOf(node);
      winningRelation.highlightNodes[hoveredNodeIndex].css("display", "none"); // the way flatten works and the order in which we append nodes in highlightRelation means the indexes will align
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