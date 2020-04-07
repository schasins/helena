// cjbaik: appears unused
/*import { HelenaMainpanel } from "../helena_mainpanel";

export function WaitUntilUserReadyStatement() {
  Revival.addRevivalLabel(this);
  HelenaMainpanel.setBlocklyLabel(this, "waitUntilUserReady");

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
    return ["wait until user ready"];
  };

  this.updateBlocklyBlock = function _updateBlocklyBlock(program, pageVars, relations) {
    HelenaMainpanel.addToolboxLabel(this.blocklyLabel);
    Blockly.Blocks[this.blocklyLabel] = {
      init: function() {
        this.appendDummyInput()
            .appendField("wait until user presses 'ready' button");
        this.setPreviousStatement(true, null);
        this.setNextStatement(true, null);
        this.setColour(25);
        var wal = HelenaMainpanel.getWAL(this);
        if (!wal) {
          HelenaMainpanel.setWAL(this, new WaitUntilUserReadyStatement());
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
    // throw up a dialog message that asks the user to tell us when they're ready
    // once they're ready, call the rbbcontinuation on rbboptions
    var dialogText = "This program had a 'wait until user is ready' statement, so go ahead and press the button below when you're ready.";
    window.helenaMainpanel.UIObject.addDialog("Ready when you are!", dialogText, 
      {"Go Ahead": function _goAhead() {WALconsole.log("Go Ahead."); rbbcontinuation(rbboptions);}}
    );
  };

  this.parameterizeForRelation = function _parameterizeForRelation(relation) {
    return [];
  };
  this.unParameterizeForRelation = function _unParameterizeForRelation(relation) {
    return;
  };
};*/