import * as _ from "underscore";

import { HelenaConsole } from "../../common/utils/helena_console";
import { MainpanelNode } from "../../common/mainpanel_node";
import { PageVariable } from "./page_variable";
import { Revival } from "../revival";
import { Environment } from "../environment";
import { Trace } from "../../common/utils/trace";
import { DOMRingerEvent } from "../../ringer-record-replay/common/event";

export enum NodeSources {
  RELATIONEXTRACTOR = 1,
  RINGER,
  PARAMETER,
  TEXTRELATION,
};

export class NodeVariable implements Revival.Revivable {
  public static counter = 0;

  public ___revivalLabel___: string;
  public name: string | null;
  public nodeSource?: number;
  private privateName: string;
  public recordedNodeSnapshot?: MainpanelNode.Interface | null;
  public nodeRep: MainpanelNode.Interface;
  // public mainpanelRep: MainpanelNode.Interface | null;
  public imgData?: string | null;
  public requiredFeatures: string[];

  constructor(name?: string | null,
      mainpanelRep?: MainpanelNode.Interface | null,
      recordedNodeSnapshot?: MainpanelNode.Interface | null,
      imgData?: string | null, source?: number) {
    Revival.addRevivalLabel(this);

    if (!name) {
      NodeVariable.counter += 1;
      name = "thing_" + NodeVariable.counter;
    }
  
    this.setName(name);

    if (source === NodeSources.PARAMETER) {
      this.nodeSource = source;
      // let's put this in our allNodeVariablesSeenSoFar record of all our nvs
      window.helenaMainpanel.allNodeVariablesSeenSoFar.push(this);
    }
  
    // ok, node variables are a little weird, because we have a special interest
    //   in making sure that every place where the same node is used in the
    //   script is also represented by the same object in the prog (so that we
    //   can rename in one place and have it propogate all over the program, not
    //   confuse the user into thinking a single node could be multiple)
    this.recordedNodeSnapshot = recordedNodeSnapshot;
    if (!recordedNodeSnapshot && mainpanelRep) {
      // when we make a node variable based on a cell of a relation, we may not
      //   have access to the full node snapshot
      this.recordedNodeSnapshot = mainpanelRep;
    }
    // ok, but also sometimes we get the recorded snapshot, which records text
    //   in the textcontent field but we'll want to reason about the text field
    // nope, the textContent can totally be different from text have to just
    //   start recording textContent of all the relation-scraped nodes
    /*
    if (this.recordedNodeSnapshot && this.recordedNodeSnapshot.textContent) {
      this.recordedNodeSnapshot.text = this.recordedNodeSnapshot.textContent;
    }
    */

    // go through here if they provided either a snapshot or a mainpanel rep
    if (this.recordedNodeSnapshot) {
      // actually go through and compare to all prior nodes
      for (const node of window.helenaMainpanel.allNodeVariablesSeenSoFar) {
        if (source !== NodeSources.TEXTRELATION &&
            this.sameNode(node)) {
          // ok, we already have a node variable for representing this. just
          //   return that. first update all the attributes based on how we now
          //   want to use the node
          if (name) { node.setName(name); }
          // if (mainpanelRep) { node.mainpanelRep = mainpanelRep; }
          if (source) { node.nodeSource = source; }
          if (recordedNodeSnapshot) {
            node.recordedNodeSnapshot = recordedNodeSnapshot;
          }
          if (imgData) { node.imgData = imgData; }
          return node;
        }
      }
      // ok, this is our first time seeing the node.  go ahead and build it in
      //   the normal way
      this.imgData = imgData;
      this.nodeSource = source;
 
      // and let's put this in our allNodeVariablesSeenSoFar record of all our nvs
      window.helenaMainpanel.allNodeVariablesSeenSoFar.push(this);
    }
 
   if (!window.helenaMainpanel.allNodeVariablesSeenSoFar.includes(this)) {
     // ok, we're reconstructing a program, so we don't yet have this node
     //   variable in our tracker of all node variables.  go ahead and add it
     window.helenaMainpanel.allNodeVariablesSeenSoFar.push(this);
   }
   
   this.requiredFeatures = [];
  }

