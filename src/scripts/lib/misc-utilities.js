var utilities = (function() { var pub = {};

  var sendTypes = {
    NORMAL: 0,
    FRAMESPECIFIC: 1
  };

  var listenerCounter = 1;
  var runtimeListeners = {};
  var extensionListeners = {};

  chrome.runtime.onMessage.addListener(function(msg, sender) {
    for (var key in runtimeListeners){
      runtimeListeners[key](msg, sender);
    }
  });

  chrome.extension.onMessage.addListener(function(msg, sender) {
    // console.log("keys", Object.keys(extensionListeners));
    for (var key in extensionListeners){
      // console.log("key", key);
      extensionListeners[key](msg, sender);
    }
  });

  pub.listenForMessage = function(from, to, subject, fn, key){
    if (key === undefined){ key = listenerCounter; }
    console.log("Listening for messages: "+ from+" : "+to+" : "+subject);
    listenerCounter += 1;
    if (to === "background" || to === "mainpanel"){
      runtimeListeners[key] = function(msg, sender) {
        if (msg.from && (msg.from === from) && msg.subject && (msg.subject === subject) && (msg.send_type === sendTypes.NORMAL)) {
          msg.content.tab_id = sender.tab.id;
          console.log("Receiving message: ", msg);
          console.log("from tab id: ", sender.tab.id);
          fn(msg.content);
          return true;
        }
        return false;
      };
    }
    else if (to === "content"){
      // console.log("content listener", key, subject);
      extensionListeners[key] = function(msg, sender) {
        // console.log(msg, sender);
        var frame_id = SimpleRecord.getFrameId();
        if (msg.frame_ids_include && msg.frame_ids_include.indexOf(frame_id) < -1){
          console.log("Msg for frames with ids "+msg.frame_ids_include+", but this frame has id "+frame_id+".");
          return false;
        }
        else if (msg.frame_ids_exclude && msg.frame_ids_exclude.indexOf(frame_id) > -1){
          console.log("Msg for frames without ids "+msg.frame_ids_exclude+", but this frame has id "+frame_id+".");
          return false;
        }
        else if (msg.from && (msg.from === from) && msg.subject && (msg.subject === subject) && (msg.send_type === sendTypes.NORMAL)) {
          console.log("Receiving message: ", msg);
          fn(msg.content);
          return true;
        }
        else{
          // console.log("Received message, but not a match for current listener.");
          // console.log(msg.from, from, (msg.from === from), msg.subject, subject, (msg.subject === subject), (msg.send_type === sendTypes.NORMAL));
          return false;
        }
      };
    }
  };

  // note that this frameSpecificMessage assume we'll have a response handler, so fn should provide a return value, rather than sending its own messages
  pub.listenForFrameSpecificMessage = function(from, to, subject, fn){
    console.log("Listening for frame-specific messages: "+ from+" : "+to+" : "+subject);
    chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
      if (msg.subject === subject && msg.send_type === sendTypes.FRAMESPECIFIC){
        console.log("Receiving frame-specific message: ", msg);
        sendResponse(fn(msg.content));
      }
    });
  }

  var oneOffListenerCounter = 1;

  pub.listenForMessageOnce = function(from, to, subject, fn){
    console.log("Listening once for message: "+ from+" : "+to+" : "+subject);
    var key = "oneoff_"+oneOffListenerCounter;
    var newfunc = null;
    oneOffListenerCounter += 1;
    if (to === "background" || to === "mainpanel"){
      newfunc = function(msg){delete runtimeListeners[key]; fn(msg);};
    }
    else if (to === "content"){
      newfunc = function(msg){delete extensionListeners[key]; fn(msg);};
    }
    pub.listenForMessage(from, to, subject, newfunc, key);
  }

  pub.listenForMessageWithKey = function(from, to, subject, key, fn){
    console.log("Listening for message with key: "+ from+" : "+to+" : "+subject);
    pub.listenForMessage(from, to, subject, fn, key);
  }

  pub.stopListeningForMessageWithKey = function(from, to, subect, key){
    // console.log("deleting key", key);
    if (to === "background" || to === "mainpanel"){
      delete runtimeListeners[key];
    }
    else if (to === "content"){
      delete extensionListeners[key];
    }
  }

  pub.sendMessage = function(from, to, subject, content, frame_ids_include, frame_ids_exclude, tab_ids_include, tab_ids_exclude){ // note: frame_ids are our own internal frame ids, not chrome frame ids
    if ((from ==="background" || from ==="mainpanel") && to === "content"){
      var msg = {from: from, subject: subject, content: content, frame_ids_include: frame_ids_include, frame_ids_exclude: frame_ids_exclude};
      msg.send_type = sendTypes.NORMAL;
      console.log("Sending message: ", msg);
      console.log(tab_ids_include, tab_ids_exclude);
      if (tab_ids_include){
        for (var i =0; i<tab_ids_include.length; i++){
          chrome.tabs.sendMessage(tab_ids_include[i], msg); 
        } 
        console.log("(Sent to ", tab_ids_include.length, " tabs: ", tab_ids_include, " )");
      }
      else{
          chrome.tabs.query({windowType: "normal"}, function(tabs){
            tabs_messaged = 0;
            for (var i =0; i<tabs.length; i++){
              if (!(tab_ids_exclude && tab_ids_exclude.indexOf(tabs[i].id) > -1)){
                chrome.tabs.sendMessage(tabs[i].id, msg); 
                tabs_messaged ++;
              }
            }
            console.log("(Sent to "+tabs_messaged+" tabs.)");
        });
      }
    }
    else if (from === "content") {
      var msg = {from: "content", subject: subject, content: content};
      msg.send_type = sendTypes.NORMAL;
      console.log("Sending message: ", msg);
      chrome.runtime.sendMessage(msg);
    }
  };

  pub.sendFrameSpecificMessage = function(from, to, subject, content, chromeTabId, chromeFrameId, responseHandler){ // note: not the same as our interna frame ids
    var msg = {from: from, subject: subject, content: content};
    msg.send_type = sendTypes.FRAMESPECIFIC;
    console.log("Sending frame-specific message: ", msg);
    chrome.tabs.sendMessage(chromeTabId, msg, {frameId: chromeFrameId}, responseHandler);
  }

