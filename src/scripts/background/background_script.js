'use strict'

var currently_on = false;

(function() {
  var panelWindow = undefined;

  function openMainPanel(hide) {
    // check if panel is already open
    if (typeof panelWindow == 'undefined' || panelWindow.closed) {

      chrome.tabs.query({active: true, currentWindow: true})
      .then(function(tab) {
        // identify the url on which the user is currently focused, start a new recording with the same url loaded
        // now that we know the url...
        var recordingUrl = tab.url;

        // now let's make the mainpanel
        chrome.windows.create({
          url: chrome.extension.getURL('pages/mainpanel.html?starturl='+encodeURIComponent(recordingUrl)), 
              width: 600, height: 800, left: 0, top: 0, 
              focused: true,
              type: 'panel'
              }
        );
      })
      .then(function(winInfo) {panelWindow = winInfo})

    } else {
      chrome.windows.update(panelWindow.id, {focused: true});
    }
  }

  chrome.action.onClicked.addListener(function(tab) {
    openMainPanel();
  });

  chrome.windows.onRemoved.addListener(function(winId) {
    if (typeof panelWindow == 'object' && panelWindow.id == winId) {
      panelWindow = undefined;
    }
  });
  
  utilities.listenForMessage("content", "background", "requestTabID",function(msg){
    chrome.tabs.get(msg.tab_id)
    .then(function(tab) {
      utilities.sendMessage("background","content","tabID", {tab_id: tab.id, window_id: tab.windowId, top_frame_url: tab.url}, null, null, [tab.id]);
    });
  });
  
  // one of our background services is also running http requests for content scripts because modern chrome doesn't allow https pages to do it directly
  utilities.listenForMessage("content", "background", "postForMe",function(msg){
    $.post(msg.url, msg.params)
    .then(function(resp) { 
      WALconsole.log("resp:", resp);
      utilities.sendMessage("background", "content", "postForMe", resp, null, null, [msg.tab_id]);
    });
  });

  function makeKey(run){
    return run.schedule + "_" + run.progId;
  }

  // first set the timezone
  later.date.localTime();
  var alreadyScheduled = {};
  function scheduleScrapes(){
    chrome.storage.sync.get("scheduledRuns")
    .then(function(obj) {
      let runs = obj.scheduledRuns;
      if (!runs) { return; }

      console.log("scheduling scrapes", obj);
      var currentRunKeys = _.map(runs, function(run){return makeKey(run);});

      // first let's go through and make sure we don't have any things scheduled that have been canceled, so that we need to clear them
      for (var key in alreadyScheduled){
        if (currentRunKeys.indexOf(key) < 0){
          // ok, this is one we want to cancel
          var laterId = alreadyScheduled[key];
          laterId.clear();
          console.log("unscheduled a run", key);
        }
      }

      // now let's go through and start any schedules that haven't yet been scheduled
      for (var i = 0; i < runs.length; i++){
        var run = runs[i];
        var schedule = run.schedule;
        var progId = run.progId;
        var key = makeKey(run);
        if (!(key in alreadyScheduled)){
          console.log("scheduled a run", key);
          var sched = later.parse.text(schedule);
          var laterId = later.setInterval(function() { runScheduledScript(progId); }, sched);
          alreadyScheduled[key] = laterId;
        }
      }
    });
  }
  scheduleScrapes();
  utilities.listenForMessage("mainpanel", "background", "scheduleScrapes", scheduleScrapes);

  function runScheduledScript(id){
    // we'll have to actually open the control panel if we don't have it open already
    openMainPanel(); // don't worry.  this will only open it if it's currently closed
    
    // and for cases where it's actually already running a script, we want to tell it to wrap up whatever it's doing (send the data to server)
    // and then refresh the page so we're not bloating it all up with a bunch of memory given over to the prior task
    // the protocol here is:
    // B -> M pleasePrepareForRefresh
    // M -> B readyToRefresh
    // B -> M runScheduledScript
    // M -> B runningScheduledScript
    var readyForRefresh = false;
    utilities.listenForMessageOnce("mainpanel", "background", "readyToRefresh", function(){
      readyForRefresh = true;
      // ok, the mainpanel is ready to be refreshed
      chrome.windows.get(panelWindow.id, {populate: true})
      .then(function(winData) {
        var tab = winData.tabs[0]; // there should be exactly one tab
        chrome.tabs.update(tab.id, {url:'pages/mainpanel.html'})
      })
      .then(function() {
        // ok, now that we've reloaded the mainpanel, let's go for it
        // but let's wait one sec, because it turns out even when this continuation runs, sometimes the old page is still
        // loaded in and trying to respond, and sometimes it gets the response out even though it's about to be reloaded
        // and of course can't do the real response
        // todo: a more robust way for this please
        setTimeout(function(){
          console.log("running scheduled script", id);
          var runRequestReceived = false;
          utilities.listenForMessageOnce("mainpanel", "background", "runningScheduledScript", function(){ runRequestReceived = true; });
          var sendRunRequest = function(){utilities.sendMessage("background", "mainpanel", "runScheduledScript", {progId: id});};
          MiscUtilities.repeatUntil(sendRunRequest, function(){return runRequestReceived;}, function(){WALconsole.log("mainpanel received run request");}, 500, true);
        }, 1000);
      });
    });
    var sendRefreshRequest = function(){utilities.sendMessage("background", "mainpanel", "pleasePrepareForRefresh", {});};
    MiscUtilities.repeatUntil(sendRefreshRequest, function(){return readyForRefresh;}, function(){}, 500, true);
  }
  
})();




