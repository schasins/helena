import * as _ from "underscore";
import * as Blockly from "blockly";

import { HelenaConsole } from "../common/utils/helena_console";

import { NodeVariable, NodeSources } from "./variables/node_variable";

import { HelenaLangObject } from "./lang/helena_lang";

import { LoadStatement } from "./lang/statements/browser/load";
import { LoopStatement } from "./lang/statements/control_flow/loop";
import { WaitStatement } from "./lang/statements/control_flow/wait";
import { TypeStatement } from "./lang/statements/page_action/type";
import { NodeVariableUse } from "./lang/values/node_variable_use";

import { RecorderUI } from "./ui/recorder_ui";
import { PageVariable } from "./variables/page_variable";
import { HelenaProgram, RunObject } from "./lang/program";
import { Revival } from "./revival";
import { Relation } from "./relation/relation";
import { TextRelation } from "./relation/text_relation";
import { Concatenate } from "./lang/values/concatenate";
import { HelenaNumber } from "./lang/values/number";
import { HelenaString } from "./lang/values/string";
import { BackStatement } from "./lang/statements/browser/back";
import { ClosePageStatement } from "./lang/statements/browser/close_page";
import { SkipBlock } from "./lang/statements/control_flow/skip_block";
import { ClickStatement } from "./lang/statements/page_action/click";
import { PulldownInteractionStatement } from "./lang/statements/page_action/pulldown_interaction";
import { ScrapeStatement } from "./lang/statements/page_action/scrape";
import { OutputRowStatement } from "./lang/statements/output_row";
import { Environment } from "./environment";
import { Messages } from "../common/messages";

interface HelenaBlock extends Blockly.Block {
  helena: HelenaLangObject;
}

export class HelenaMainpanel {
  public static revivable: {
    [key: string]: Revival.Prototype
  } = {
    "NodeVariable": NodeVariable,
    "PageVariable": PageVariable,
    "Relation": Relation,
    "TextRelation": TextRelation,
    "HelenaProgram": HelenaProgram,
    "Concatenate": Concatenate,
    "NodeVariableUse": NodeVariableUse,
    "HelenaNumber": HelenaNumber,
    "HelenaString": HelenaString,
    "BackStatement": BackStatement,
    "ClosePageStatement": ClosePageStatement,
    "LoadStatement": LoadStatement,
    "LoopStatement": LoopStatement,
    "SkipBlock": SkipBlock,
    "WaitStatement": WaitStatement,
    "ClickStatement": ClickStatement,
    "PulldownInteractionStatement": PulldownInteractionStatement,
    "ScrapeStatement": ScrapeStatement,
    "TypeStatement": TypeStatement,
    "OutputRowStatement": OutputRowStatement
  };
  
  public allNodeVariablesSeenSoFar: NodeVariable[];
  public blocklyLabels: {
    [key: string]: string[]
  } = { text: [], numbers: [], other: [] };
  public currentReplayWindowId: number | null;
  public currentRunObjects: RunObject[];

  public blocklyNames: string[] = [];
  
  // when Blockly blocks are thrown away (in trash cah), you can undo it, but
  //   undoing it doesn't bring back the walstatement property that we add
  //   so...we'll keep track
  public blocklyToHelenaDict: {
    [key: string]: HelenaLangObject
  } = {};
  public demoMode: boolean;

  public recordingWindowIds: number[];
  public toolId = null;
  public UIObject: RecorderUI;

  constructor(obj: RecorderUI) {
    this.allNodeVariablesSeenSoFar = [];
    this.currentReplayWindowId = null;
    this.currentRunObjects = [];
    this.demoMode = false;
    this.recordingWindowIds = [];

    this.setupBlocklyCustomBlocks();

    this.addMessageListeners();

    this.UIObject = obj;
    Environment.setUIObject(obj);

    // time to apply labels for revival purposes
    for (const prop in HelenaMainpanel.revivable) {
      HelenaConsole.log("making revival label for ", prop);
      Revival.introduceRevivalLabel(prop, HelenaMainpanel.revivable[prop]);
    }
  }

