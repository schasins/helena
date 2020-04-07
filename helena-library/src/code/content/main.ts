import { HelenaContent } from "./helena_content";
import { RingerContent } from "../ringer-record-replay/content/ringer_content";

declare global {
	interface Window {
		helenaContent: HelenaContent;
    ringerContent: RingerContent;
	}
}

// Starts everything up.
window.ringerContent = new RingerContent();
window.helenaContent = new HelenaContent();