  public static createDummy() {
    return new NodeVariable();
  }

  /**
   * Create a node variable from a trace.
   * @param trace 
   */
  public static fromTrace(trace: Trace) {
    let recordTimeNodeSnapshot = null;
    let imgData = null;
    // may get 0-length trace if we're just adding a scrape statement by editing
    //   (as for a known column in a relation)
    if (trace.length > 0) {
      // 0 bc this is the first ev that prompted us to turn it into the given
      //   statement, so must use the right node
      const ev = <DOMRingerEvent> trace[0];
      recordTimeNodeSnapshot = ev.target.snapshot;
      imgData = ev.additional.visualization;
    }
    return new NodeVariable(null, null, recordTimeNodeSnapshot, imgData,
      NodeSources.RINGER); // null bc no preferred name
  }

  // we need these defined right here because we're about to use them in initialization
  public getName() {
    if (this.privateName) {
      return this.privateName;
    }
    if (this.name) {
      return this.name; // this is here for backwards compatibility.
    }
    return this.privateName;
  }

  public setName(name: string) {
    // don't set it to the original name unless nothing else has that name yet
    const otherNode = window.helenaMainpanel.getNodeVariableByName(name);
    if (!otherNode) {
      this.privateName = name;
    } else {
      if (otherNode === this) {
        // we're renaming it to the same thing.  no need to do anything
        return;
      }
      this.setName("alt_" + name);
    }
  }

  public sameNode(otherNodeVariable: NodeVariable) {
    const nr1 = this.recordedNodeSnapshot;
    const nr2 = otherNodeVariable.recordedNodeSnapshot;
    if (!nr1 || !nr2 || nr1.xpath === "" || nr2.xpath === "") {
      // don't return that things line up just because we failed to find a node.
      // it will make us try to redefine the same thing over and over, and we'll
      //   get errors from that
      return false;
    }

    // baseURI is the url on which the ndoe was found
    const ans = nr1.xpath === nr2.xpath && nr1.source_url === nr2.source_url;
    return ans;
  }

  public toString(alreadyBound = true, pageVar?: PageVariable) {
    if (alreadyBound) {
      return this.getName();
    }
    return this.imgData? this.imgData : "undefined";
  }

  public recordTimeText() {
    return this.recordedNodeSnapshot?.text;
  }

  public recordTimeLink() {
    return this.recordedNodeSnapshot?.link;
  }

  public recordTimeXPath() {
    return this.recordedNodeSnapshot?.xpath;
  }

  public recordTimeSnapshot() {
    return this.recordedNodeSnapshot;
  }

  public setCurrentNodeRep(environment: Environment.Frame,
    nodeRep: MainpanelNode.Interface | null) {
    // todo: should be a better way to get env
    HelenaConsole.log("setCurrentNodeRep", this.getName(), nodeRep);
    environment.envBind(this.getName(), nodeRep);
  }

  public currentNodeRep(environment: Environment.Frame):
    MainpanelNode.Interface {
    // don't want to let someone call this and start messing with the
    //   enviornment representation, so clone
    return _.clone(environment.envLookup(this.getName()));
  }

  public currentText(environment: Environment.Frame) {
    const text = this.currentNodeRep(environment).text;
    return text? text : "undefined";
  }

  public currentLink(environment: Environment.Frame) {
    return this.currentNodeRep(environment).link;
  }

  public currentXPath(environment: Environment.Frame) {
    return this.currentNodeRep(environment).xpath;
  }

  public setSource(src: number) {
    this.nodeSource = src;
  }

  public getSource() {
    return this.nodeSource;
  }

  public getRequiredFeatures() {
    return this.requiredFeatures;
  }

  public setRequiredFeatures(featureSet: string[]) {
    this.requiredFeatures = featureSet;
  }

  public requireFeature(feature: string) {
    this.requiredFeatures.push(feature);
  }

  public unrequireFeature(feature: string) {
    this.requiredFeatures = this.requiredFeatures.filter(
      (reqFeat) => reqFeat !== feature
    );
  }
}