  private addMessageListeners() {
    Messages.listenForMessage("content", "mainpanel",
      "currentReplayWindowId", () => {
        Messages.sendMessage("mainpanel", "content",
          "currentReplayWindowId", { window: this.currentReplayWindowId });
      }
    );
  }

  /**
   * Initialization that has to happen after the HelenaMainpanel object is
   *   created.
   */
  public afterInit() {
    // make one so we'll add the blocklylabel
    new WaitStatement();
  }

  // some of the things we do within the objects that represent the programs,
  //   statements, and expressions should update the UI object that's serving
  //   as the IDE.  the UI object should implement all of these functions, or
  //   whatever subset of them the user will be able to trigger by using the
  //   Helena language as the interface allows:
  /*
    UIObject.updateDisplayedScript(bool updateBlockly)
    UIObject.updateDisplayedRelations(bool stillInProgress)
    UIObject.addNewRowToOutput(str idOfProgramRunTab, array displayTextCells)
    UIObject.updateRowsSoFar(str idOfProgramRunTab, int fullDatasetLength)
    UIObject.addDialog(str title, str dialogText, dict buttonTextToHandlers)
    UIObject.showRelationEditor(Relation rel, int chromeTabId)
    UIObject.continueAfterDialogue(str text, str buttonText, cont continuation)
    Tab tab = UIObject.newRunTab(RunObject ro)
  */

  public resetForNewScript() {
    // if the user is going to be starting a fresh script, it shouldn't be
    //   allowed to use variables from a past script or scripts
    this.allNodeVariablesSeenSoFar = [];
  }

  // it's ok to just run with this unless you want to only load programs
  //   associated with your own helena-using tool
  /*
  public static setHelenaToolId(tid) {
    HelenaMainpanel.toolId = tid;
    console.log("Setting toolId", HelenaMainpanel.toolId);
  }
  public static getHelenaToolId() {
    return HelenaMainpanel.toolId;
  }
  */

  public static makeOpsDropdown(ops: { [key: string]: Function}) {
    const opsDropdown = [];
    for (const key in ops) {
      opsDropdown.push([key, key]);
    }
    return opsDropdown;
  }

  public addToolboxLabel(label: string, category = "other") {
    this.blocklyLabels[category].push(label);
    this.blocklyLabels[category] =
      [...new Set(this.blocklyLabels[category])];
  }

  public blocklySeqToHelenaSeq(blocklyBlock: Blockly.Block):
      HelenaLangObject[] {
    if (!blocklyBlock) {
      return [];
    }
    
    // grab the associated helena component and call the getHelena method
    const thisNodeHelena = this.getHelenaStatement(blocklyBlock).getHelena();
    let invisibleHead = thisNodeHelena.invisibleHead;
    if (!invisibleHead) {invisibleHead = [];}
    let invisibleTail = thisNodeHelena.invisibleTail;
    if (!invisibleTail) {invisibleTail = [];}
    const helenaSeqForThisBlock =
      (invisibleHead.concat(thisNodeHelena)).concat(invisibleTail);

    const nextBlocklyBlock = blocklyBlock.getNextBlock();
    if (!nextBlocklyBlock) {
      return helenaSeqForThisBlock;
    }
    const suffix = this.blocklySeqToHelenaSeq(nextBlocklyBlock);
    return helenaSeqForThisBlock.concat(suffix);
  }

  public static getHelenaFromBlocklyRoot(blocklyBlock: Blockly.Block) {
    return window.helenaMainpanel.blocklySeqToHelenaSeq(blocklyBlock);
  }

  public getInputSeq(blocklyBlock: Blockly.Block, inputName: string) {
    const nextBlock = blocklyBlock.getInput(inputName).connection.targetBlock();
    if (!nextBlock) {
      return [];
    }
    return (<NodeVariableUse> this.getHelenaStatement(nextBlock)).getHelenaSeq();
  }

  public setHelenaStatement(block: Blockly.Block,
      helenaStmt: HelenaLangObject) {
    let helenaBlock = <HelenaBlock> block;
    helenaBlock.helena = helenaStmt;
    helenaStmt.block = helenaBlock;
    this.blocklyToHelenaDict[block.id] = helenaStmt;
  }

