import * as Blockly from "blockly";

import { HelenaString } from "./string";
import { Value } from "./value";

import { NodeVariableUse } from "./node_variable_use";
import { GenericRelation } from "../../relation/generic";
import { PageVariable } from "../../variables/page_variable";
import { RunObject, HelenaProgram, RunOptions } from "../program";
import { Revival } from "../../revival";
import { HelenaBlocks } from "../../ui/blocks";

export class Concatenate extends Value {
  public currentVal: string;
  public left?: HelenaString | NodeVariableUse | Concatenate;
  public right?: HelenaString | NodeVariableUse | Concatenate;

  constructor(left?: HelenaString | NodeVariableUse | Concatenate,
              right?: HelenaString | NodeVariableUse | Concatenate) {
    super();

    Revival.addRevivalLabel(this);
    this.setBlocklyLabel("concatenate");
  
    this.left = left;
    this.right = right;
  }

  public static createDummy() {
    return new Concatenate();
  }

  public toStringLines() {
    return ["concatenate"];
  }

  /**
   * @returns true because a Concatenate always involves text
   */
  public hasText() {
    return true;
  }

  public updateBlocklyBlock(program?: HelenaProgram,
      pageVars?: PageVariable[], relations?: GenericRelation[]) {
    window.helenaMainpanel.addToolboxLabel(this.blocklyLabel, "text");
    Blockly.Blocks[this.blocklyLabel] = {
      init: function(this: Blockly.Block) {
        this.appendValueInput("left");
        this.appendDummyInput().appendField("+");
        this.appendValueInput("right");
        this.setInputsInline(true);
        this.setOutput(true, 'Bool');
        this.setColour(25);

        const helena = window.helenaMainpanel.getHelenaStatement(this);
        if (!helena) {
          window.helenaMainpanel.setHelenaStatement(this, new Concatenate());
        }
      }
    };
  };

  public genBlocklyNode(prevBlock: Blockly.Block,
      workspace: Blockly.WorkspaceSvg) {
    this.block = workspace.newBlock(this.blocklyLabel);
    window.helenaMainpanel.setHelenaStatement(this.block, this);

    if (this.left) {
      const leftBlock = this.left.genBlocklyNode(this.block, workspace);
      if (!leftBlock) {
        throw new ReferenceError("Could not create left block.");
      }
      HelenaBlocks.attachToInput(this.block, leftBlock, "left");
    }
    if (this.right) {
      const rightBlock = this.right.genBlocklyNode(this.block, workspace);
      if (!rightBlock) {
        throw new ReferenceError("Could not create right block.");
      }
      HelenaBlocks.attachToInput(this.block, rightBlock, "right");
    }
    return this.block;
  }

  public getHelena() {
    // ok, but we also want to update our own condition object
    const leftBlock = this.block.getInput('left').connection.targetBlock();
    const rightBlock = this.block.getInput('right').connection.targetBlock();
    if (leftBlock) {
      this.left = <HelenaString> window.helenaMainpanel.getHelenaStatement(leftBlock).getHelena();
    } else {
      this.left = undefined;
    }

    if (rightBlock) {
      this.right = <HelenaString> window.helenaMainpanel.getHelenaStatement(rightBlock).getHelena();
    } else {
      this.right = undefined;
    }
    return this;
  }

  public traverse(fn: Function, fn2: Function) {
    fn(this);
    if (this.left) {
      this.left.traverse(fn, fn2);
    }
    if (this.right) {
      this.right.traverse(fn, fn2);
    }
    fn2(this);
  }

  public updateCurrentVal() {
    if (!this.left || !this.right) {
      throw new ReferenceError("Concatenate improperly initialized.");
    }
    const leftVal = this.left.getCurrentVal();
    const rightVal = this.right.getCurrentVal();

    if (typeof leftVal !== "string" || typeof rightVal !== "string") {
      throw new ReferenceError("Concatenate value is not a string!");
    }
    this.currentVal = leftVal + rightVal;
  }

  public run(runObject: RunObject, rbbcontinuation: Function,
      rbboptions: RunOptions) {
    if (!this.left || !this.right) {
      throw new ReferenceError("Concatenate improperly initialized.");
    }
    // now run the things on which we depend
    this.left.run(runObject, rbbcontinuation, rbboptions);
    this.right.run(runObject, rbbcontinuation, rbboptions);

    this.updateCurrentVal();
  }

  public getCurrentVal() {
    return this.currentVal;
  }
}