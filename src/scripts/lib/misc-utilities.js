
var WALconsole = (function _WALconsole() { var pub = {};

  pub.debugging = false;
  pub.showWarnings = true;
  pub.namedDebugging = ["duplicates"]; //["rbb"];//["getRelationItems", "nextInteraction"];
  pub.styleMinimal = true;

  function callerName(origArgs){
    console.log("origArgs", origArgs);
    try {
      return origArgs.callee.caller.name;
    }
    catch(e){
      return "unknown caller";
    }
  }

  function loggingGuts(args, origArgs){
    var prefix = [];
    if (!pub.styleMinimal){
      var caller = callerName(origArgs);
      prefix = ["["+caller+"]"];
    }
    var newArgs = prefix.concat(Array.prototype.slice.call(args));
    Function.apply.call(console.log, console, newArgs);
  };

  pub.log = function _log(){
    if (pub.debugging){
      loggingGuts(arguments, arguments);
    }
  };

  pub.namedLog = function _log(){
    var name = arguments[0];
    if (pub.debugging || pub.namedDebugging.indexOf(name) > -1) {
      var args = Array.prototype.slice.call(arguments);
      loggingGuts(args.slice(1, arguments.length), arguments);
    }
  };

  pub.warn = function _warn(){
    if (pub.showWarnings){
      var args = Array.prototype.slice.call(arguments);
      var newArgs = ["Warning: "].concat(args);
      loggingGuts(newArgs, arguments);
    }
  };

return pub; }());