return pub; }());

var DOMCreationUtilities = (function() { var pub = {};

  pub.replaceContent = function(div1, div2){
    var div2clone = div2.clone();
    div1.html(div2clone.html());
  };

  pub.arrayOfTextsToTableRow = function(array){
      var $tr = $("<tr></tr>");
      for (var j= 0; j< array.length; j++){
        var $td = $("<td></td>");
        $td.html(_.escape(array[j]).replace(/\n/g,"<br>"));
        $tr.append($td);
      }
      return $tr;
    }

  pub.arrayOfArraysToTable = function(arrayOfArrays){
      var $table = $("<table></table>");
      for (var i = 0; i< arrayOfArrays.length; i++){
        var array = arrayOfArrays[i];
        $tr = DOMCreationUtilities.arrayOfTextsToTableRow(array);
        $table.append($tr);
      }
      return $table;
    }

return pub; }());

/*
A very important set of utilities for reviving objects that have been stringified
(as for sending to the server) but have returned to us, and need to be used as
proper objects again.
We always store all the fields; it's the methods we lose.  So we basically, when it 
comes time to revive it, want to union the attributes of the now unstringified dict
and the prototype, grabbing the methods back from the prototype.
*/
var Revival = (function(){ var pub = {};

  var revivalLabels = {};

  pub.introduceRevivalLabel = function(label, prototype){
    revivalLabels[label] = prototype;
  };

  pub.addRevivalLabel = function(object){
    for (var prop in revivalLabels){
      if (object instanceof revivalLabels[prop]){
        object.___revivalLabel___ = prop;
        return;
      }
    }
    console.log("No known revival label for the type of object:", object);
  };

  var seen = [];
  var fullSeen = [];
  pub.revive = function(objectAttributes, topLevel){
    if (topLevel === undefined){
      seen = []; // we're going to be handling circular objects, so have to keep track of what we've already handled
      fullSeen = [];
    }

    // ok, now let's figure out what kind of case we're dealing with
    if (typeof objectAttributes !== "object" || objectAttributes === null){ // why is null even an object?
      return objectAttributes; // nothing to do here
    }
    else if (seen.indexOf(objectAttributes) > -1){
      // already seen it
      var i = seen.indexOf(objectAttributes);
      return fullSeen[i]; // get the corresponding revived object
    }
    else{
      // ok, it's an object and we haven't processed it before
      var fullObj = objectAttributes;
      if (objectAttributes.___revivalLabel___){
        // ok, we actually want to revive this very object
        var prototype = revivalLabels[objectAttributes.___revivalLabel___];
        fullObj = new prototype();
        _.extend(fullObj, objectAttributes);
        // now the fullObj is restored to having methods and such
      }
      seen.push(objectAttributes);
      fullSeen.push(fullObj);
      // ok, whether we revived this obj or not, we definitely have to descend
      for (var prop in objectAttributes){
        var val = objectAttributes[prop];
        var fullVal = pub.revive(val, false);
        fullObj[prop] = fullVal; // must replace the old fields-only val with the proper object val
      }
    }
    return fullObj;
  };

return pub; }());

