import { HelenaConsole } from "./utils/helena_console";

import { MainpanelNode } from "./mainpanel_node";
import MainpanelNodeI = MainpanelNode.Interface;

import { Features } from "../content/utils/features";
import GenericFeatureSet = Features.GenericFeatureSet;

import { XPath } from "../content/utils/xpath";
import SuffixXPathList = XPath.SuffixXPathList;

import { INextButtonSelector, IColumnSelector } from "../content/selector/interfaces";

export interface ColumnSelectorMessage {
  xpath: string;
  suffix: SuffixXPathList | SuffixXPathList[];
  name?: string;
  id: number | null;
  index?: string;
}

export interface TabDetailsMessage {
  tab_id: number;
  window_id: number;
  top_frame_url: string;
}

export interface WindowIdMessage {
  window: number;
}

export interface WindowsMessage {
  window_ids: number[];
}

export interface ColumnIndexMessage {
  index: number;
}

export interface LikelyRelationMessage {
  xpaths: string[];
  pageVarName: string;
  serverSuggestedRelations: (RelationMessage | null)[];
}

export interface FreshRelationItemsMessage {
  type: number;
  relation: MainpanelNodeI[][];
}

export interface EditRelationMessage {
  relation: null;
  demonstration_time_relation: MainpanelNodeI[][];
  colors: string[];
}

export interface NextButtonSelectorMessage {
  selector: INextButtonSelector;
}

export interface RelationMessage {
  id: string;
  name: string;
  selector: GenericFeatureSet | GenericFeatureSet[];
  selector_version: number;
  exclude_first: number,
  columns: IColumnSelector[],
  url: string;
  next_type?: number;
  next_button_selector?: INextButtonSelector | null;
  num_rows_in_demonstration?: number;
  relation_scrape_wait: number;
  prior_next_button_text?: string;
}

export interface NextButtonTextMessage {
  text: string;
}

export interface FastModeMessage {
  use: boolean;
}

export interface SkipBlockResponse {
  exists: boolean;
  task_yours: boolean;
}

export interface ServerSaveResponse {
  program: {
    id: string;
  }
}

export interface SavedProgramMessage {
  id: string;
  date: number;
  name: string;
  serialized_program: string;
}

export interface ScheduledScriptMessage {
  progId: string;
}

export interface DatasetSliceRequest {
  nodes: string;
  pass_start_time: number;
  position_lists: string;
  run_id?: number;
  sub_run_id?: number;
}

export interface RelationResponse {
  columns: IColumnSelector[];
  exclude_first: number;
  first_page_relation: MainpanelNode.Interface[][];
  frame: number;
  name: string;
  next_button_selector: INextButtonSelector;
  next_type: number;
  num_rows_in_demonstration: number;
  page_var_name: string;
  pulldown_relations: RelationResponse[];
  relation_id: string;
  selector: GenericFeatureSet[];
  selector_version: number;
  url: string;
}

enum SendTypes {
  NORMAL = 0,
  FRAMESPECIFIC = 1
}

export namespace Messages {
  let listenerCounter = 1;
  let oneOffListenerCounter = 1;
  
  const listeners: {
    [key: string]: Function
  } = {};

  interface Message {
    content: MessageContent;
    frame_ids_exclude?: number[];
    frame_ids_include?: number[];
    from: string;
    send_type: SendTypes;
    subject: string;
  }

  interface FrameSpecificMessage extends Message {
    frame_specific_subject: string;
  }

  interface MessageContent {
    [key: string]: any;
  }

  export interface MessageContentWithTab {
    tab_id: number;
  }

  interface Sender {
    tab: chrome.tabs.Tab;
  }
  
  /* cjbaik: extension.onMessage is deprecated, move everything to runtime?
  const extensionListeners: {
    [key: string]: Function
  } = {}; */

  chrome.runtime.onMessage.addListener((msg, sender) => {
    for (const key in listeners){
      const wasRightHandler = listeners[key](msg, sender);
      if (wasRightHandler) {
        return;
      }
    }
    HelenaConsole.namedLog("tooCommon", "couldn't find right handler", msg,
      sender);
  });