var utilities = (function _utilities() { var pub = {};

  var sendTypes = {
    NORMAL: 0,
    FRAMESPECIFIC: 1
  };

  var listenerCounter = 1;
  var runtimeListeners = {};
  var extensionListeners = {};

  chrome.runtime.onMessage.addListener(function _listenerRuntime(msg, sender) {
    for (var key in runtimeListeners){
      runtimeListeners[key](msg, sender);
    }
  });

  chrome.extension.onMessage.addListener(function _listenerExtension(msg, sender) {
    // WALconsole.log("keys", Object.keys(extensionListeners));
    for (var key in extensionListeners){
      // WALconsole.log("key", key);
      extensionListeners[key](msg, sender);
    }
  });

  pub.listenForMessage = function _listenForMessage(from, to, subject, fn, key){
    if (key === undefined){ key = listenerCounter; }
    WALconsole.log("Listening for messages: "+ from+" : "+to+" : "+subject);
    listenerCounter += 1;
    if (to === "background" || to === "mainpanel"){
      runtimeListeners[key] = function _oneListenerRuntime(msg, sender) {
        if (msg.from && (msg.from === from) && msg.subject && (msg.subject === subject) && (msg.send_type === sendTypes.NORMAL)) {
          if (sender.tab && sender.tab.id){
            // add a tab id iff it's from content, and thus has sender.tab and sender.tab.id
            msg.content.tab_id = sender.tab.id;
          }
          WALconsole.log("Receiving message: ", msg);
          WALconsole.log("from tab id: ", msg.content.tab_id);
          fn(msg.content);
          return true;
        }
        if (true){WALconsole.log("No subject match: ", msg.subject, subject)};
        return false;
      };
    }
    else if (to === "content"){
      // WALconsole.log("content listener", key, subject);
      extensionListeners[key] = function _oneListenerExtension(msg, sender) {
        // WALconsole.log(msg, sender);
        var frame_id = SimpleRecord.getFrameId();
        if (msg.frame_ids_include && msg.frame_ids_include.indexOf(frame_id) < -1){
          WALconsole.log("Msg for frames with ids "+msg.frame_ids_include+", but this frame has id "+frame_id+".");
          return false;
        }
        else if (msg.frame_ids_exclude && msg.frame_ids_exclude.indexOf(frame_id) > -1){
          WALconsole.log("Msg for frames without ids "+msg.frame_ids_exclude+", but this frame has id "+frame_id+".");
          return false;
        }
        else if (msg.from && (msg.from === from) && msg.subject && (msg.subject === subject) && (msg.send_type === sendTypes.NORMAL)) {
          WALconsole.log("Receiving message: ", msg);
          fn(msg.content);
          return true;
        }
        else{
          // WALconsole.log("Received message, but not a match for current listener.");
          // WALconsole.log(msg.from, from, (msg.from === from), msg.subject, subject, (msg.subject === subject), (msg.send_type === sendTypes.NORMAL));
          return false;
        }
      };
    }
    else{
      WALconsole.warn("Bad to field in msg:", msg);
    }
  };

  // note that this frameSpecificMessage assume we'll have a response handler, so fn should provide a return value, rather than sending its own messages
  pub.listenForFrameSpecificMessage = function _listenForFrameSpecificMessage(from, to, subject, fn){
    WALconsole.log("Listening for frame-specific messages: "+ from+" : "+to+" : "+subject);
    chrome.runtime.onMessage.addListener(function _frameSpecificListener(msg, sender, sendResponse) {
      if (msg.subject === subject && msg.send_type === sendTypes.FRAMESPECIFIC){
        WALconsole.log("Receiving frame-specific message: ", msg);
        fn(msg.content, sendResponse);
        return true; // must return true so that the sendResponse channel remains open (indicates we'll use sendResponse asynchronously.  may not always, but have the option)
      }
    });
  }

  var oneOffListenerCounter = 1;

  pub.listenForMessageOnce = function _listenForMessageOnce(from, to, subject, fn){
    WALconsole.log("Listening once for message: "+ from+" : "+to+" : "+subject);
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

  pub.listenForMessageWithKey = function _listenForMessageWithKey(from, to, subject, key, fn){
    WALconsole.log("Listening for message with key: "+ from+" : "+to+" : "+subject);
    pub.listenForMessage(from, to, subject, fn, key);
  }

  pub.stopListeningForMessageWithKey = function _stopListeningForMessageWithKey(from, to, subect, key){
    // WALconsole.log("deleting key", key);
    if (to === "background" || to === "mainpanel"){
      delete runtimeListeners[key];
    }
    else if (to === "content"){
      delete extensionListeners[key];
    }
  }

  pub.sendMessage = function _sendMessage(from, to, subject, content, frame_ids_include, frame_ids_exclude, tab_ids_include, tab_ids_exclude){ // note: frame_ids are our own internal frame ids, not chrome frame ids
    if ((from ==="background" || from ==="mainpanel") && to === "content"){
      var msg = {from: from, subject: subject, content: content, frame_ids_include: frame_ids_include, frame_ids_exclude: frame_ids_exclude};
      msg.send_type = sendTypes.NORMAL;
      WALconsole.log("Sending message: ", msg);
      WALconsole.log(tab_ids_include, tab_ids_exclude);
      if (tab_ids_include){
        for (var i =0; i<tab_ids_include.length; i++){
          chrome.tabs.sendMessage(tab_ids_include[i], msg); 
        } 
        WALconsole.log("(Sent to ", tab_ids_include.length, " tabs: ", tab_ids_include, " )");
      }
      else{
          chrome.tabs.query({windowType: "normal"}, function _sendMessageTabs(tabs){
            tabs_messaged = 0;
            for (var i =0; i<tabs.length; i++){
              if (!(tab_ids_exclude && tab_ids_exclude.indexOf(tabs[i].id) > -1)){
                chrome.tabs.sendMessage(tabs[i].id, msg); 
                tabs_messaged ++;
              }
            }
            WALconsole.log("(Sent to "+tabs_messaged+" tabs.)");
        });
      }
    }
    else if (to ==="background" || to ==="mainpanel"){
      var msg = {from: from, subject: subject, content: content};
      msg.send_type = sendTypes.NORMAL;
      WALconsole.log("Sending message: ", msg);
      chrome.runtime.sendMessage(msg);
    }
    else{
      WALconsole.warn("Bad from field in msg:", msg);
    }
  };

  pub.sendFrameSpecificMessage = function _sendFrameSpecificMessage(from, to, subject, content, chromeTabId, chromeFrameId, responseHandler){ // note: not the same as our interna frame ids
    var msg = {from: from, subject: subject, content: content};
    msg.send_type = sendTypes.FRAMESPECIFIC;
    WALconsole.log("Sending frame-specific message: ", msg);
    chrome.tabs.sendMessage(chromeTabId, msg, {frameId: chromeFrameId}, responseHandler);
  }

return pub; }());

var DOMCreationUtilities = (function _DOMCreationUtilities() { var pub = {};

  pub.replaceContent = function _replaceContent(div1, div2){
    var div2clone = div2.clone();
    div1.html(div2clone.html());
  };

  pub.arrayOfTextsToTableRow = function _arrayOfTextsToTableRow(array){
      var $tr = $("<tr></tr>");
      for (var j= 0; j< array.length; j++){
        var $td = $("<td></td>");
        $td.html(_.escape(array[j]).replace(/\n/g,"<br>"));
        $tr.append($td);
      }
      return $tr;
    };

  pub.arrayOfArraysToTable = function _arrayOfArraysToTable(arrayOfArrays){
      var $table = $("<table></table>");
      for (var i = 0; i< arrayOfArrays.length; i++){
        var array = arrayOfArrays[i];
        $tr = DOMCreationUtilities.arrayOfTextsToTableRow(array);
        $table.append($tr);
      }
      return $table;
    };

  pub.toggleDisplay = function _toggleDisplay(node){
    console.log(node);
    if (node.css("display") === "none"){
      node.css("display", "inline");
    }
    else{
      node.css("display", "none");
    }
  };

return pub; }());

/*
A very important set of utilities for reviving objects that have been stringified
(as for sending to the server) but have returned to us, and need to be used as
proper objects again.
We always store all the fields; it's the methods we lose.  So we basically, when it 
comes time to revive it, want to union the attributes of the now unstringified dict
and the prototype, grabbing the methods back from the prototype.
*/
var Revival = (function _Revival(){ var pub = {};

  var revivalLabels = {};

  pub.introduceRevivalLabel = function _introduceRevivalLabel(label, prototype){
    revivalLabels[label] = prototype;
  };

  pub.addRevivalLabel = function _addRevivalLabel(object){
    for (var prop in revivalLabels){
      if (object instanceof revivalLabels[prop]){
        object.___revivalLabel___ = prop;
        return;
      }
    }
    WALconsole.log("No known revival label for the type of object:", object);
  };

  pub.revive = function _revive(objectAttributes){

    var seen = []; // we're going to be handling circular objects, so have to keep track of what we've already handled
    var fullSeen = [];

    var reviveHelper = function _reviveHelper(objectAttributes){
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
          var fullVal = reviveHelper(val, false);
          fullObj[prop] = fullVal; // must replace the old fields-only val with the proper object val
        }
      }
      return fullObj;
    };
    var obj = reviveHelper(objectAttributes);
    return obj;
  };

return pub; }());

