import { RingerMessage, PortInfo } from "../common/messages";
import { Logs } from "../common/logs";

export interface TabInfo {
  top: PortInfo[];
  frames: PortInfo[];
}

interface SingleTopTabInfo {
  top?: PortInfo;
  frames: PortInfo[];
}

/**
 * Manages mappings between ports, tabs, iframes, etc.
 */
export class PortManager {
  private log = Logs.getLog('ports');
  public numPorts: number;
  public portIdToPort: { [key: string]: chrome.runtime.Port };
  public portIdToPortInfo: { [key: string]: PortInfo } ;
  public portIdToTabId: { [key: string]: number };
  public portIdToWindowId: { [key: string]: number };
  public tabIdToPortIds: { [key: number]: string[] };
  public tabIdToTab: { [key: number]: chrome.tabs.Tab };
  public tabIdToTabInfo: { [key: number]: TabInfo };
  public tabIdToWindowId: { [key: number]: number };

  constructor() {
    this.numPorts = 0;
    this.portIdToPort = {};
    this.portIdToTabId = {};
    this.portIdToPortInfo = {};
    this.portIdToWindowId = {};
    this.tabIdToPortIds = {};
    this.tabIdToTabInfo = {};
    this.tabIdToTab = {};
    this.tabIdToWindowId = {};
  }

  /**
   * When a port connects, store its metadata.
   * @param port 
   */
  public connectPort(port: chrome.runtime.Port) {
    const self = this;
  
    const portId = port.name;
    const ports = this.portIdToPort;

    this.portIdToPort[portId] = port;

    port.onMessage.addListener((msg) => {
      window.ringerMainpanel.handleMessage(port, msg);
    });

    port.onDisconnect.addListener((evt) => {
      self.log.log('Disconnect port:', port);

      if (portId in ports) {
        delete ports[portId];
      } else {
        throw new ReferenceError("Can't find port");
      }

      const portInfo = self.portIdToPortInfo[portId];
      const tabId = self.portIdToTabId[portId];
      const tabInfo = self.tabIdToTabInfo[tabId];

      let frames: PortInfo[];
      if (tabInfo) {
        if (portInfo.top) {
          frames = tabInfo.top;
        } else {
          frames = tabInfo.frames;
        }

        for (let i = 0; i < frames.length; ++i) {
          if (frames[i].portId === portId) {
            frames.splice(i, 1);
            break;
          }
        }
      } else {
        self.log.log('Cannot find information about tab:', tabId, tabInfo);
      }
    });
  }

  /**
   * Gets a new id from the content script.
   * @param value
   * @param sender 
   */
  public getNewId(value: PortInfo, sender: chrome.runtime.MessageSender) {
    const self = this;

    // for some reason, the start page loads the content script but doesn't
    //   have a tab id. in this case, don't assign an id
    //console.log("getNewId", value, sender);
    if (!sender.tab) {
      this.log.warn('request for new id without a tab id');
      return;
    }

    const windowId = sender.tab.windowId;

    // bug with listening to removed tabs, so lets actually check which
    //   tabs are open and then update our list appropriately
    chrome.tabs.query({}, (openTabs) => {
      self.updateRemovedTabs(openTabs);
    });

    this.numPorts++;
    const portId = this.numPorts.toString();

    this.log.log('adding new id: ', portId, value);

    /* Update various mappings */
    const tabId = sender.tab.id;
    if (!tabId) {
      throw new ReferenceError("No tab id was sent.");
    }

    this.tabIdToTab[tabId] = sender.tab;
    this.tabIdToWindowId[tabId] = windowId;
    this.log.log('adding tab:', tabId, sender.tab);

    this.portIdToTabId[portId] = tabId;
    this.portIdToPortInfo[portId] = value;
    value.portId = portId;
    this.portIdToWindowId[portId] = windowId;

    let portIds = this.tabIdToPortIds[tabId];
    if (!portIds) {
      portIds = [];
      this.tabIdToPortIds[tabId] = portIds;
    }
    portIds.push(portId);

    let tabInfo: TabInfo = this.tabIdToTabInfo[tabId];
    if (!tabInfo) {
      tabInfo = {
        top: [],
        frames: []
      };
      this.tabIdToTabInfo[tabId] = tabInfo;
    }
  
    if (value.top) {
      tabInfo.top.push(value);
      // console.log("this.tabIdToTabInfo, added top frame: ",
      //   this.tabIdToTabInfo);
    } else {
      // console.log("this.tabIdToTabInfo, added non-top frame: ",
      //   this.tabIdToTabInfo);
      tabInfo.frames.push(value);
    }
    return portId;
  }