  /*
  chrome.extension.onMessage.addListener((msg, sender) => {
    // HelenaConsole.log("keys", Object.keys(extensionListeners));
    for (var key in extensionListeners){
      // HelenaConsole.log("key", key);
      var wasRightHandler = extensionListeners[key](msg, sender);
      if (wasRightHandler){
        return;
      }
    }
    HelenaConsole.namedLog("tooCommon", "Couldn't find right handler", msg,
      sender);
  });*/

  export function listenForMessage(from: string, to: string, subject: string,
      fn: Function, key: string | number = listenerCounter) {
    HelenaConsole.log(`Listening for messages: ${from} : ${to} : ${subject}`);
    listenerCounter += 1;
    if (to === "background" || to === "mainpanel") {
      listeners[key] = (msg: Message, sender: Sender) => {
        if (msg.from && msg.from === from &&
            msg.subject && msg.subject === subject &&
            msg.send_type === SendTypes.NORMAL) {
          if (sender.tab && sender.tab.id){
            // add a tab id iff it's from content, and thus has sender.tab and
            //   sender.tab.id
            if (!msg.content) {
              msg.content = {};
            }
            msg.content.tab_id = sender.tab.id;
          }
          HelenaConsole.log("Receiving message: ", msg);
          HelenaConsole.log("from tab id: ", msg.content.tab_id);
          fn(msg.content);
          return true;
        }
        HelenaConsole.log("No subject match: ", msg.subject, subject);
        return false;
      };
    } else if (to === "content") {
      // HelenaConsole.log("content listener", key, subject);
      listeners[key] = (msg: Message, sender: Sender) => {
        // HelenaConsole.log(msg, sender);
        const frame_id = window.ringerContent.frameId;
        if (!frame_id) {
          throw new ReferenceError("frameId not set!");
        }
        if (msg.frame_ids_include &&
            !msg.frame_ids_include.includes(frame_id)){
          HelenaConsole.log("Msg for frames with ids "+ msg.frame_ids_include +
            ", but this frame has id " + frame_id + ".");
          return false;
        } else if (msg.frame_ids_exclude &&
                   msg.frame_ids_exclude.includes(frame_id)){
          HelenaConsole.log("Msg for frames w/o ids " + msg.frame_ids_exclude +
            ", but this frame has id " + frame_id + ".");
          return false;
        } else if (msg.from && msg.from === from &&
                   msg.subject && msg.subject === subject &&
                   msg.send_type === SendTypes.NORMAL) {
          HelenaConsole.log("Receiving message: ", msg);
          fn(msg.content);
          return true;
        } else {
          // HelenaConsole.log("Received message, but not a match for current listener.");
          // HelenaConsole.log(msg.from, from, (msg.from === from), msg.subject, subject, (msg.subject === subject), (msg.send_type === sendTypes.NORMAL));
          return false;
        }
      };
    } else {
      console.log("Bad to field in msg:", to);
    }
  }

  // note that this frameSpecificMessage assume we'll have a response handler,
  //   so fn should provide a return value, rather than sending its own messages
  export function listenForFrameSpecificMessage(from: string, to: string,
      subject: string, fn: Function){
    HelenaConsole.log(`Listening for frame-specific messages: ${from} : ${to} : ${subject}`);
    chrome.runtime.onMessage.addListener((msg: Message, sender: Sender) => {
      if (msg.subject === subject &&
          msg.send_type === SendTypes.FRAMESPECIFIC){
        const frameMsg = <FrameSpecificMessage> msg;
        const key = frameMsg.frame_specific_subject;
        const sendResponse = (content: MessageContent) => {
          sendMessage(to, from, key, content);
        };
        HelenaConsole.log("Receiving frame-specific message: ", frameMsg);
        fn(frameMsg.content, sendResponse);

        // must return true so that the sendResponse channel remains open
        //   (indicates we'll use sendResponse asynchronously. may not always,
        //   but have the option)
        return true;
      }
      return;
    });
  }

  export function listenForMessageOnce(from: string, to: string,
      subject: string, fn: Function) {
    HelenaConsole.log(`Listening once for message: ${from} : ${to} : ${subject}`);
    const key = `oneoff_${oneOffListenerCounter}`;
    let newfunc = null;
    oneOffListenerCounter += 1;
    newfunc = (msg: Message) => {
      delete listeners[key];
      fn(msg);
    };
    listenForMessage(from, to, subject, newfunc, key);
  }