var Clone = (function _Clone() { var pub = {};

  pub.cloneProgram = function _cloneProgram(origProgram){
    function replacer(key, value) {
      // filtering out the blockly block, which we can recreate from the rest of the state
      if (key === "block") {
        return undefined;
      }
      return value;
    }
    var programAttributes = JSOG.parse(JSOG.stringify(origProgram, replacer)); // deepcopy
    var program = Revival.revive(programAttributes);  // copy all those fields back into a proper Program object
    return program;
  };

return pub; }());

var ServerTranslationUtilities = (function _ServerTranslationUtilities() { var pub = {};

  // for when we want to send a relation object to the server
  pub.JSONifyRelation = function _JSONifyRelation(origRelation){
    if (origRelation instanceof WebAutomationLanguage.Relation){
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
      WALconsole.log("relation after jsonification", relation);
      return relation;
    }
    else if (origRelation instanceof WebAutomationLanguage.TextRelation){
      var stringifiedTextRelation = JSON.stringify(origRelation.relation);
      return stringifiedTextRelation;
    }
  };

  // for when we get a relation back from the server
  pub.unJSONifyRelation = function _unJSONifyRelation(relationDict){
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

  pub.JSONifyProgram = function _JSONifyProgram(origProgram){
    // let's start by deep copying so that we can delete stuff and mess around without messing up the real object
    var program = Clone.cloneProgram(origProgram);
    // relations aren't part of a JSONified program, because this is just the string part that will be going into a single db column
    // we want interesting info like what relations it uses to be stored in a structured way so we can reason about it, do interesting stuff with it
    // so blank out relations

    // for now, even though we are separately saving proper representations of the relations involved
    // let's also save these relation associated with the current prog, so user doesn't get any surprises
    // can later allow them to update from server if it's failing...
    /*
    program.traverse(function(statement){
      if (statement instanceof WebAutomationLanguage.LoopStatement){
        WALconsole.log(program.relations.indexOf(statement.relation));
        statement.relation = program.relations.indexOf(statement.relation); // note this means we must have the relations in same order from server that we have them here
      }
    });
    delete program.relations;
    */
    return JSOG.stringify(program);
  };

  pub.unJSONifyProgram = function _unJSONifyProgram(stringifiedProg){
    var programAttributes = JSOG.parse(stringifiedProg);
    var program = Revival.revive(programAttributes); // copy all those fields back into a proper Program object
    return program;
  };

return pub; }());

var MiscUtilities = (function _MiscUtilities() { var pub = {};

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
  pub.useCorrectScrapingConditionStrings = function _useCorrectScrapingConditionStrings(selectorstring, normalScrapeStringToReplace, linkScrapeStringToReplace){
    $(selectorstring).html($(selectorstring).html().replace(new RegExp(normalScrapeStringToReplace,"g"), pub.scrapeConditionString));
    $(selectorstring).html($(selectorstring).html().replace(new RegExp(linkScrapeStringToReplace,"g"), pub.scrapeConditionLinkString));
  }

  pub.postAndRePostOnFailure = function _postAndRePostOnFailure(url, msg, successHandler){
    var currentWait = 5000;
    var sendHelper = function _sendHelper(message){
      $.post(url, 
        message, 
        successHandler).fail(function(){
          setTimeout(function(){sendHelper(message);}, currentWait); // if we failed, need to be sure to send again...
          currentWait = currentWait * 2; // doing a little bit of backoff, but should probably do this in a cleaner way
        });
    };
    sendHelper(msg);
  };

  pub.makeNewRecordReplayWindow = function _makeNewRecordReplayWindow(cont){
    chrome.windows.getCurrent(function (currWindowInfo){
      var right = currWindowInfo.left + currWindowInfo.width;
      chrome.system.display.getInfo(function(displayInfoLs){
        for (var i = 0; i < displayInfoLs.length; i++){
          var bounds = displayInfoLs[i].bounds;
          bounds.right = bounds.left + bounds.width;
          WALconsole.log(bounds);
          if (bounds.left <= right && bounds.right >= right){
            // we've found the right display
            var top = currWindowInfo.top - 40; // - 40 because it doesn't seem to count the menu bar and I'm not looking for a more accurate solution at the moment
            var left = right; // let's have it adjacent to the control panel
	      console.log(bounds.right - right, bounds.top + bounds.height - top);
	      var width = bounds.right - right;
	      var height = bounds.top + bounds.height - top;
	      // for now let's actually make width and height fixed for stability across different ways of running (diff machines, diff panel sizes at start)
	      // 1419 1185
	     //var width = 1419;
	     //var height = 1185;
            chrome.windows.create({url: "pages/newRecordingWindow.html", focused: true, left: left, top: top, width: width, height: height}, function(win){
              WALconsole.log("new record/replay window created.");
              //pub.sendCurrentRecordingWindow(); // todo: should probably still send this for some cases
              cont(win.id);
            });
          }
        }
      });
    });
  };

  pub.currentDateString = function _currentDateString(){
    return pub.basicDateString(new Date());
  };

  pub.basicDateString = function _basicDateString(d){
    return d.getFullYear() + "-" + (d.getMonth()+1) + "-" + d.getDate() + "-" + d.getHours() + ":" + d.getMinutes();
  };

  pub.toBlocklyBoolString = function _toBlocklyBoolString(bool){
    if (bool){
      return 'TRUE';
    }
    return 'FALSE';
  };

  pub.levenshteinDistance = function _levenshteinDistance(a, b) {
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

  pub.targetFromEvent = function _targetFromEvent(event){
    return event.target; // this used to be fancier.  unclear if this will always be necessary
  }

  pub.depthOf = function _depthOf(object) {
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
  pub.removeAttributeRecursive = function _removeAttributeRecursive(obj, attribute){
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

  pub.repeatUntil = function _repeatUntil(repeatFunction, untilFunction, afterFunction, interval, grow){
    if (grow === undefined){ grow = false;}
    if (untilFunction()){
      afterFunction();
      return;
    }
    repeatFunction();
    var nextInterval = interval;
    if (grow){
      nextInterval = nextInterval * 2; // is this really how we want to grow it?  should it be a strategy passed in?
    }
    WALconsole.log("grow", grow);
    WALconsole.log("interval", nextInterval);
    setTimeout(function(){pub.repeatUntil(repeatFunction, untilFunction, afterFunction, nextInterval, grow);}, interval);
  };

  /* there are some messages that we send repeatedly from the mainpanel because we don't know whether the 
  content script has actually received them.  but for most of these, we don't actually want a dozen answers, 
  we just want to get one answer with the current, most up-to-date answer, and if we later decide we want 
  another, we'll send another later.  for these cases, rather than build up an enormous backlog of messages 
  (and it can get enormous and even crash everything), better to just register that we want the current 
  response, then let us send the one */
  // note that if we have *anything* changing about the message, this is currently a bad way to handle
  // so if we have something like a counter in the message telling how many times it's been sent, this approach won't help

  var currentResponseRequested = {};
  var currentResponseHandler = {};

  function handleRegisterCurrentResponseRequested(message){
    var key = StableStringify.stringify(message);
    if (currentResponseRequested[key]){
      currentResponseRequested[key] = false;
      // now call the actual function
      currentResponseHandler[key](message);
    }
    // else nothing to do.  yay!
  };

  pub.registerCurrentResponseRequested = function _registerCurrentResponseRequested(message, functionToHandleMessage){
    var key = StableStringify.stringify(message);
    currentResponseRequested[key] = true;
    currentResponseHandler[key] = functionToHandleMessage;
    setTimeout(
      function(){handleRegisterCurrentResponseRequested(message);},
      0);
    // so it does get called immediately if there's no backup, but just goes in its place at the back of the queue 
    // if there is a backup right now, and then we can get a bunch of them backed up but we'll still 
    // only run it the first time.  must have a separate dictionary for the function, because you 
    // want to attach the current handler, not run an old handler.  For instance, we might send the same message to 
    // request a new fresh set of relation items, but have a different mainpanel response handler, and we want to 
    // send it to the current handler, not the old one.
  };

  // for now, if there's no favicon url and if the title of the page is actually just a segment of the url, go ahead and assume it didn't manage to load
  pub.looksLikeLoadingFailure = function _looksLikeLoadingFailure(tabInfo){
    if (!tabInfo.favIconUrl && tabInfo.url.indexOf(tabInfo.title) > -1){
      return true;
    }
    return false;
  };

  pub.truncateDictionaryStrings = function _truncateDictionaryStrings(dict, stringLengthLimit, keysToSkip){
    for (var key in dict){
      var val = dict[key];
      if (keysToSkip.indexOf(key) < 0 && typeof val === 'string' && val.length > stringLengthLimit){
        dict[key] = val.slice(0, stringLengthLimit);
      }
    }
  };

  pub.dirtyDeepcopy = function _dirtyDeepcopy(obj){
    return JSON.parse(JSON.stringify(obj));
  };

return pub; }());


var Highlight = (function _Highlight() { var pub = {};

  var highlightCount = 0;
  var highlights = [];
  pub.highlightNode = function _highlightNode(target, color, display, pointerEvents) {
    if (!target){
      WALconsole.log("Woah woah woah, why were you trying to highlight a null or undefined thing?");
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
    highlights.push(newDiv);
    newDiv.highlightedNode = target;
    return newDiv;
  };

  pub.isHighlight = function _isHighlight(node){
    var id = $(node).attr("id");
    return (id !== null && id !== undefined && id.indexOf("vpbd-hightlight") > -1);
  };

  pub.getHighligthedNodeFromHighlightNode = function _getHighligthedNodeFromHighlightNode(highlightNode){
    return highlightNode.highlightedNode;
  }

  pub.clearHighlight = function _clearHighlight(highlightNode){
    if (!highlightNode){
      return;
    }
    highlights = _.without(highlights, highlightNode);
    highlightNode.remove();
  }

  pub.clearAllHighlights = function _clearAllHighlights(){
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

var TraceManipulationUtilities = (function _TraceManipulationUtilities() { var pub = {};

  pub.lastTopLevelCompletedEvent = function _lastTopLevelCompletedEvent(trace){
    for (var i = trace.length - 1; i >= 0; i--){
      var ev = trace[i];
      if (ev.type === "completed" && ev.data.type === "main_frame"){
        return ev;
      }
    }
    return null; // bad!
  }

  pub.tabId = function _tabId(ev){
    return ev.data.tabId;
  };
  pub.frameId = function _frameId(ev){
    return ev.data.frameId;
  };

  pub.lastTopLevelCompletedEventTabId = function _lastTopLevelCompletedEventTabId(trace){
    var ev = pub.lastTopLevelCompletedEvent(trace);
    return ev.data.tabId;
  }

  pub.tabsInTrace = function _tabsInTrace(trace){
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
          WALconsole.log("index:", i);
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


var XMLBuilder = (function _XMLBuilder() { var pub = {};

  pub.newNode = function _newNode(name, options, content){
    if (content === null || content === undefined){
      console.log("no content, returning");
      return ""; // assuming we don't actually want this?
    }
    var optionsStrs = [];
    if ("type" in options){
      // we have to do type first, if it's in here
      optionsStrs.push("type=\""+options["type"]+"\"");
    }
    for (var prop in options){
      if (prop === "type"){
        continue;
      }
      optionsStrs.push(prop + "=\"" + options[prop] + "\"");
    }
    var optionsStr = optionsStrs.join(" ");
    return "<" + name + " " + optionsStr + ">" + content + "</" + name + ">";
  }

return pub; }());



