//  cjbaik: doesn't appear to be used
/*
import * as Blockly from "blockly";

import { HelenaMainpanel } from "../../helena_mainpanel";

import { Value } from "./value";

import { String } from "./string";

import { Relation } from "../../relation/relation";

export class BinOpString extends Value {
  public static operators: {
    [key: string]: Function;
  } = {
      'contains': (a: string, b: string) => a.includes(b),
      'is in': (a: string, b: string) => b.includes(a),
      'is': (a: string, b: string) => a === b
  };

  public currentVal: boolean;
  public left: String | null;
  public operator: string | null;
  public right: String | null;

  constructor() {
    super();
    Revival.addRevivalLabel(this);
    HelenaMainpanel.setBlocklyLabel(this, "binopstring");
    this.left = null;
    this.right = null;
    this.operator = null;
  }

  public toStringLines() {
    return ["binopstring"];
  }

  public updateBlocklyBlock(program?: HelenaProgram,
      pageVars?: PageVarPlaceholder[], relations?: Relation[]) {
    const self = this;
    const dropdown = HelenaMainpanel.makeOpsDropdown(BinOpString.operators);
    HelenaMainpanel.addToolboxLabel(this.blocklyLabel, "text");

    const handleOpChange = function(newOp: string) {
      if (this.sourceBlock_ && HelenaMainpanel.getWAL(this.sourceBlock_)) {
        const binOpSt = <BinOpString> HelenaMainpanel.getWAL(this.sourceBlock_);
        binOpSt.operator = newOp;
      }
    };

    Blockly.Blocks[this.blocklyLabel] = {
      init: function() {
        this.appendValueInput("left");
        this.appendDummyInput().appendField(new Blockly.FieldDropdown(dropdown,
          handleOpChange), "op");
        this.appendValueInput("right");
        this.setInputsInline(true);
        this.setOutput(true, 'Bool');
        this.setColour(25);

        const helena = HelenaMainpanel.getWAL(this);
        if (!helena) {
          HelenaMainpanel.setWAL(this, new BinOpString());
          const op = dropdown[0][0];
          const binOpStr = <BinOpString> HelenaMainpanel.getWAL(this);

          // since this is what it'll show by default, better act as though
          //   that's true
          binOpStr.operator = op;
        }
      }
    };
  }

  public genBlocklyNode(prevBlock: Blockly.Block,
      workspace: Blockly.WorkspaceSvg) {
    this.block = workspace.newBlock(this.blocklyLabel);
    HelenaMainpanel.setWAL(this.block, this);

    if (!this.operator) {
      throw new ReferenceError("Operator not set.");
    }

    this.block.setFieldValue(this.operator, "op");
    if (this.left) {
      const leftBlock = this.left.genBlocklyNode(this.block, workspace);
      if (!leftBlock) {
        throw new ReferenceError("Could not create left block.");
      }
      HelenaMainpanel.attachToInput(this.block, leftBlock, "left");
    }
    if (this.right) {
      const rightBlock = this.right.genBlocklyNode(this.block, workspace);
      if (!rightBlock) {
        throw new ReferenceError("Could not create right block.");
      }
      HelenaMainpanel.attachToInput(this.block, rightBlock, "right");
    }
    return this.block;
  }

  public getHelena() {
    // ok, but we also want to update our own condition object
    const leftBlock = this.block.getInput('left').connection.targetBlock();
    const rightBlock = this.block.getInput('right').connection.targetBlock();
    if (leftBlock) {
      this.left = <String> HelenaMainpanel.getWAL(leftBlock).getHelena();
    } else {
      this.left = null;
    }

    if (rightBlock) {
      this.right = <String> HelenaMainpanel.getWAL(rightBlock).getHelena();
    } else {
      this.right = null;
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

  public run(runObject: RunObject, rbbcontinuation: Function,
      rbboptions: RunOptions) {
    if (!this.left || !this.right || !this.operator) {
      throw new ReferenceError("BinOpString improperly initialized.");
    }
    // now run the things on which we depend
    this.left.run(runObject, rbbcontinuation, rbboptions);
    this.right.run(runObject, rbbcontinuation, rbboptions);

    const leftVal = this.left.getCurrentVal();
    const rightVal = this.right.getCurrentVal();
    this.currentVal = BinOpString.operators[this.operator](leftVal, rightVal);
  }
  
  public getCurrentVal() {
    return this.currentVal;
  }

  public parameterizeForRelation(relation: Relation) {
    return [];
  }

  public unParameterizeForRelation(relation: Relation) {
    return;
  }
}*/