var ServerTranslationUtilities = (function() { var pub = {};

  // for when we want to send a relation object to the server
  pub.JSONifyRelation = function(origRelation){
    // ok, first let's get the nice dictionary-looking version that we use for passing relations around, instead of our internal object representation that we use in the mainpanel/program
    var relationDict = origRelation.messageRelationRepresentation();
    // let's start by deep copying so that we can JSONify the selector, next_button_selector, and column suffixes without messing up the real object
    relation = JSON.parse(JSON.stringify(relationDict)); // deepcopy
    // now that it's deep copied, we can safely strip out jsog stuff that we don't want in there, since it will
    // interfere with our canonicalization process
    MiscUtilities.removeAttributeRecursive(relation, "__jsogObjectId");
    relation.selector = StableStringify.stringify(relation.selector);
    relation.next_button_selector = StableStringify.stringify(relation.next_button_selector);
    for (var k = 0; k < relation.columns.length; k++){
      relation.columns[k].suffix = StableStringify.stringify(relation.columns[k].suffix); // is this the best place to deal with going between our object attributes and the server strings?
    }
    console.log("relation after jsonification", relation);
    return relation;
  };

  // for when we get a relation back from the server
  pub.unJSONifyRelation = function(relationDict){
    console.log("relationDict", relationDict);
    console.log("stringified relationDict", JSON.stringify(relationDict));
    // let's leave the original dictionary with it's JSONified attributes alone by deepcopying first
    relation = JSON.parse(JSON.stringify(relationDict)); // deepcopy
    relation.selector = JSON.parse(relation.selector);
    if (relation.next_button_selector){
      relation.next_button_selector = JSON.parse(relation.next_button_selector);
    }
    else{
      relation.next_button_selector = null;
    }
    for (var k = 0; k < relation.columns.length; k++){
      relation.columns[k].suffix = JSON.parse(relation.columns[k].suffix); // is this the best place to deal with going between our object attributes and the server strings?
    }
    return relation;
  };

  pub.JSONifyProgram = function(origProgram){
    // let's start by deep copying so that we can delete stuff and mess around without messing up the real object
    programAttributes = JSOG.parse(JSOG.stringify(origProgram)); // deepcopy
    var program = Revival.revive(programAttributes); // copy all those fields back into a proper Program object
    // relations aren't part of a JSONified program, because this is just the string part that will be going into a single db column
    // we want interesting info like what relations it uses to be stored in a structured way so we can reason about it, do interesting stuff with it
    // so blank out relations

    // for now, even though we are separately saving proper representations of the relations involved
    // let's also save these relation associated with the current prog, so user doesn't get any surprises
    // can later allow them to update from server if it's failing...
    /*
    program.traverse(function(statement){
      if (statement instanceof WebAutomationLanguage.LoopStatement){
        console.log(program.relations.indexOf(statement.relation));
        statement.relation = program.relations.indexOf(statement.relation); // note this means we must have the relations in same order from server that we have them here
      }
    });
    delete program.relations;
    */
    return JSOG.stringify(program);
  };

  pub.unJSONifyProgram = function(stringifiedProg){
    programAttributes = JSOG.parse(stringifiedProg);
    var program = Revival.revive(programAttributes); // copy all those fields back into a proper Program object
    return program;
  };

return pub; }());

