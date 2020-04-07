// cjbaik: doesn't appear to be used
/*
import { HelenaMainpanel } from "../helena_mainpanel";

export function LengthString() {
  Revival.addRevivalLabel(this);
  HelenaMainpanel.setBlocklyLabel(this, "lengthstring");
  this.input = null;

  this.remove = function _remove() {
    this.parent.removeChild(this);
  }

  this.prepareToRun = function _prepareToRun() {
    return;
  };
  this.clearRunningState = function _clearRunningState() {
    return;
  }

  this.toStringLines = function _toStringLines() {
    return ["lengthstring"];
  };

  this.updateBlocklyBlock = function _updateBlocklyBlock(program, pageVars, relations) {
    HelenaMainpanel.addToolboxLabel(this.blocklyLabel, "text");
    Blockly.Blocks[this.blocklyLabel] = {
      init: function() {
        this.appendDummyInput()
            .appendField("length of");
        this.appendValueInput("input");
        this.setInputsInline(true);
        this.setOutput(true, 'Bool');
        this.setColour(25);

        var wal = HelenaMainpanel.getWAL(this);
        if (!wal) {
          HelenaMainpanel.setWAL(this, new LengthString());
        }
      }
    };
  };

  this.genBlocklyNode = function _genBlocklyNode(prevBlock, workspace) {
    this.block = workspace.newBlock(this.blocklyLabel);
    HelenaMainpanel.setWAL(this.block, this);
    if (this.input) {
      HelenaMainpanel.attachToInput(this.block, this.input.genBlocklyNode(this.block, workspace), "input");
    }
    return this.block;
  };

  this.getHelena = function _getHelena() {
    // ok, but we also want to update our own condition object
    var inputBlock = this.block.getInput('input').connection.targetBlock();
    if (inputBlock) {
      this.input = HelenaMainpanel.getWAL(inputBlock).getHelena();
    }
    else{
      this.input = null;
    }
    return this;
  };

  this.traverse = function _traverse(fn, fn2) {
    fn(this);
    if (this.input) {this.input.traverse(fn, fn2);}
    fn2(this);
  };

  this.run = function _run(runObject, rbbcontinuation, rbboptions) {
    // now run the things on which we depend
    this.input.run(runObject, rbbcontinuation, rbboptions);
    var inputVal = this.input.getCurrentVal();
    this.currentVal = inputVal.length;
  };
  this.getCurrentVal = function _getCurrentVal() {
    return this.currentVal;
  };
  this.parameterizeForRelation = function _parameterizeForRelation(relation) {
    return [];
  };
  this.unParameterizeForRelation = function _unParameterizeForRelation(relation) {
    return;
  };
}*/