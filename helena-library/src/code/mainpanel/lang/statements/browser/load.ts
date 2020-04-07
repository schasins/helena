import * as Blockly from "blockly";

import { NodeVariable } from "../../../variables/node_variable";
import { NodeVariableUse } from "../../values/node_variable_use";

import { HelenaLangObject } from "../../helena_lang";

import { HelenaString } from "../../values/string";
import { Concatenate } from "../../values/concatenate";

import { GenericRelation } from "../../../relation/generic";
import { PageVariable } from "../../../variables/page_variable";
import { RunObject, HelenaProgram, RunOptions,
  TraceContributions } from "../../program";
import { Revival } from "../../../revival";
import { Trace, Traces, DisplayTraceEvent } from "../../../../common/utils/trace";
import { Environment } from "../../../environment";
import { MiscUtilities } from "../../../../common/misc_utilities";
import { TextRelation } from "../../../relation/text_relation";
import { Relation } from "../../../relation/relation";
import { HelenaBlocks } from "../../../ui/blocks";

export class LoadStatement extends HelenaLangObject {
  public cleanTrace: Trace;
  public contributesTrace?: TraceContributions;
  public currentUrl: string | HelenaString | NodeVariable | NodeVariableUse |
    Concatenate | null;
  public outputPageVar?: PageVariable;
  public outputPageVars: (PageVariable | undefined)[];
  public relation: GenericRelation | null;
  public trace: Trace;
  public url: string;

  constructor(trace?: Trace) {
    super();
    Revival.addRevivalLabel(this);
    this.setBlocklyLabel("load");

    // Prematurely end, for the `createDummy` method
    if (!trace) {
      return;
    }

    // find the record-time constants that we'll turn into parameters
    this.trace = trace;

    const ev = Traces.firstVisibleEvent(trace);
    this.url = ev.data.url;
    this.outputPageVar = Traces.getLoadOutputPageVar(<DisplayTraceEvent> ev);

    // this will make it easier to work with for other parts of the code
    this.outputPageVars = [ this.outputPageVar ];

    // for now, assume the ones we saw at record time are the ones we'll want at
    //   replay
    this.currentUrl = new HelenaString(this.url);

    // usually 'completed' events actually don't affect replayer -- won't load a
    //   new page in a new tab just because we have one.  want to tell replayer
    //   to actually do a load
    ev.forceReplay = true;

    this.cleanTrace = Traces.cleanTrace(trace);
  }

  public static createDummy() {
    return new LoadStatement();
  }

  public run(runObject: RunObject, rbbcontinuation: Function,
      rbboptions: RunOptions) {
    if (this.currentUrl &&
        (this.currentUrl instanceof HelenaString ||
         this.currentUrl instanceof NodeVariableUse ||
         this.currentUrl instanceof Concatenate)) {
      this.currentUrl.run(runObject, rbbcontinuation, rbboptions);
    }
  }

  public cUrl(environment?: Environment.Frame) {
    if (this.currentUrl instanceof NodeVariable) {
      // todo: hmmmm, really should have nodevariableuse, not node variable
      //   here.  test with text relation uploads
      if (!environment) {
        throw new ReferenceError("No environment provided.");
      }
      return this.currentUrl.currentText(environment);
    } else if (this.currentUrl instanceof NodeVariableUse) {
      // todo: hmmmm, really should have nodevariableuse, not node variable
      //   here.  test with text relation uploads
      const val = this.currentUrl.getCurrentVal();
      if (typeof val !== "string") {
        throw new ReferenceError("Current URL value is not a string!");
      }
      return val;
    } else if (this.currentUrl instanceof HelenaString) {
      return this.currentUrl.getCurrentVal();
    } else if (this.currentUrl instanceof Concatenate) {
      this.currentUrl.updateCurrentVal();
      return this.currentUrl.getCurrentVal();
    } else {
      throw new ReferenceError("Invalid currentUrl type in load statement.");
    }
  }

  // deprecated
  private cUrlString() {
    if (this.currentUrl instanceof NodeVariable) {
      return this.currentUrl.toString();
    } else {
      // else it's a string
      return this.currentUrl;
    }
  }

  private getUrlObj() {
    if (typeof this.currentUrl === "string") {
      // sometimes it's a string; this is left over from before, when we used to
      //   store the string internally rather than as a proper block
      // let's go ahead and correct it now
      
      // we'll make a little string node for it
      this.currentUrl = new HelenaString(this.currentUrl);
    }

    if (this.currentUrl instanceof NodeVariable) {
      // hey, we don't want NodeVariable as the item--we want a NodeVariableUse
      const nodevaruse = new NodeVariableUse(this.currentUrl);
      this.currentUrl = nodevaruse;
    }
    
    return this.currentUrl;
  }

  public toStringLines() {
    var cUrl = this.cUrlString();
    const pvStr = this.outputPageVar?
      this.outputPageVar.toString() : "undefined";
    return [ `${pvStr} = load(${cUrl})` ];
  }

