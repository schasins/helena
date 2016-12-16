/**********************************************************************
 * Author: S. Chasins
 **********************************************************************/

/**********************************************************************
 * Listeners and general set up
 **********************************************************************/

var tabID = "setme";
var windowId = "setme";
var currentRecordingWindow = null;

utilities.listenForMessage("background", "content", "tabID", function(msg){tabID = msg.tab_id; windowId = msg.window_id; console.log("tab id: ", msg);});
utilities.listenForMessage("mainpanel", "content", "getRelationItems", function(msg){RelationFinder.getRelationItems(msg);});
utilities.listenForMessage("mainpanel", "content", "getFreshRelationItems", function(msg){RelationFinder.getFreshRelationItems(msg);});
utilities.listenForMessage("mainpanel", "content", "editRelation", function(msg){RelationFinder.editRelation(msg);});
utilities.listenForMessage("mainpanel", "content", "nextButtonSelector", function(msg){RelationFinder.nextButtonSelector(msg);});
utilities.listenForMessage("mainpanel", "content", "clearNextButtonSelector", function(msg){RelationFinder.clearNextButtonSelector(msg);});
utilities.listenForMessage("mainpanel", "content", "currentRecordingWindow", function(msg){currentRecordingWindow = msg.window_id;});
utilities.listenForMessage("mainpanel", "content", "backButton", function(){history.back();});
utilities.listenForMessage("mainpanel", "content", "pageStats", function(){ utilities.sendMessage("content", "mainpanel", "pageStats", {"numNodes": $('*').length});});
utilities.listenForMessage("mainpanel", "content", "runNextInteraction", function(msg){RelationFinder.runNextInteraction(msg);});
utilities.listenForMessage("mainpanel", "content", "currentColumnIndex", function(msg){RelationFinder.setEditRelationIndex(msg.index);});

utilities.listenForFrameSpecificMessage("mainpanel", "content", "likelyRelation", function(msg){return RelationFinder.likelyRelation(msg);});
utilities.listenForFrameSpecificMessage("mainpanel", "content", "getFreshRelationItems", function(msg){return RelationFinder.getFreshRelationItemsHelper(msg);});

utilities.sendMessage("content", "background", "requestTabID", {});
utilities.sendMessage("content", "mainpanel", "requestCurrentRecordingWindow", {});

/**********************************************************************
 * The various node representations we may need
 **********************************************************************/

var NodeRep = (function() { var pub = {};
	pub.nodeToMainpanelNodeRepresentation = function(node){
	  if (node === null){
	    return {text: "", link: "", xpath: "", frame: SimpleRecord.getFrameId()};
	  }
	  return {text: NodeRep.nodeToText(node), link: NodeRep.nodeToLink(node), xpath: nodeToXPath(node), frame: SimpleRecord.getFrameId()};
	};

	pub.nodeToLink = function(node){
	  if (node.href){
	    return node.href;
	  }
	  // ok, a parent may still have a link
	  var pars = $(node).parent('*[href]');
	  if (pars.length < 1){
	    return "";
	  }
	  return pars[0].href;
	}

	pub.nodeToText = function(node){
	  //var text = node.innerText;
	  return getElementText(node);
	}

	function getElementText(el){
	  var text = getElementTextHelper(el);
	  if (text == null || text == undefined || text == ""){ // should empty text also be null?
	  	if (el.value){
	  		text = el.value; // for the case where we get null text because it's an input with a value, should scrape the value
	  	}
	  	else{
	    	return null;
	  	}
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
return pub;}());