var MiscUtilities = (function() { var pub = {};

  pub.scrapeConditionString = "ALT + click";
  pub.scrapeConditionLinkString = "ALT + SHIFT + click";
  var osString = window.navigator.platform;
  if (osString.indexOf("Linux") > -1){
    // there's a weird thing where just ALT + click doesn't raise events in Linux Chrome
    // pressing CTRL at the same time causes the events to be raised without (at the moment, apparently) messing up other stuff
    pub.scrapeConditionString = "ALT + CTRL + click";
    pub.scrapeConditionLinkString = "ALT + CTRL + SHIFT + click";
  }

  // this is silly, but it does seem the easiest way to deal with this
  pub.useCorrectScrapingConditionStrings = function(selectorstring, normalScrapeStringToReplace, linkScrapeStringToReplace){
    $(selectorstring).html($(selectorstring).html().replace(new RegExp(normalScrapeStringToReplace,"g"), pub.scrapeConditionString));
    $(selectorstring).html($(selectorstring).html().replace(new RegExp(linkScrapeStringToReplace,"g"), pub.scrapeConditionLinkString));
  }

  pub.levenshteinDistance = function(a, b) {
    if(a.length === 0) return b.length; 
    if(b.length === 0) return a.length; 

    var matrix = [];

    // increment along the first column of each row
    var i;
    for(i = 0; i <= b.length; i++){
      matrix[i] = [i];
    }

    // increment each column in the first row
    var j;
    for(j = 0; j <= a.length; j++){
      matrix[0][j] = j;
    }

    // Fill in the rest of the matrix
    for(i = 1; i <= b.length; i++){
      for(j = 1; j <= a.length; j++){
        if(b.charAt(i-1) === a.charAt(j-1)){
          matrix[i][j] = matrix[i-1][j-1];
        } else {
          matrix[i][j] = Math.min(matrix[i-1][j-1] + 1, // substitution
                                  Math.min(matrix[i][j-1] + 1, // insertion
                                           matrix[i-1][j] + 1)); // deletion
        }
      }
    }

    return matrix[b.length][a.length];
  };

  pub.targetFromEvent = function(event){
    return event.target; // this used to be fancier.  unclear if this will always be necessary
  }

  pub.depthOf = function(object) {
    var level = 1;
    var key;
    for(key in object) {
        if (!object.hasOwnProperty(key)) continue;

        if(typeof object[key] == 'object'){
            var depth = pub.depthOf(object[key]) + 1;
            level = Math.max(depth, level);
        }
    }
    return level;
  }

  // note that this does not handle cyclic objects!
  pub.removeAttributeRecursive = function(obj, attribute){
    if (typeof obj !== "object" || obj === null){ 
      return; // nothing to do here
    }
    else{
      // ok, it's an object
      if (attribute in obj){
        // ok, we actually want to remove
        delete obj[attribute];
      }
      // time to descend
      for (var prop in obj){
        pub.removeAttributeRecursive(obj[prop], attribute);
      }
    }
  };

  pub.repeatUntil = function(repeatFunction, untilFunction, interval){
    if (untilFunction()){
      return;
    }
    repeatFunction();
    setTimeout(function(){pub.repeatUntil(repeatFunction, untilFunction, interval);}, interval);
  };

return pub; }());


