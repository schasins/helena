//open mainpanel

var currently_on = false;

(function() {
  var panelWindow = undefined;

  function openMainPanel(hide) {
    // check if panel is already open
    if (typeof panelWindow == 'undefined' || panelWindow.closed) {

      chrome.windows.create({
		  url: chrome.extension.getURL('pages/mainpanel.html'), 
          width: 500, height: 800, left: 0, top: 0, 
          focused: true,
          type: 'panel'
          }, 
          function(winInfo) {panelWindow = winInfo;}
      );
    } else {
      chrome.windows.update(panelWindow.id, {focused: true});
    }
  }

  chrome.browserAction.onClicked.addListener(function(tab) {
    if (!currently_on){
      openMainPanel();
    }
    currently_on = !currently_on;
    console.log("currently on: "+currently_on);
    utilities.sendMessage("background", "content","currentlyOn", currently_on);
  });

  chrome.windows.onRemoved.addListener(function(winId) {
    if (typeof panelWindow == 'object' && panelWindow.id == winId) {
      panelWindow = undefined;
    }
  });
  
  utilities.listenForMessage("content", "background", "requestCurrentlyOn",function(){utilities.sendMessage("background","content","currentlyOn", currently_on);});
  utilities.listenForMessage("content", "background", "requestTabID",function(msg){utilities.sendMessage("background","content","tabID", msg.tab_id,null,null,[msg.tab_id]);});
  
})();

