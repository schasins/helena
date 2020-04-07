// cjbaik: appears unused
/*import * as Blockly from "blockly";

import { HelenaMainpanel } from "../../../../helena_mainpanel";

import { HelenaLangObject } from "../../../helena_lang";

import { ConditionalStatement } from "./conditional";

import { Relation } from "../../../../relation/relation";

export class WhileStatement extends ConditionalStatement {
  constructor(bodyStatements?: HelenaLangObject[]) {
    super();
    
    Revival.addRevivalLabel(this);
    HelenaMainpanel.setBlocklyLabel(this, "while");
    this.condition = null;
  
    // we will sometimes initialize with undefined, as when reviving a saved
    //   program
    if (bodyStatements) {
      this.updateChildStatements(bodyStatements);
    }
  }

  public toStringLines() {
    return ["while"];
  }

  public updateBlocklyBlock(program?: HelenaProgram,
      pageVars?: PageVarPlaceholder[], relations?: Relation[]) {
    HelenaMainpanel.addToolboxLabel(this.blocklyLabel);
    Blockly.Blocks[this.blocklyLabel] = {
      init: function() {
        this.appendValueInput('NodeVariableUse')
            .appendField("repeat while");
        this.setPreviousStatement(true, null);
        this.setNextStatement(true, null);
        this.appendStatementInput("statements") // important for our processing that we always call this statements
            .setCheck(null)
            .appendField("do");
        this.setColour(44);

        var wal = HelenaMainpanel.getWAL(this);
        if (!wal) {
          HelenaMainpanel.setWAL(this, new WhileStatement());
        }
      }
    };
  }

  public run(runObject: RunObject, rbbcontinuation: Function,
      rbboptions: RunOptions) {
    const self = this;
    // first thing first, run everything on which you depend
    this.condition?.run(runObject, rbbcontinuation, rbboptions);
    if (this.condition?.getCurrentVal()) {
      // so basically all that's going to happen here is we'll go ahead and decide to run the bodyStatements of the while
      // statement before we go back to running what comes after the while
      // so....
      // runObject.program.runBasicBlock(runObject, entityScope.bodyStatements, rbbcontinuation, rbboptions);

      // ok, what's the new continuation that will then repeat this while statement run function?
      // (remember, we've got to loop!)
      const newCont = () => {
        self.run(runObject, rbbcontinuation, rbboptions);
      }

      runObject.program.runBasicBlock(runObject, this.bodyStatements, newCont,
        rbboptions);        
    } else {
      // for now we don't have else body statements for our ifs, so we should just carry on with execution
      rbbcontinuation(rbboptions);
    }
  }

  public parameterizeForRelation(relation: Relation) {
    // todo: once we have real conditions may need to do something here
    return [];
  }

  public unParameterizeForRelation(relation: Relation) {
    return;
  }
};*/