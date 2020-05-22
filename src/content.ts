import { helenaIsReady, HelenaContent, RingerContent } from "helena-lang";

declare global {
  interface Window {
    helenaContent: HelenaContent;
    ringerContent: RingerContent;
  }
}

// Starts everything up.
helenaIsReady.then(() => {
  window.ringerContent = new RingerContent();
  window.helenaContent = new HelenaContent();
});
