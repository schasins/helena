import { HelenaConsole } from "../../../../common/utils/helena_console";
import { HelenaLangObject } from "../../helena_lang";
import { PageVariable } from "../../../variables/page_variable";
import { RunObject, RunOptions } from "../../program";
import { Revival } from "../../../revival";
import { Messages } from "../../../../common/messages";

export class BackStatement extends HelenaLangObject {
  public pageVarBack: PageVariable;
  public pageVarCurr: PageVariable;
  constructor(pageVarCurr: PageVariable,
      pageVarBack: PageVariable) {
    super();
    Revival.addRevivalLabel(this);
    // setBlocklyLabel(this, "back");
    
    this.pageVarCurr = pageVarCurr;
    this.pageVarBack = pageVarBack;
  }

  public static createDummy() {
    return new BackStatement(new PageVariable("", ""),
      new PageVariable("", ""));
  }

  public toStringLines() {
    // back statements are now invisible cleanup, not normal statements, so
    //   don't use the line below for now
    // return [this.pageVarBack.toString() + " = " + this.pageVarCurr.toString()
    //   + ".back()" ];
    return [];
  }

  public traverse(fn: Function, fn2: Function) {
    fn(this);
    fn2(this);
  }

  public run(runObject: RunObject, rbbcontinuation: Function,
      rbboptions: RunOptions) {
    const self = this;
    HelenaConsole.log("run back statement");
    
    // if something went wrong, we won't have a pagevar tabid, ugh
    if (!this.pageVarCurr.currentTabId()) {
        rbbcontinuation(rbboptions);
        return;
    }

    const pageVarTabId = this.pageVarCurr.currentTabId();
    this.pageVarCurr.clearCurrentTabId();

    // ok, the only thing we're doing right now is trying to run this back
    //   button, so the next time we see a tab ask for an id
    // it should be because of this -- yes, theoretically there could be a
    //   process we started earlier that *just* decided to load a new top-level
    //   page but that should probably be rare.
    // todo: is that actually rare?
    Messages.listenForMessageOnce("content", "mainpanel",
      "requestTabID", () => {
        HelenaConsole.log("back completed");
        if (pageVarTabId) {
          self.pageVarBack.setCurrentTabId(pageVarTabId,
            () => rbbcontinuation(rbboptions));
        }
    });

    // send a back message to pageVarCurr
    Messages.sendMessage("mainpanel", "content", "backButton", {}, undefined,
      undefined, [ <number> pageVarTabId ]);
    // todo: is it enough to just send this message and hope all goes well, or
    //   do we need some kind of acknowledgement?
    // update pageVarBack to make sure it has the right tab associated

    // todo: if we've been pressing next or more button within this loop, we
    //   might have to press back button a bunch of times!  or we might not if
    //   they chose not to make it a new page!  how to resolve????
  }
}