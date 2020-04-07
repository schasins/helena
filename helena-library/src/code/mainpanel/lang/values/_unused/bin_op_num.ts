// cjbaik: doesn't appear to be used
/*
import { HelenaMainpanel } from "../helena_mainpanel";

export function BinOpNum() {
  Revival.addRevivalLabel(this);
  HelenaMainpanel.setBlocklyLabel(this, "binopnum");
  this.left = null;
  this.right = null;
  this.operator = null;

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
    return ["binopnum"];
  };

  var operators = {
     '>': function(a, b) { return a>b},
     '>=': function(a, b) { return a>=b},
     '==': function(a, b) { return a===b},
     '<': function(a, b) { return a<b},
     '<=': function(a, b) { return a<=b}
  };
  var handleOpChange = function(newOp) {
      if (this.sourceBlock_ && HelenaMainpanel.getWAL(this.sourceBlock_)) {
        HelenaMainpanel.getWAL(this.sourceBlock_).operator = newOp;
      }
  };

  this.updateBlocklyBlock = function _updateBlocklyBlock(program, pageVars, relations) {
    var dropdown = HelenaMainpanel.makeOpsDropdown(operators);
    HelenaMainpanel.addToolboxLabel(this.blocklyLabel, "numbers");
    Blockly.Blocks[this.blocklyLabel] = {
      init: function() {
        this.appendValueInput("left");
        this.appendDummyInput().appendField(new Blockly.FieldDropdown(dropdown, handleOpChange), "op");
        this.appendValueInput("right");
        this.setInputsInline(true);
        this.setOutput(true, 'Bool');
        this.setColour(25);

        var wal = HelenaMainpanel.getWAL(this);
        if (!wal) {
          HelenaMainpanel.setWAL(this, new BinOpNum());
          var op = dropdown[0][0];
          HelenaMainpanel.getWAL(this).operator = op; // since this is what it'll show by default, better act as though that's true
        }
      }
    };
  };

  this.genBlocklyNode = function _genBlocklyNode(prevBlock, workspace) {
    this.block = workspace.newBlock(this.blocklyLabel);
    HelenaMainpanel.setWAL(this.block, this);
    this.block.setFieldValue(this.operator, "op");
    if (this.left) {
      HelenaMainpanel.attachToInput(this.block, this.left.genBlocklyNode(this.block, workspace), "left");
    }
    if (this.right) {
      HelenaMainpanel.attachToInput(this.block, this.right.genBlocklyNode(this.block, workspace), "right");
    }
    return this.block;
  };

  this.getHelena = function _getHelena() {
    // ok, but we also want to update our own condition object
    var leftBlock = this.block.getInput('left').connection.targetBlock();
    var rightBlock = this.block.getInput('right').connection.targetBlock();
    if (leftBlock) {
      this.left = HelenaMainpanel.getWAL(leftBlock).getHelena();
    }
    else{
      this.left = null;
    }
    if (rightBlock) {
      this.right = HelenaMainpanel.getWAL(rightBlock).getHelena();
    }
    else{
      this.right = null;
    }
    return this;
  };

  this.traverse = function _traverse(fn, fn2) {
    fn(this);
    if (this.left) {this.left.traverse(fn, fn2);}
    if (this.right) { this.right.traverse(fn, fn2);}
    fn2(this);
  };

  this.run = function _run(runObject, rbbcontinuation, rbboptions) {
    // now run the things on which we depend
    this.left.run(runObject, rbbcontinuation, rbboptions);
    this.right.run(runObject, rbbcontinuation, rbboptions);

    var leftVal = parseInt(this.left.getCurrentVal()); // todo: make this float not int
    var rightVal = parseInt(this.right.getCurrentVal());
    this.currentVal = operators[this.operator](leftVal, rightVal);
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