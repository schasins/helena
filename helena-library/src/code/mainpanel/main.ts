import { HelenaMainpanel } from "./helena_mainpanel";

import { RecorderUI } from "./ui/recorder_ui";
import { RingerMainpanel } from "../ringer-record-replay/mainpanel/ringer_mainpanel";

// TODO: cjbaik: is there a way of avoiding using these as globals?
declare global {
	interface Window {
    helenaMainpanel: HelenaMainpanel;
    ringerMainpanel: RingerMainpanel;

    // TODO: cjbaik: find working modular version of the library?
    JSOG: any;
  }
  
  // TODO: factor out these JQuery libraries
  interface JQueryStatic {
    format: {
      date: Function;
    },
    csv: {
      toArrays: Function;
    }
  }
}

// make this call early so that the voices will be loaded early
// speechSynthesis.getVoices(); // in case we ever want to say anything

window.ringerMainpanel = new RingerMainpanel();

// the RecorderUI is the UI object that will show Helena programs, so certain
//   edits to the programs are allowed to call UI hooks that make the UI respond
//   to program changes
window.helenaMainpanel = new HelenaMainpanel(new RecorderUI());
window.helenaMainpanel.afterInit();