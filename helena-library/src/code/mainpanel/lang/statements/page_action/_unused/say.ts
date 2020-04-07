// cjbaik: appears unused?
/*
import { HelenaMainpanel } from "../helena_mainpanel";

function say(thingToSay) {
  var msg = new SpeechSynthesisUtterance(thingToSay);
  msg.voice = speechSynthesis.getVoices().filter(function(voice) { return voice.name == 'Google US English'; })[0];
  window.speechSynthesis.speak(msg);
}

export function SayStatement() {
  Revival.addRevivalLabel(this);
  HelenaMainpanel.setBlocklyLabel(this, "say");
  this.textToSay = null;

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
    return ["say " + this.textToSay];
  };

  this.updateBlocklyBlock = function _updateBlocklyBlock(program, pageVars, relations) {
    HelenaMainpanel.addToolboxLabel(this.blocklyLabel);
    var handleTextToSayChange = function(newText) {
      if (this.sourceBlock_) {
        HelenaMainpanel.getWAL(this.sourceBlock_).textToSay = newText;
      }
    };
    Blockly.Blocks[this.blocklyLabel] = {
      init: function() {
        this.appendDummyInput()
            .appendField("say");
        this.appendValueInput("textToSay");
        this.setInputsInline(true);
        this.setPreviousStatement(true, null);
        this.setNextStatement(true, null);
        this.setColour(25);
        var wal = HelenaMainpanel.getWAL(this);
        if (!wal) {
          HelenaMainpanel.setWAL(this, new SayStatement());
        }
      }
    };
  };

  this.genBlocklyNode = function _genBlocklyNode(prevBlock, workspace) {
    this.block = workspace.newBlock(this.blocklyLabel);
    HelenaMainpanel.attachToPrevBlock(this.block, prevBlock);
    HelenaMainpanel.setWAL(this.block, this);

    if (this.textToSay) {
      HelenaMainpanel.attachToInput(this.block, this.textToSay.genBlocklyNode(this.block, workspace), "textToSay");
    }

    return this.block;
  };

  this.getHelena = function _getHelena() {
    var textToSayBlock = this.block.getInput('textToSay').connection.targetBlock();
    if (textToSayBlock) {
      this.textToSay = HelenaMainpanel.getWAL(textToSayBlock).getHelena();
    }
    else{
      this.textToSay = null;
    }
    return this;
  };

  this.traverse = function _traverse(fn, fn2) {
    fn(this);

    if (this.textToSay) {
      this.textToSay.traverse(fn, fn2);
    }

    fn2(this);
  };

  this.run = function _run(runObject, rbbcontinuation, rbboptions) {
    // say the thing, then call rbbcontinuation on rbboptions
    if (this.textToSay) {
      this.textToSay.run(runObject, rbbcontinuation, rbboptions);
      console.log("saying", this.textToSay);
      say(this.textToSay.getCurrentVal());
    }
    rbbcontinuation(rbboptions);
  };

  this.parameterizeForRelation = function _parameterizeForRelation(relation) {
    return [];
  };
  this.unParameterizeForRelation = function _unParameterizeForRelation(relation) {
    return;
  };
};*/