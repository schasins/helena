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
    WALconsole.log("currently on: "+currently_on);
    utilities.sendMessage("background", "content","currentlyOn", currently_on);
  });

  chrome.windows.onRemoved.addListener(function(winId) {
    if (typeof panelWindow == 'object' && panelWindow.id == winId) {
      panelWindow = undefined;
    }
  });
  
  utilities.listenForMessage("content", "background", "requestCurrentlyOn",function(){utilities.sendMessage("background","content","currentlyOn", currently_on);});
  utilities.listenForMessage("content", "background", "requestTabID",function(msg){
    chrome.tabs.get(msg.tab_id, function (tab) {
      utilities.sendMessage("background","content","tabID", {tab_id: tab.id, window_id: tab.windowId, top_frame_url: tab.url}, null, null, [tab.id]);
    });
  });

  // one of our background services is also running http requests for content scripts because modern chrome doesn't allow https pages to do it directly
  utilities.listenForMessage("content", "background", "postForMe",function(msg){
    $.post(msg.url, msg.params, function(resp){ 
      WALconsole.log("resp:", resp);
      utilities.sendMessage("background", "content", "postForMe", resp, null, null, [msg.tab_id]);
    });
  });

  var alreadyScheduled = {};
  function scheduleScrapes(){
    chrome.storage.sync.get("scheduledRuns", function(obj) {
      console.log("scheduling scrapes", obj);
      var runs = obj.scheduledRuns;
      for (var i = 0; i < runs.length; i++){
        var run = runs[i];
        var schedule = run.schedule;
        var progId = run.progId;
        var key = schedule + "_" + progId;
        if (!(key in alreadyScheduled)){
          var sched = later.parse.text(schedule);
          later.setInterval(function() { runScheduledScript(progId); }, sched);
          alreadyScheduled[key] = true;
        }
      }
    });
  }
  scheduleScrapes();
  utilities.listenForMessage("mainpanel", "background", "scheduleScrapes", scheduleScrapes);

  function runScheduledScript(id){
    console.log("running scheduled script", id);
    utilities.sendMessage("background", "mainpanel", "runScheduledScript", {progId: id});
  }
  
})();




