import * as later from "later";

import { Messages } from "../common/messages";
import { HelenaConsole } from "../common/utils/helena_console";
import { ScheduledRun } from "../common/scheduled_run";
import { MiscUtilities } from "../common/misc_utilities";
import { HelenaServer, KnownRelationRequest,
  KnownRelationResponse } from "../mainpanel/utils/server";

export class HelenaBackground {
  private alreadyScheduled: {
    [key: string]: later.Timer;
  } = {};
  private panelWindow?: chrome.windows.Window;

  constructor() {
    this.initMainpanelListeners();

    Messages.listenForMessage("content", "background", "requestTabID",
        (msg: Messages.MessageContentWithTab) => {
      chrome.tabs.get(msg.tab_id, (tab) => {
        const tabIdsInclude = [];
        if (tab.id) {
          tabIdsInclude.push(tab.id);
        }
        Messages.sendMessage("background", "content", "tabID",
          {
            tab_id: tab.id,
            window_id: tab.windowId,
            top_frame_url: tab.url
          }, undefined, undefined, tabIdsInclude);
      });
    });

    // one of our background services is also running http requests for content
    //   scripts because modern chrome doesn't allow https pages to do it directly
    Messages.listenForMessage("content", "background", "getKnownRelations",
        (msg: KnownRelationRequest & Messages.MessageContentWithTab) => {
      HelenaServer.getKnownRelations(msg, (resp: KnownRelationResponse) => { 
        HelenaConsole.log("resp:", resp);
        Messages.sendMessage("background", "content", "getKnownRelations", resp,
          undefined, undefined, [ msg.tab_id ]);
      });
    });

    // first, set the time zone
    later.date.localTime();
  
    this.scheduleScrapes();
    Messages.listenForMessage("mainpanel", "background", "scheduleScrapes",
      this.scheduleScrapes.bind(this));
  }

  private initMainpanelListeners() {
    const self = this;
    chrome.browserAction.onClicked.addListener(() => {
      self.openMainPanel();
    });

    chrome.windows.onRemoved.addListener((winId) => {
      if (typeof this.panelWindow == 'object' && this.panelWindow.id == winId) {
        this.panelWindow = undefined;
      }
    });
  }

  public openMainPanel() {
    // check if panel is already open
    if (this.panelWindow === undefined) {
      chrome.tabs.query({
        active: true,
        currentWindow: true
      }, (tabs) => {
        if (tabs.length > 1) {
          throw new ReferenceError("How is there more than one active tab?");
        }
  
        // identify the url on which the user is currently focused, start a new
        //   recording with the same url loaded
        // now that we know the url...
        let recordingUrl = <string> tabs[0].url;
  
        // now let's make the mainpanel
        chrome.windows.create({
          url: chrome.extension.getURL('pages/mainpanel.html?starturl=' +
              encodeURIComponent(recordingUrl)), 
            width: 600, height: 800, left: 0, top: 0, 
            focused: true,
            type: 'panel'
          }, 
          (winInfo) => {
            this.panelWindow = winInfo;
          }
        );
      });
    } else {
      chrome.windows.update(this.panelWindow.id, {focused: true});
    }
  }

  private scheduleScrapes(){
    const self = this;
    chrome.storage.sync.get("scheduledRuns", (obj) => {
      let runs: ScheduledRun[] = obj.scheduledRuns;
      if (!runs) { return; }

      console.log("scheduling scrapes", obj);
      const currentRunKeys = runs.map((run) => scheduledRunKey(run));

      // first let's go through and make sure we don't have any things scheduled
      //   that have been canceled, so that we need to clear them
      for (const key in self.alreadyScheduled){
        if (!currentRunKeys.includes(key)){
          // ok, this is one we want to cancel
          const laterId = self.alreadyScheduled[key];
          laterId.clear();
          console.log("unscheduled a run", key);
        }
      }

      // now let's go through and start any schedules that haven't yet been
      //   scheduled
      for (const run of runs) {
        const schedule = run.schedule;
        const progId = run.progId;
        const key = scheduledRunKey(run);
        if (!(key in self.alreadyScheduled)){
          console.log("scheduled a run", key);
          const sched = later.parse.text(schedule);
          const laterId = later.setInterval(() => {
            self.runScheduledScript(progId);
          }, sched);
          self.alreadyScheduled[key] = laterId;
        }
      }
    });
  }

  private runScheduledScript(id: string) {
    const self = this;
    // we'll have to actually open the control panel if we don't have it open
    //   already
    this.openMainPanel(); // this will only open it if it's currently closed
    const panelWindowId = <number> this.panelWindow?.id;
    
    // and for cases where it's actually already running a script, we want to
    //   tell it to wrap up whatever it's doing (send the data to server) and
    //   then refresh the page so we're not bloating it all up with a bunch of
    //   memory given over to the prior task
    // the protocol here is:
    // B -> M pleasePrepareForRefresh
    // M -> B readyToRefresh
    // B -> M runScheduledScript
    // M -> B runningScheduledScript
    let readyForRefresh = false;
    Messages.listenForMessageOnce("mainpanel", "background", "readyToRefresh",
      () => {
        readyForRefresh = true;
        // ok, the mainpanel is ready to be refreshed
        chrome.windows.get(panelWindowId, { populate: true }, (winData) => {
          if (!winData.tabs || winData.tabs.length > 1) {
            throw new ReferenceError("There should be exactly one tab.");
          }

          const tab = winData.tabs[0];
          chrome.tabs.update(<number> tab.id, { url: 'pages/mainpanel.html' },
            () => {
            // ok, now that we've reloaded the mainpanel, let's go for it
            // but let's wait one sec, because it turns out even when this
            //   continuation runs, sometimes the old page is still loaded in
            //   and trying to respond, and sometimes it gets the response out
            //   even though it's about to be reloaded and of course can't do
            //   the real response
            // todo: a more robust way for this please
            setTimeout(() => {
              console.log("running scheduled script", id);
              let runRequestReceived = false;
              Messages.listenForMessageOnce("mainpanel", "background",
                "runningScheduledScript", () => { runRequestReceived = true; });
              const sendRunRequest = () => {
                Messages.sendMessage("background", "mainpanel",
                  "runScheduledScript", { progId: id });
              };
              MiscUtilities.repeatUntil(sendRunRequest,
                () => runRequestReceived,
                () => {
                  HelenaConsole.log("mainpanel received run request");
                }, 500, true);
            }, 1000);
          });
        }
      );
    });
    const sendRefreshRequest = () => {
      Messages.sendMessage("background", "mainpanel", "pleasePrepareForRefresh",
        {});
    };
    MiscUtilities.repeatUntil(sendRefreshRequest, () => readyForRefresh,
      () => {}, 500, true);
  }
}

function scheduledRunKey(run: ScheduledRun){
  return run.schedule + "_" + run.progId;
}