  /**
   * Get a {@link chrome.runtime.Port} given a port id.
   * @param portId 
   */
  public getPort(portId: string) {
    return this.portIdToPort[portId];
  }

  /**
   * Get a {@link chrome.tabs.Tab} from the tab id.
   * @param tabId 
   */
  public getTabFromTabId(tabId: number) {
    return this.tabIdToTab[tabId];
  }

  /**
   * Get tab id given a port id.
   * @param portId 
   */
  public getTabId(portId: string) {
    return this.portIdToTabId[portId];
  }

  /**
   * Get tab info.
   * @param tabId 
   */
  public getTabInfo(tabId: number) {
    const tabInfo = this.tabIdToTabInfo[tabId];
    if (!tabInfo) {
      return null;
    }

    const ret: SingleTopTabInfo = {
      frames: tabInfo.frames
    };

    // we store all the top frames, so just return the last frame
    const topFrames = tabInfo.top;
    if (topFrames.length > 0) {
      ret.top = topFrames[topFrames.length - 1];
    }

    return ret;
  }

  /**
   * Get window id given a port id.
   * @param portId 
   */
  public getWindowId(portId: string) {
    return this.portIdToWindowId[portId];
  }

  /**
   * Delete information about the port.
   * @param portId 
   */
  public removePort(portId: string) {
    delete this.portIdToPort[portId];
    delete this.portIdToPortInfo[portId];
    delete this.portIdToTabId[portId];
    delete this.portIdToWindowId[portId];
  }

  /**
   * Delete information about the tab.
   * @param tabId 
   */
  public removeTab(tabId: number) {
    const portIds = this.tabIdToPortIds[tabId];
    if (portIds){
      for (const portId of portIds) {
        this.removePort(portId);
      }
    }
    delete this.tabIdToPortIds[tabId];
    delete this.tabIdToTab[tabId];
    delete this.tabIdToTabInfo[tabId];
  }

  /**
   * Delete all information about the tab.
   * @param tabId 
   */
  public removeTabInfo(tabId: number) {
    delete this.tabIdToTabInfo[tabId];
    delete this.tabIdToWindowId[tabId];
    delete this.tabIdToTab[tabId];
    const ports = this.tabIdToPortIds[tabId];
    delete this.tabIdToPortIds[tabId];
    for (const port of ports) {
      delete this.portIdToPort[port];
      delete this.portIdToTabId[port];
      delete this.portIdToPortInfo[port];
      delete this.portIdToWindowId[port];
    }
  }

  /**
   * Send message to all content scripts.
   * @param message 
   */
  public sendToAll(message: RingerMessage) {
    this.log.log('sending to all:', message);
    const ports = this.portIdToPort;
    for (const portId in ports) {
      ports[portId].postMessage(message);
    }
  }

  /**
   * Remove tabs that are not currently open.
   * @param openTabs list of currently open tabs.
   */
  public updateRemovedTabs(openTabs: chrome.tabs.Tab[]) {
    const possiblyOpenTabs: { [key: number]: boolean } = {};
    for (const tabId in this.tabIdToTab) {
      possiblyOpenTabs[parseInt(tabId)] = false;
    }
    for (const openTab of openTabs) {
      possiblyOpenTabs[<number> openTab.id] = true;
    }

    for (const tabId in possiblyOpenTabs) {
      if (!possiblyOpenTabs[tabId]) {
        this.removeTab(parseInt(tabId));
      }
    }
  }

  /**
   * Update the URL associated with the port.
   * @param port 
   * @param url 
   */
  public updateUrl(port: chrome.runtime.Port, url: string) {
    this.portIdToPortInfo[port.name].URL = url;
  }
}