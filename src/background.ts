import { helenaIsReady, HelenaBackground } from "helena-lang";

helenaIsReady.then(() => {
  new HelenaBackground();
});
