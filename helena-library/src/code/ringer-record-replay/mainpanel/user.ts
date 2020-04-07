import { Logs } from "../common/logs";
import { RingerParams } from "../common/params";

/**
 * The interface for the user to interact with the replayer. Can be used to
 *   directly query the user.
 */
export class User {
  public activeTab: chrome.tabs.TabActiveInfo | null;
  private log = Logs.getLog('user');
  public panel: null;

  constructor() {
    this.panel = null;
    this.activeTab = null;
  }

  /**
   * Set which tab the user has selected.
   * @param tabInfo chrome TabActiveInfo
   */
  public activatedTab(tabInfo: chrome.tabs.TabActiveInfo) {
    this.activeTab = tabInfo;
  }


  /**
   * Question posed from the content script
   * @param prompt
   * @param port
   */
  public contentScriptQuestion(prompt: string, port: chrome.runtime.Port) {
    this.question(prompt, () => true, '', (answer: string) => {
      port.postMessage({ type: 'promptResponse', value: answer });
    });
  }

  /**
   * Get activated tab.
   */
  /*
  public getActivatedTab() {
    return this.activeTab;
  }*/

  /**
   * Query the user.
   * @param prompt Text to show the user
   * @param validation Check whether the answer is as exepcted
   * @param defaultAnswer Answer to use during automated periods
   * @param callback Continuation to pass answer into
   */
  private question(prompt: string, validation: (ans: string) => boolean,
      defaultAnswer: string, callback: (ans: string) => void) {
    if (RingerParams.params.replay.defaultUser) {
      callback(defaultAnswer);
    } else {
      /*
      this.panel.question(prompt, (answer: string) => {
        const sanitize = validation(answer);
        if (sanitize) {
          callback(sanitize);
        } else {
          this.question(prompt, validation, defaultAnswer, callback);
        }
      });*/
    }
  }

  /**
   * Set the panel.
   * @param panel 
   */
  /*
  public setPanel(panel) {
    this.panel = panel;
  }*/
}