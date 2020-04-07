import * as Blockly from "blockly";

import { ScrapeStatement } from "../statements/page_action/scrape";

import { Value } from "./value";

import { NodeSources, NodeVariable } from "../../variables/node_variable";

import { MainpanelNode } from "../../../common/mainpanel_node";
import { GenericRelation } from "../../relation/generic";
import { PageVariable } from "../../variables/page_variable";
import { RunObject, HelenaProgram, RunOptions } from "../program";
import { Revival } from "../../revival";

// silly to use strings, I know, but it makes it easier to do the blockly
//   dropdown
export enum AttributeOptions { 
  TEXT = "1",
  LINK = "2"
}

export class NodeVariableUse extends Value {
  public static attributeFieldName = 'attributeFieldName';
  public static varNameFieldName = 'varNameFieldName';

  public attributeOption: AttributeOptions;
  public currentVal: MainpanelNode.Interface | string;
  public nodeVar: NodeVariable;

  constructor(nodeVar: NodeVariable, attributeOption = AttributeOptions.TEXT) {
    super();
    Revival.addRevivalLabel(this);
    this.setBlocklyLabel("variableUse");
    this.nodeVar = nodeVar;
    this.attributeOption = attributeOption;
  }

  public static createDummy() {
    return new NodeVariableUse(new NodeVariable());
  }

  public static fromScrapeStmt(scrapeStmt: ScrapeStatement) {
    let attrOption = AttributeOptions.TEXT;
    if (scrapeStmt.scrapeLink) {
      attrOption = AttributeOptions.LINK;
    }
    return new NodeVariableUse(scrapeStmt.currentNode, attrOption);
  }

  public toStringLines() {
    if (this.nodeVar) {
      const name = this.nodeVar.getName();
      if (name) {
        return [ name ];
      } else {
        return [ "" ];
      }
    } else {
      return [ "" ];
    }
  }

  public updateBlocklyBlock(program?: HelenaProgram,
      pageVars?: PageVariable[], relations?: GenericRelation[]) {
    if (!program) {
      return;
    }
    window.helenaMainpanel.addToolboxLabel(this.blocklyLabel);
    const handleVarChange = function(newVarName: string) {
      if (this.sourceBlock_) {
        console.log("updating node to ", newVarName);
        const nodeVarUse =
          <NodeVariableUse> window.helenaMainpanel.getHelenaStatement(this.sourceBlock_);
        nodeVarUse.nodeVar =
          <NodeVariable> window.helenaMainpanel.getNodeVariableByName(newVarName);
      }
    };
    const handleAttributeChange = function(newAttribute: AttributeOptions) {
      if (this.sourceBlock_) {
        const nodeVarUse =
          <NodeVariableUse> window.helenaMainpanel.getHelenaStatement(this.sourceBlock_);
        nodeVarUse.attributeOption = newAttribute;
      }
    };
    Blockly.Blocks[this.blocklyLabel] = {
      init: function(this: Blockly.Block) {
        if (program) {
          const varNamesDropDown = program.makeVariableNamesDropdown();
          const attributesDropDown = [
            ["TEXT", AttributeOptions.TEXT],
            ["LINK", AttributeOptions.LINK]
          ];
          if (varNamesDropDown.length > 0) {
            this.appendValueInput('NodeVariableUse')
                .appendField(new Blockly.FieldDropdown(varNamesDropDown,
                  handleVarChange), NodeVariableUse.varNameFieldName)
                .appendField(new Blockly.FieldDropdown(attributesDropDown,
                  handleAttributeChange), NodeVariableUse.attributeFieldName);
            
            this.setOutput(true, 'NodeVariableUse');
            //this.setColour(25);
            this.setColour(298);
            // the following is an important pattern
            // this might be a new block, in which case searching for existing
            //   Helena statement for the block with this block's id will be
            //   pointless; but if init is being called because a block is being
            //   restored from the trashcan, then we have to do this check or
            //   we'll overwrite the existing Helena stuff, which would lose
            //   important state (in this case, the information about the node
            //   variable/what node it actually represents)
            const helena = window.helenaMainpanel.getHelenaStatement(this);
            if (!helena) {
              const name = varNamesDropDown[0][0];
              window.helenaMainpanel.setHelenaStatement(this,
                new NodeVariableUse(
                  <NodeVariable> window.helenaMainpanel.getNodeVariableByName(name)
              ));
              const nodeVarUse = <NodeVariableUse> window.helenaMainpanel.getHelenaStatement(this);

              if (!nodeVarUse.nodeVar) {
                throw new ReferenceError("NodeVariableUse has no node var!");
              }
            }
          }
        }
      }
    };
  }

  public genBlocklyNode(prevBlock: Blockly.Block,
      workspace: Blockly.WorkspaceSvg) {
    this.block = workspace.newBlock(this.blocklyLabel);
    // nope!  this one doesn't attach to prev! attachToPrevBlock(this.block, prevBlock);
    window.helenaMainpanel.setHelenaStatement(this.block, this);
    
    let varName = this.nodeVar.getName();
    if (!varName) {
      varName = "Unknown";
    }
    this.block.setFieldValue(varName,
      NodeVariableUse.varNameFieldName);
    this.block.setFieldValue(this.attributeOption,
      NodeVariableUse.attributeFieldName);
    
    return this.block;
  }

  public getHelenaSeq(): NodeVariableUse[] {
    const inputSeq = window.helenaMainpanel.getInputSeq(this.block,
      "NodeVariableUse");
    let fullSeq: NodeVariableUse[] = [this];
    fullSeq = fullSeq.concat(inputSeq);
    return fullSeq;
  }

  public run(runObject: RunObject, rbbcontinuation: Function,
      rbboptions: RunOptions) {
    // just retrieve the val
    this.currentVal = runObject.environment.envLookup(this.nodeVar.getName());
  }

  public getCurrentVal() {
    // remember!  currentval is an object with text, link, source url, xpath,
    //   that stuff so if the val is being used, we have fto pull out just the
    //   text
    if (!this.currentVal) {
      return "";
    } else if (this.nodeVar.nodeSource === NodeSources.PARAMETER) {
      // special case.  just return the val
      return <string> this.currentVal;
    } else if (this.attributeOption === AttributeOptions.TEXT) {
      // ok, it's a normal nodevar, an actual dom node representation
      const text = (<MainpanelNode.Interface> this.currentVal).text;
      return text? text : "undefined";
    } else if (this.attributeOption === AttributeOptions.LINK &&
               this.currentVal.link) {
      return <string> this.currentVal.link;
    }
    return "";
  }

  public getAttribute() {
    if (this.attributeOption === AttributeOptions.TEXT) {
      return 'TEXT';
    } else if (this.attributeOption === AttributeOptions.LINK) {
      return 'LINK'
    } else {
      return '';
    }
  }

  public getCurrentNode(): MainpanelNode.Interface {
    if (this.nodeVar.nodeSource === NodeSources.PARAMETER) {
      // special case. we need a dictionary, but we only have text because we
      //   got this as a param
      return { text: <string> this.currentVal };
    }
    return <MainpanelNode.Interface> this.currentVal;
  }
}