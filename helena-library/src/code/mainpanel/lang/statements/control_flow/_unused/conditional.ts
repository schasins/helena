// cjbaik: appears unused
/*import * as Blockly from "blockly";

import { HelenaMainpanel } from "../../../../helena_mainpanel";

import { ControlFlowStatement } from "../control_flow";
import { Value } from "../../../values/value";

export class ConditionalStatement extends ControlFlowStatement {
  public condition: Value | null;

  public genBlocklyNode(prevBlock: Blockly.Block,
      workspace: Blockly.WorkspaceSvg) {
    this.block = workspace.newBlock(this.blocklyLabel);
    HelenaMainpanel.attachToPrevBlock(this.block, prevBlock);

    // handle the condition
    if (this.condition) {
      const cond = this.condition.genBlocklyNode(this.block, workspace);
      if (cond) {
        HelenaMainpanel.attachToInput(this.block, cond, "NodeVariableUse");
      }
    }
    
    // handle the body statements
    const firstNestedBlock = HelenaBlocks.helenaSeqToBlocklySeq(
      this.bodyStatements, workspace);
    HelenaMainpanel.attachNestedBlocksToWrapper(this.block, firstNestedBlock);

    HelenaMainpanel.setWAL(this.block, this);
    return this.block;
  }

  public getHelena() {
    // all well and good to have the things attached after this block, but also need the bodyStatements updated
    const firstNestedBlock = this.block.getInput('statements').connection
      .targetBlock();
    const helenaSequence = window.helenaMainpanel.blocklySeqToHelenaSeq(
      firstNestedBlock);
    this.bodyStatements = helenaSequence;

    // ok, but we also want to update our own condition object
    const conditionBlocklyBlock = this.block.getInput('NodeVariableUse')
      .connection.targetBlock();
    if (conditionBlocklyBlock) {
      const conditionHelena = HelenaMainpanel.getWAL(conditionBlocklyBlock)
        .getHelena();
      this.condition = <Value> conditionHelena;        
    } else {
      this.condition = null;
    }
    return this;
  }

  public traverse(fn: Function, fn2: Function) {
    fn(this);
    if (this.condition) {
      this.condition.traverse(fn, fn2);
    }
    for (const bodyStmt of this.bodyStatements) {
      bodyStmt.traverse(fn, fn2);
    }
    fn2(this);
  }
}*/