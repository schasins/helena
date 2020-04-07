// cjbaik: appears unused
/*import { HelenaMainpanel } from "../helena_mainpanel";

export function ContinueStatement() {
  Revival.addRevivalLabel(this);
  HelenaMainpanel.setBlocklyLabel(this, "continue");

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
    return ["continue"];
  };

  this.updateBlocklyBlock = function _updateBlocklyBlock(program, pageVars, relations) {
    HelenaMainpanel.addToolboxLabel(this.blocklyLabel);
    Blockly.Blocks[this.blocklyLabel] = {
      init: function() {
        this.appendDummyInput()
            .appendField("skip");
        this.setPreviousStatement(true, null);
        this.setNextStatement(true, null);
        this.setColour(25);
        var wal = HelenaMainpanel.getWAL(this);
        if (!wal) {
          HelenaMainpanel.setWAL(this, new ContinueStatement());
        }
      }
    };
  };

  this.genBlocklyNode = function _genBlocklyNode(prevBlock, workspace) {
    this.block = workspace.newBlock(this.blocklyLabel);
    HelenaMainpanel.attachToPrevBlock(this.block, prevBlock);
    HelenaMainpanel.setWAL(this.block, this);
    return this.block;
  };

  this.getHelena = function _getHelena() {
    return this;
  };

  this.traverse = function _traverse(fn, fn2) {
    fn(this);
    fn2(this);
  };

  this.run = function _run(runObject, rbbcontinuation, rbboptions) {
    // fun stuff!  time to flip on the 'continue' flag in our continuations, which the for loop continuation will eventually consume and turn off
    rbboptions.skipMode = true;
    rbbcontinuation(rbboptions);
  };

  this.parameterizeForRelation = function _parameterizeForRelation(relation) {
    return [];
  };
  this.unParameterizeForRelation = function _unParameterizeForRelation(relation) {
    return;
  };
};*/