import {
  helenaIsReady,
  HelenaMainpanel,
  RingerMainpanel,
  RecorderUI,
} from "helena-lang";

// TODO: cjbaik: is there a way of avoiding using these as globals?
declare global {
  interface Window {
    helenaMainpanel: HelenaMainpanel;
    ringerMainpanel: RingerMainpanel;

    JSOG: any; // TODO: cjbaik: find working modular version of the library?

    // Used in test scripts, e.g. `runHelenaScript.py`
    scrapingRunsCompleted: number;
    datasetsScraped: (number | undefined)[];
  }

  interface JQueryStatic {
    format: {
      date: Function;
    };
    csv: {
      toArrays: Function;
    };
  }
}

window.scrapingRunsCompleted = 0;
window.datasetsScraped = [];

// make this call early so that the voices will be loaded early
// speechSynthesis.getVoices(); // in case we ever want to say anything

helenaIsReady.then(() => {
  window.ringerMainpanel = new RingerMainpanel();

  // the RecorderUI is the UI object that will show Helena programs, so certain
  //   edits to the programs are allowed to call UI hooks that make the UI respond
  //   to program changes
  window.helenaMainpanel = new HelenaMainpanel(new RecorderUI());
  window.helenaMainpanel.afterInit();
});