  public updateBlocklyBlock(program?: HelenaProgram,
      pageVars?: PageVariable[], relations?: GenericRelation[]) {
    if (!program || !pageVars) {
      return;
    }

    // addToolboxLabel(this.blocklyLabel, "web");
    var pageVarsDropDown = PageVariable.makePageVarsDropdown(pageVars);

    Blockly.Blocks[this.blocklyLabel] = {
      init: function(this: Blockly.Block) {
        this.appendDummyInput()
            .appendField("load")
        this.appendValueInput("url");
        this.appendDummyInput()
            //.appendField(new Blockly.FieldTextInput("URL", handleNewUrl), "url")
            .appendField("into")
            .appendField(new Blockly.FieldDropdown(pageVarsDropDown), "page");
        this.setPreviousStatement(true, null);
        this.setNextStatement(true, null);
        this.setColour(280);
      }
    };
  }

  public genBlocklyNode(prevBlock: Blockly.Block,
      workspace: Blockly.WorkspaceSvg) {
    this.block = workspace.newBlock(this.blocklyLabel);
    const urlObject = this.getUrlObj();
    if (urlObject) {
      HelenaBlocks.attachToInput(this.block,
        urlObject.genBlocklyNode(this.block, workspace), "url");
    }
    const pvStr = this.outputPageVar? this.outputPageVar.toString() : "undefined";
    this.block.setFieldValue(pvStr, "page");
    HelenaBlocks.attachToPrevBlock(this.block, prevBlock);
    window.helenaMainpanel.setHelenaStatement(this.block, this);
    return this.block;
  }

  public getHelena() {
    // ok, but we also want to update our own url object
    const url = this.block.getInput('url').connection.targetBlock();
    if (url) {
      this.currentUrl = <HelenaString | Concatenate | NodeVariableUse>
        window.helenaMainpanel.getHelenaStatement(url).getHelena();
    } else {
      this.currentUrl = null;
    }
    return this;
  }

  public traverse(fn: Function, fn2: Function) {
    fn(this);
    if (this.currentUrl &&
        (this.currentUrl instanceof HelenaString ||
         this.currentUrl instanceof NodeVariableUse ||
         this.currentUrl instanceof Concatenate)) {
      this.currentUrl.traverse(fn, fn2);
    }
    fn2(this);
  }

  public pbvs() {
    const pbvs = [];
    if (this.url !== this.currentUrl) {
      pbvs.push({
        type: "url",
        value: this.url
      });
    }
    return pbvs;
  };

  public parameterizeForRelation(relation: GenericRelation) {
    // ok!  loads can now get changed based on relations!
    // what we want to do is load a different url if we have a relation that
    //   includes the url
    const columns = relation.columns;
    // var firstRowNodeRepresentations = relation.firstRowNodeRepresentations();
    // again, must have columns and firstRowNodeRepresentations aligned.  should be a better way
    // for (var i = 0; i < columns.length; i++) {
    for (const column of columns) {
      const text = column.firstRowText;
      if (text === null || text === undefined) {
        // can't parameterize for a cell that has null text
        continue;
      }

      if (MiscUtilities.urlMatch(text, this.cUrl())) {
        // ok, we want to parameterize
        this.relation = relation;
        const name = column.name;

        if (!name) {
          throw new ReferenceError("Column has no name.");
        }

        const nodevar = window.helenaMainpanel.getNodeVariableByName(name);
        if (!nodevar) {
          throw new ReferenceError("NodeVariable is invalid.");
        }
        const nodevaruse = new NodeVariableUse(nodevar);
        this.currentUrl = nodevaruse; // new NodeVariable(name, firstRowNodeRepresentations[i], null, null, NodeSources.RELATIONEXTRACTOR);
        return [ column ];
      }
    }
    throw new ReferenceError("No matching column found.");
  }

  public hasOutputPageVars() {
    return this.outputPageVars && this.outputPageVars.length > 0;
  }

  /**
   * Returns whether this Helena statement is Ringer based.
   */
  public isRingerBased() {
    return true;
  }

  public unParameterizeForRelation(relation: GenericRelation) {
    if (this.relation === relation) {
      this.relation = null;
      this.currentUrl = this.url;
    }
    return;
  }

  public usesRelation(rel: GenericRelation) {
    if (rel instanceof Relation) {
      return this.usesRelationText(rel.firstRowTexts);
    } else if (rel instanceof TextRelation) {
      return this.usesRelationText(rel.relation[0]);
    }
    return false;
  }

  public usesRelationText(parameterizeableStrings: (string | null)[]) {
    if (!parameterizeableStrings) {
      return false;
    }

    for (const curString of parameterizeableStrings) {
      if (!curString) continue;

      const lowerString = curString.toLowerCase();
      const currURL = this.cUrl();
      if (currURL && MiscUtilities.urlMatch(currURL.toLowerCase(),
          lowerString)) {
        // for loadstatement
        return true;
      }
    }
    return false;
  }

  public args(environment: Environment.Frame) {
    const args = [];
    const currentUrl = this.cUrl(environment);
    args.push({ type:"url", value: currentUrl.trim() });
    return args;
  }

  public postReplayProcessing(runObject: RunObject, trace: Trace,
    temporaryStatementIdentifier: number) {
      return;
  };
}