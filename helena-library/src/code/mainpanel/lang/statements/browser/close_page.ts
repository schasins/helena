import * as _ from "underscore";

import { HelenaConsole } from "../../../../common/utils/helena_console";

import { HelenaLangObject } from "../../helena_lang";
import { PageVariable } from "../../../variables/page_variable";
import { RunObject, RunOptions } from "../../program";
import { Revival } from "../../../revival";

export class ClosePageStatement extends HelenaLangObject {
  public pageVarCurr: PageVariable;
  constructor(pageVarCurr: PageVariable) {
    super();
    Revival.addRevivalLabel(this);
    // setBlocklyLabel(this, "close");
    this.pageVarCurr = pageVarCurr;
  }

  public static createDummy() {
    return new ClosePageStatement(new PageVariable("", ""));
  }

  public toStringLines() {
    // close statements are now invisible cleanup, not normal statements, so
    //   don't use the line below for now
    // return [this.pageVarCurr.toString() + ".close()" ];
    return [];
  }

  public run(runObject: RunObject, rbbcontinuation: Function,
      rbboptions: RunOptions) {
    const self = this;
    console.log("run close statement");

    const tabId = this.pageVarCurr.currentTabId();
    if (tabId !== undefined && tabId !== null) {
      console.log("ClosePageStatement run removing tab",
        this.pageVarCurr.currentTabId());

      // we want to remove the tab, but we should never do that if we actually
      //   mapped the wrong tab and this tab belongs somewhere else
      // todo: in future, prevent it from mapping the wrong tab in the first
      //   place!  might involve messing with ringer layer
      // but also with setCurrentTabId, but mostly I think with the ringer layer
      const okToRemoveTab = runObject.program.pageVars.every(
        (pageVar: PageVariable) =>
          pageVar.currentTabId() !== self.pageVarCurr.currentTabId() ||
          pageVar === self.pageVarCurr
      );
      if (okToRemoveTab) {
        const tabId = this.pageVarCurr.currentTabId();
        if (!tabId) {
          throw new ReferenceError("tabId is undefined.");
        }
        chrome.tabs.remove(tabId, () => {
          self.pageVarCurr.clearCurrentTabId();
          const portManager = window.ringerMainpanel.ports;
          portManager.removeTabInfo(tabId);
          rbbcontinuation(rbboptions);
        });
      } else {
        // it's still ok to clear current tab, but don't close it
        self.pageVarCurr.clearCurrentTabId();
        rbbcontinuation(rbboptions);
      }
    } else {
      HelenaConsole.log("Warning: trying to close tab for pageVar that " +
        "didn't have a tab associated at the moment.  Can happen after " +
        "continue statement.");
      rbbcontinuation(rbboptions);
    }
  }
}