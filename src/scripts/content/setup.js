/**********************************************************************
 * Author: S. Chasins
 **********************************************************************/

/**********************************************************************
 * Listeners and general set up
 **********************************************************************/

var tabId = "setme";
var windowId = "setme";
var tabTopUrl = "setme";
var currentRecordingWindows = null;

utilities.listenForMessage("background", "content", "tabID", function(msg){
	tabId = msg.tab_id; 
	windowId = msg.window_id;
	tabTopUrl = msg.top_frame_url;
	console.log("tabId info", tabId, windowId, tabTopUrl);
});
utilities.listenForMessage("mainpanel", "content", "getRelationItems", function(msg){RelationFinder.getRelationItems(msg);});
utilities.listenForMessage("mainpanel", "content", "getFreshRelationItems", function(msg){RelationFinder.getFreshRelationItems(msg);});
utilities.listenForMessage("mainpanel", "content", "editRelation", function(msg){RelationFinder.editRelation(msg);});
utilities.listenForMessage("mainpanel", "content", "nextButtonSelector", function(msg){RelationFinder.nextButtonSelector(msg);});
utilities.listenForMessage("mainpanel", "content", "clearNextButtonSelector", function(msg){RelationFinder.clearNextButtonSelector(msg);});
utilities.listenForMessage("mainpanel", "content", "currentRecordingWindows", function(msg){currentRecordingWindows = msg.window_ids;});
utilities.listenForMessage("mainpanel", "content", "backButton", function(){history.back();});
utilities.listenForMessage("mainpanel", "content", "pageStats", function(){ utilities.sendMessage("content", "mainpanel", "pageStats", {"numNodes": $('*').length});});
utilities.listenForMessage("mainpanel", "content", "runNextInteraction", function(msg){RelationFinder.runNextInteraction(msg);});
utilities.listenForMessage("mainpanel", "content", "currentColumnIndex", function(msg){RelationFinder.setEditRelationIndex(msg.index);});

utilities.listenForFrameSpecificMessage("mainpanel", "content", "likelyRelation",
	function (msg, sendResponse){
		MiscUtilities.registerCurrentResponseRequested(msg,
			function(m){
				var likelyRel = RelationFinder.likelyRelationWrapper(m);
				console.log('likelyRel', likelyRel);
				if (likelyRel !== null){
					sendResponse(likelyRel);
				}
			});
	}
);

utilities.listenForFrameSpecificMessage("mainpanel", "content", "getFreshRelationItems", 
	function(msg, sendResponse){
		MiscUtilities.registerCurrentResponseRequested(msg, 
			function(m){
				var freshRelationItems = RelationFinder.getFreshRelationItemsHelper(m);
				console.log('freshRelationItems', freshRelationItems);
				sendResponse(freshRelationItems);
			});
	}
);

// keep requesting this tab's tab id until we get it
MiscUtilities.repeatUntil(
		function(){utilities.sendMessage("content", "background", "requestTabID", {});},
		function(){return (tabId !== "setme" && windowId !== "setme");},
                function(){},
		1000, true);
// keep trying to figure out which window is currently being recorded until we find out
MiscUtilities.repeatUntil(
		function(){utilities.sendMessage("content", "mainpanel", "requestCurrentRecordingWindows", {});},
		function(){return (currentRecordingWindows !== null);},
                function(){},
		1000, true);

/**********************************************************************
 * The various node representations we may need
 **********************************************************************/

var NodeRep = (function _NodeRep() { var pub = {};
	pub.nodeToMainpanelNodeRepresentation = function _nodeToMainpanelNodeRepresentation(node){
	  if (node === null){
	    return {
	    	text: "", 
	    	link: "", 
	    	xpath: "", 
	    	frame: SimpleRecord.getFrameId(), 
	    	source_url: window.location.href,
	    	top_frame_source_url: tabTopUrl,
	    	date: (new Date()).getTime()
	    };
	  }
	  return {
	  	text: NodeRep.nodeToText(node), 
	  	link: NodeRep.nodeToLink(node), 
	  	xpath: nodeToXPath(node), 
	  	frame: SimpleRecord.getFrameId(),
    	source_url: window.location.href,
    	top_frame_source_url: tabTopUrl,
	    	date: (new Date()).getTime()
	  };
	};

	pub.nodeToLink = function _nodeToLink(node){
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

	pub.nodeToText = function _nodeToText(node){
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
