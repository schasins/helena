var utilities = (function() { var pub = {};

  var listenerCounter = 0;
  var runtimeListeners = {};
  var extensionListeners = {};

  chrome.runtime.onMessage.addListener(function(msg, sender) {
    for (var key in runtimeListeners){
      runtimeListeners[key](msg, sender);
    }
  });

  chrome.extension.onMessage.addListener(function(msg, sender) {
    for (var key in extensionListeners){
      extensionListeners[key](msg, sender);
    }
  });

  pub.listenForMessage = function(from, to, subject, fn, key){
    if (key === undefined){ key = listenerCounter; }
    console.log("Listening for messages: "+ from+" : "+to+" : "+subject);
    listenerCounter += 1;
    if (to === "background" || to === "mainpanel"){
      runtimeListeners[key] = function(msg, sender) {
        if (msg.from && (msg.from === from) && msg.subject && (msg.subject === subject)) {
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
      extensionListeners[key] = function(msg, sender) {
        var frame_id = SimpleRecord.getFrameId();
        if (msg.frame_ids_include && msg.frame_ids_include.indexOf(frame_id) < -1){
          console.log("Msg for frames with ids "+msg.frame_ids_include+", but this frame has id "+frame_id+".");
          return false;
        }
        if (msg.frame_ids_exclude && msg.frame_ids_exclude.indexOf(frame_id) > -1){
          console.log("Msg for frames without ids "+msg.frame_ids_exclude+", but this frame has id "+frame_id+".");
          return false;
        }
        if (msg.from && (msg.from === from) && msg.subject && (msg.subject === subject)) {
          console.log("Receiving message: ", msg);
          fn(msg.content);
          return true;
        }
        return false;
      };
    }
  };

  var oneOffListenerCounter = 0;

  pub.listenForMessageOnce = function(from, to, subject, fn){
    console.log("Listening once for message: "+ from+" : "+to+" : "+subject);
    var key = oneOffListenerCounter;
    var newfunc = null;
    oneOffListenerCounter += 1;
    if (to === "background" || to === "mainpanel"){
      newfunc = function(msg){fn(msg); delete runtimeListeners[key];};
    }
    else if (to === "content"){
      newfunc = function(msg){fn(msg); delete extensionListeners[key];};
    }
    pub.listenForMessage(from, to, subject, newfunc, key);
  }

  pub.listenForMessageWithKey = function(from, to, subject, key, fn){
    console.log("Listening for message with key: "+ from+" : "+to+" : "+subject);
    pub.listenForMessage(from, to, subject, fn, key);
  }

  pub.sendMessage = function(from, to, subject, content, frame_ids_include, frame_ids_exclude, tab_ids_include, tab_ids_exclude){
    if ((from ==="background" || from ==="mainpanel") && to === "content"){
      var msg = {from: from, subject: subject, content: content, frame_ids_include: frame_ids_include, frame_ids_exclude: frame_ids_exclude};
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
      console.log("Sending message: ", msg);
      chrome.runtime.sendMessage(msg);
    }
  };

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

var ServerTranslationUtilities = (function() { var pub = {};

  pub.JSONifyRelation = function(relation){
    relation.selector = JSON.stringify(relation.selector);
    for (var k = 0; k < relation.columns.length; k++){
      relation.columns[k].suffix = JSON.stringify(relation.columns[k].suffix); // is this the best place to deal with going between our object attributes and the server strings?
    }
  };

  pub.unJSONifyRelation = function(relation){
    relation.selector = JSON.parse(relation.selector);
    for (var k = 0; k < relation.columns.length; k++){
      relation.columns[k].suffix = JSON.parse(relation.columns[k].suffix); // is this the best place to deal with going between our object attributes and the server strings?
    }
  };


return pub; }());