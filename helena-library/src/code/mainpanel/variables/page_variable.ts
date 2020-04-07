// import { SortedArray } from "../../common/utils/sorted_array";

import { HelenaConsole } from "../../common/utils/helena_console";
import { MainpanelNode } from "../../common/mainpanel_node";
import { Revival } from "../revival";
import { RingerFrameInfo } from "../../ringer-record-replay/common/event";

// note that first arg should be SortedArray not just sorted array
/*function outlier(sortedList, potentialItem) {
  // for now, difficult to deal with...
  return false;
  if (sortedList.length <= 10) {
    // it's just too soon to know if this is an outlier...
    return false;
  }
  // generous q1, q3
  var q1 = sortedList.get(Math.floor((sortedList.length() / 4)));
  var q3 = sortedList.get(Math.ceil((sortedList.length() * (3 / 4))));
  var iqr = q3 - q1;

  //var minValue = q1 - iqr * 1.5;
  //var maxValue = q3 + iqr * 1.5;
  var minValue = q1 - iqr * 3;
  var maxValue = q3 + iqr * 3;
  WALconsole.log("**************");
  WALconsole.log(sortedList.array);
  WALconsole.log(q1, q3, iqr);
  WALconsole.log(minValue, maxValue);
  WALconsole.log("**************");
  if (potentialItem < minValue || potentialItem > maxValue) {
    return true;
  }
  return false;
}*/
/*
interface PageStats {
  numNodes: SortedArray;
}

function freshPageStats(): PageStats {
  return { numNodes: new SortedArray([]) };
}*/

export interface PageRelation {
  currentRows: MainpanelNode.Interface[][] | null;
  currentRowsCounter: number;
  currentTabId?: number;
  currentNextInteractionAttempts: number;
  runNextInteraction?: boolean;
  needNewRows?: boolean;
}

export class PageVariable implements Revival.Revivable {
  public ___revivalLabel___: string;
  public name: string;
  public recordTimeUrl: string;
  public pageRelations: {
    [key: string]: PageRelation
  };
  // public pageStats: PageStats;

  public tabId?: number;

  public recordTimeFrameData: RingerFrameInfo;

  constructor(name: string, recordTimeUrl: string) {
    Revival.addRevivalLabel(this);

    this.name = name;
    this.recordTimeUrl = recordTimeUrl;
    this.pageRelations = {};
    HelenaConsole.namedLog("prinfo", "fresh empty pageRelations");
    // this.pageStats = freshPageStats();
  }

  public static createDummy() {
    return new PageVariable("", "");
  }

  public static makePageVarsDropdown(pageVars: PageVariable[]) {
    let pageVarsDropDown = [];
    for (const pageVar of pageVars) {
      const pageVarStr = pageVar.toString();
      pageVarsDropDown.push([pageVarStr, pageVarStr]);
    }
    return pageVarsDropDown;
  }
  
  public setRecordTimeFrameData(frameData: RingerFrameInfo) {
    this.recordTimeFrameData = frameData;
  }

  public setCurrentTabId(tabId: number, continuation: Function) {
    HelenaConsole.log("setCurrentTabId", tabId);
    this.tabId = tabId;
    continuation();
    return;
    // we used to try outlier checking.  might be something to consider in
    //   future, but didn't seem all the helpful so far
    /*
    this.currentTabIdPageStatsRetrieved = false;
    that.nonOutlierProcessing(data, continuation);
    if (tabId !== undefined) {
      Messages.listenForMessageOnce("content", "mainpanel", "pageStats", function(data) {
        that.currentTabIdPageStatsRetrieved = true;
        if (that.pageOutlier(data)) {
          WALconsole.log("This was an outlier page!");
          var dialogText = "Woah, this page looks very different from what we expected.  We thought we'd get a page that looked like this:";
          if (ReplayScript.prog.mostRecentRow) {
            dialogText += "<br>If it's helpful, the last row we scraped looked like this:<br>";
            dialogText += DOMCreation.arrayOfArraysToTable([ReplayScript.prog.mostRecentRow]).html(); // todo: is this really the best way to acess the most recent row?
          }
          UIObject.addDialog("Weird Page", dialogText, 
            {"I've fixed it": function _fixedHandler() {WALconsole.log("I've fixed it."); that.setCurrentTabId(tabId, continuation);}, 
            "That's the right page": function _rightPageHandler() {WALconsole.log("That's the right page."); that.nonOutlierProcessing(data, continuation);}});
        }
        else{
          that.nonOutlierProcessing(data, continuation);
        }
      });
      MiscUtilities.repeatUntil(
        function() {Messages.sendMessage("mainpanel", "content", "pageStats", {}, null, null, [tabId], null);}, 
        function() {return that.currentTabIdPageStatsRetrieved;},
  function() {},
        1000, true);
    }
    else{
      continuation();
    }
    */
  }

  public clearCurrentTabId() {
    this.tabId = undefined;
  }

  /*
  public nonOutlierProcessing(pageData, continuation) {
    // wasn't an outlier, so let's actually update the pageStats
    this.updatePageStats(pageData);
    continuation();
  }

  public pageOutlier(pageData) {
    return outlier(this.pageStats.numNodes, pageData.numNodes); // in future, maybe just iterate through whatever attributes we have, but not sure yet
  }*/

  /*
  public updatePageStats(stats: PageStats) {
    this.pageStats.numNodes.insert(stats.numNodes); // it's sorted
  }*/
  
  public clearRelationData() {
    this.pageRelations = {};
    HelenaConsole.namedLog("prinfo", "clear relation data");
  }

  public originalTabId() {
    HelenaConsole.log(this.recordTimeFrameData);
    if (this.recordTimeFrameData) {
      return this.recordTimeFrameData.tab;
    }
    return null;
  }

  public currentTabId() {
    return this.tabId;
  }

  public toString() {
    return this.name;
  }

  public clearRunningState() {
    this.tabId = undefined;
    // this.pageStats = freshPageStats();
    this.clearRelationData();
  }
}