  export function listenForMessageWithKey(from: string, to: string,
      subject: string, key: string, fn: Function){
    HelenaConsole.log(`Listening for message with key: ${from} : ${to} : ${subject}`);
    listenForMessage(from, to, subject, fn, key);
  }

  /*
  export function stopListeningForMessageWithKey(from: string, to: string, subject, key){
    // HelenaConsole.log("deleting key", key);
    if (to === "background" || to === "mainpanel"){
      delete runtimeListeners[key];
    }
    else if (to === "content"){
      delete extensionListeners[key];
    }
  }*/

  // note: 
  /**
   * 
   * @param from 
   * @param to 
   * @param subject 
   * @param content 
   * @param frameIdsInclude frame_ids are our own internal frame ids, not chrome
   *   frame ids
   * @param frameIdsExclude frame_ids are our own internal frame ids, not chrome
   *   frame ids
   * @param tabIdsInclude 
   * @param tabIdsExclude 
   */
  export function sendMessage(from: string, to: string, subject: string,
      content: MessageContent, frameIdsInclude?: number[],
      frameIdsExclude?: number[], tabIdsInclude?: number[],
      tabIdsExclude?: number[]) {
    if ((from === "background" || from === "mainpanel") && to === "content") {
      const msg: Message = {
        from: from,
        subject: subject,
        content: content,
        frame_ids_include: frameIdsInclude,
        frame_ids_exclude: frameIdsExclude,
        send_type: SendTypes.NORMAL
      };
      HelenaConsole.log("Sending message: ", msg);
      HelenaConsole.log(tabIdsInclude, tabIdsExclude);
      if (tabIdsInclude) {
        for (const tabId of tabIdsInclude) {
          if (tabId) {
            chrome.tabs.sendMessage(tabId, msg); 
          } else {
            HelenaConsole.warn("Tried to send message to undefined tab, very bad.");
            const err = new Error();
            HelenaConsole.warn(err.stack);
          }
        }
        HelenaConsole.log("(Sent to ", tabIdsInclude.length, " tabs: ",
          tabIdsInclude, " )");
      } else {
        chrome.tabs.query({ windowType: "normal" }, (tabs) => {
          let tabsMessaged = 0;
          for (const tab of tabs) {
            if (tab.id && !(tabIdsExclude && tabIdsExclude.includes(tab.id))) {
              try {
                chrome.tabs.sendMessage(tab.id, msg); 
              } catch(err) {
                // HelenaConsole.warn("failure to send message:", msg);
              }
              tabsMessaged++;
            }
          }
          HelenaConsole.log("(Sent to "+tabsMessaged+" tabs.)");
        });
      }
    } else if (to === "background" || to === "mainpanel") {
      const msg: Message = {
        from: from,
        subject: subject,
        content: content,
        send_type: SendTypes.NORMAL
      };
      HelenaConsole.log("Sending message: ", msg);
      chrome.runtime.sendMessage(msg);
    } else {
      HelenaConsole.warn("Bad from field in msg:", from);
    }
  };

  // 
  /**
   * Make a channel based on the frame id and the subject, and anything that
   *   comes from that frame with that subject will go to that channel.
   * @param from 
   * @param to 
   * @param subject 
   * @param content 
   * @param chromeTabId 
   * @param chromeFrameId not the same as our internal frame ids
   * @param handler 
   */
  export function sendFrameSpecificMessage(from: string, to: string,
      subject: string, content: MessageContent, chromeTabId: number,
      chromeFrameId: number, handler: Function){
    const key = subject+"_"+chromeFrameId;
    const msg: FrameSpecificMessage = {
      from: from,
      subject: subject,
      content: content,
      send_type: SendTypes.FRAMESPECIFIC,
      frame_specific_subject: key
    };
    HelenaConsole.log("Sending frame-specific message: ", msg);
    const newResponseHandler = (data: any) => {
      //console.log("in response handler", data);
      handler(data);
    }
    // let's register what to do when we actually get a response
    // and remember, multiple frames might be sending this, so we need to make
    //   sure we'll always get the right handler (a different one for each
    //   frame), so we'll use the new frame-specific key as the 'subject'
    listenForMessage(to, from, key, newResponseHandler, key);

    // only send to the correct tab!
    chrome.tabs.sendMessage(chromeTabId, msg, {frameId: chromeFrameId});
  }
}