  public getHelenaStatement(block: Blockly.Block): HelenaLangObject {
    let helenaBlock = <HelenaBlock> block;
    if (!helenaBlock.helena) {
      helenaBlock.helena = this.blocklyToHelenaDict[helenaBlock.id];
      if (helenaBlock.helena) {
        helenaBlock.helena.block = helenaBlock;
        // the above line may look silly but when blockly drops blocks into the
        //   trashcan, they're restored with the same id but with a fresh object
        //   and the fresh object doesn't have Helena stored anymore, which is
        //   why we have to look in the dict but that also means the block
        //   object stored by the wal object is out of date, must be refreshed
      }
    }
    return helenaBlock.helena;
  }

  public getNodeVariableByName(name: string) {
    for (const nodeVar of this.allNodeVariablesSeenSoFar) {
      if (nodeVar.getName() === name) {
        return nodeVar;
      }
    }
    return null;
  }

  private setupBlocklyCustomBlocks() {
    Blockly.Blocks['scraping_for_each'] = {
      init: function() {
        this.jsonInit({
      "type": "scraping_for_each",
      "message0": "for each COLUMN_NAMES in %1 in %2 %3 do %4",
      "args0": [
        {
          "type": "field_dropdown",
          "name": "list",
          "options": [
            [
              "list1",
              "list1"
            ],
            [
              "list2",
              "list2"
            ],
            [
              "list3",
              "list3"
            ]
          ]
        },
        {
          "type": "field_dropdown",
          "name": "tab",
          "options": [
            [
              "tab1",
              "tab1"
            ],
            [
              "tab2",
              "tab2"
            ],
            [
              "tab3",
              "tab3"
            ]
          ]
        },
        {
          "type": "input_dummy"
        },
        {
          "type": "input_statement",
          "name": "statements"
        }
      ],
      "previousStatement": null,
      "nextStatement": null,
      "colour": 44,
      "tooltip": "",
      "helpUrl": ""
    });
      }
    };
  }
  /**
   * Updates blocks available for the toolbox based on our pageVars, relations,
   *   and so on.
   * @param program 
   */
  public updateToolboxBlocks(program: HelenaProgram | null) {
    // this is silly, but just making a new object for each of our statements is
    //   an easy way to get access to the updateBlocklyBlock function and still
    //   keep it an instance method/right next to the genBlockly function
    // const toolBoxBlocks = ["Number", "NodeVariableUse", "String", "Concatenate",
    //   "IfStatement", "WhileStatement", "ContinueStatement", "BinOpString",
    //   "BinOpNum", "LengthString", "BackStatement", "ClosePageStatement",
    //   "WaitStatement", "WaitUntilUserReadyStatement", "SayStatement"];
    
    const toolBoxBlocks = ["HelenaNumber", "NodeVariableUse", "HelenaString",
      "Concatenate", "BackStatement", "ClosePageStatement", "WaitStatement"];
    
    // let's also add in other nodes which may not have been used in programs
    // so far, but which we want to include in the toolbox no matter what
    const origBlocks = this.blocklyNames;
    const allDesiredBlocks = origBlocks.concat(toolBoxBlocks);
    for (const prop of allDesiredBlocks) {
      try {
        const obj = HelenaMainpanel.revivable[prop].createDummy();

        // if (obj && obj instanceof HelenaLangObject) {
        if (obj && obj instanceof HelenaLangObject) {
          if (program) {
            obj.updateBlocklyBlock(program, program.pageVars,
              program.relations)
          } else {
            obj.updateBlocklyBlock();
          }
        }
      } catch(err) {
        console.log("Couldn't create new object for prop:", prop,
          "probably by design.");
        console.log(err);
      }
    }

    // let's just warn about what things (potentially blocks!) aren't being
    //   included
    for (const prop in HelenaMainpanel.revivable) {
      if (!allDesiredBlocks.includes(prop)) {
        HelenaConsole.log("NOT INCLUDING PROP:", prop);
      }
    }
    return;
  }
}

/*
function makeRelationsDropdown(relations) {
  var relationsDropDown = [];
  for (var i = 0; i < relations.length; i++) {
    var relationStr = relations[i].name;
    relationsDropDown.push([relationStr, relationStr]);
  }
  return relationsDropDown;
}*/