var Highlight = (function() { var pub = {};

  var highlightCount = 0;
  var highlights = [];
  pub.highlightNode = function(target, color, display, pointerEvents) {
    if (!target){
      console.log("Woah woah woah, why were you trying to highlight a null or undefined thing?");
      return $('<div/>');
    }
    if (display === undefined){ display = true;}
    if (pointerEvents === undefined){ pointerEvents = false;}
    highlightCount +=1;
    $target = $(target);
    var offset = $target.offset();
    if (!target.getBoundingClientRect){
      // document sometimes gets hovered, and there's no getboundingclientrect for it
      return;
    }
    var boundingBox = target.getBoundingClientRect();
    var newDiv = $('<div/>');
    var idName = 'vpbd-hightlight-' + highlightCount;
    newDiv.attr('id', idName);
    newDiv.css('width', boundingBox.width);
    newDiv.css('height', boundingBox.height);
    newDiv.css('top', offset.top);
    newDiv.css('left', offset.left);
    newDiv.css('position', 'absolute');
    newDiv.css('z-index', 2147483648);
    newDiv.css('background-color', color);
    newDiv.css('opacity', .4);
    if (display === false){
      newDiv.css('display', 'none');
    }
    if (pointerEvents === false){
      newDiv.css('pointer-events', 'none');
    }
    $(document.body).append(newDiv);
    var html = $target.html();
    highlights.push(target);
    return newDiv;
  }

  pub.clearHighlight = function(highlightNode){
    highlights = _.without(highlights, highlightNode);
    highlightNode.remove();
  }

  pub.clearAllHighlights = function(){
    _.each(highlights, function(highlight){highlight.remove()});
    highlights = [];
  }

return pub; }());

var NextTypes = {
  NONE: 1,
  NEXTBUTTON: 2,
  MOREBUTTON: 3,
  SCROLLFORMORE: 4
};

var RelationItemsOutputs = {
  NOMOREITEMS: 1,
  NONEWITEMSYET: 2,
  NEWITEMS: 3
};

var TraceManipulationUtilities = (function() { var pub = {};

  pub.lastTopLevelCompletedEvent = function(trace){
    for (var i = trace.length - 1; i >= 0; i--){
      var ev = trace[i];
      if (ev.type === "completed" && ev.data.type === "main_frame"){
        return ev;
      }
    }
    return null; // bad!
  }

  pub.lastTopLevelCompletedEventTabId = function(trace){
    var ev = pub.lastTopLevelCompletedEvent(trace);
    return ev.data.tabId;
  }

  pub.tabsInTrace = function(trace){
    var tabs = [];
    for (var i = 0; i < trace.length; i++){
      var ev = trace[i];
      if (ev.type === "completed" && ev.data.type === "main_frame"){
        if (tabs.indexOf(ev.data.tabId) === -1){
          tabs.push(ev.data.tabId);
        }
      }
    }
    return tabs;
  }

return pub; }());

/* https://github.com/javascript/sorted-array/blob/master/sorted-array.js */
var SortedArray = (function () {
    var SortedArray = defclass({
        constructor: function (array, compare) {
            this.array   = [];
            this.compare = compare || compareDefault;
            var length   = array.length;
            var index    = 0;

            while (index < length) this.insert(array[index++]);
        },
        insert: function (element) {
            var array   = this.array;
            var compare = this.compare;
            var index   = array.length;

            array.push(element);

            while (index > 0) {
                var i = index, j = --index;

                if (compare(array[i], array[j]) < 0) {
                    var temp = array[i];
                    array[i] = array[j];
                    array[j] = temp;
                }
            }

            return this;
        },
        search: function (element) {
            var array   = this.array;
            var compare = this.compare;
            var high    = array.length;
            var low     = 0;

            while (high > low) {
                var index    = (high + low) / 2 >>> 0;
                var ordering = compare(array[index], element);

                     if (ordering < 0) low  = index + 1;
                else if (ordering > 0) high = index;
                else return index;
            }

            return -1;
        },
        remove: function (element) {
            var index = this.search(element);
            if (index >= 0) this.array.splice(index, 1);
            return this;
        },
        get: function(i) {
          console.log("index:", i);
          return this.array[i];
        },
        length: function() {
          return this.array.length;
        }
    });

    SortedArray.comparing = function (property, array) {
        return new SortedArray(array, function (a, b) {
            return compareDefault(property(a), property(b));
        });
    };

    return SortedArray;

    function defclass(prototype) {
        var constructor = prototype.constructor;
        constructor.prototype = prototype;
        return constructor;
    }

    function compareDefault(a, b) {
        if (a === b) return 0;
        return a < b ? -1 : 1;
    }
}());