import * as Blockly from "blockly";
import * as _ from "underscore";

import { HelenaConsole } from "../../../common/utils/helena_console";

import { HelenaLangObject } from "../helena_lang";
import { NodeVariableUse } from "../values/node_variable_use";
import { ScrapeStatement } from "./page_action/scrape";
import { Relation } from "../../relation/relation";
import { TextRelation } from "../../relation/text_relation";
import { GenericRelation } from "../../relation/generic";
import { MainpanelNode } from "../../../common/mainpanel_node";
import { PageVariable } from "../../variables/page_variable";
import { RunObject, HelenaProgram, RunOptions } from "../program";
import { Revival } from "../../revival";
import { Trace } from "../../../common/utils/trace";
import { Environment } from "../../environment";
import { HelenaBlocks } from "../../ui/blocks";

export class OutputRowStatement extends HelenaLangObject {
  public cleanTrace: Trace;
  public relations: GenericRelation[];
  public scrapeStatements: ScrapeStatement[];
  public trace: Trace;
  public nodeUseVariables: NodeVariableUse[];

  constructor(scrapeStatements?: ScrapeStatement[]) {
    super();
    Revival.addRevivalLabel(this);
    this.setBlocklyLabel("output");
    this.trace = []; // no extra work to do in r+r layer for this
    this.cleanTrace = [];
    this.scrapeStatements = [];
    this.nodeUseVariables = [];
    this.relations = [];

    // Prematurely end, for the `createDummy` method
    if (!scrapeStatements) {
      return;
    }
  
    for (const scrapeStmt of scrapeStatements) {
      this.addAssociatedScrapeStatement(scrapeStmt);
      this.nodeUseVariables.push(NodeVariableUse.fromScrapeStmt(scrapeStmt));
    }
  }

  public static createDummy() {
    return new OutputRowStatement();
  }

  public remove() {
    this.parent.removeChild(this);
    for (const scrapeStmt of this.scrapeStatements) {
      scrapeStmt.removeAssociatedOutputStatement(this);
    }
  }

  public addAssociatedScrapeStatement(scrapeStmt: ScrapeStatement) {
    this.scrapeStatements.push(scrapeStmt);
    scrapeStmt.addAssociatedOutputStatement(this);
  }

  public removeAssociatedScrapeStatement(scrapeStmt: ScrapeStatement) {
    this.scrapeStatements = this.scrapeStatements.filter(
      (stmt) => stmt !== scrapeStmt
    );
  }

  public toStringLines() {
    const textRelationRepLs = this.relations.reduce(
      (acc: string[], relation) => acc.concat(relation.scrapedColumnNames()),
    []);
    const nodeRepLs = this.scrapeStatements.map(
      (stmt) => stmt.currentNode.toString(true)
    );
    const allNames = textRelationRepLs.concat(nodeRepLs);
    HelenaConsole.log("outputRowStatement", textRelationRepLs, nodeRepLs);
    return [ `addOutputRow([ ${allNames.join(", ")}])` ];
  };

  public updateBlocklyBlock(program?: HelenaProgram,
      pageVars?: PageVariable[], relations?: Relation[]) {
    window.helenaMainpanel.addToolboxLabel(this.blocklyLabel);
    Blockly.Blocks[this.blocklyLabel] = {
      init: function(this: Blockly.Block) {
        this.appendValueInput('NodeVariableUse')
            .appendField("add dataset row that includes:");
        this.setColour(25);
        this.setPreviousStatement(true, null);
        this.setNextStatement(true, null);
      }
    };
  }

  public genBlocklyNode(prevBlock: Blockly.Block,
      workspace: Blockly.WorkspaceSvg) {
    this.block = workspace.newBlock(this.blocklyLabel);
    HelenaBlocks.attachToPrevBlock(this.block, prevBlock);
    window.helenaMainpanel.setHelenaStatement(this.block, this);
    let priorBlock = this.block;
    for (const vun of this.nodeUseVariables) {
      const block = vun.genBlocklyNode(this.block, workspace);
      HelenaBlocks.attachInputToOutput(priorBlock, block);
      priorBlock = block;
    }
    return this.block;
  }

  public getHelena() {
    // update our list of variable nodes based on the current blockly situation
    const firstInput = this.block.getInput('NodeVariableUse');
    if (firstInput && firstInput.connection.targetBlock()) {
      const helena = window.helenaMainpanel.getHelenaStatement(firstInput.connection.targetBlock());
      if (helena instanceof NodeVariableUse) {
        const inputSeq = helena.getHelenaSeq();
        this.nodeUseVariables = inputSeq;
      } else {
        // right now the only thing we allow to be chained are the node
        //   variables
        // todo: make a proper way of making a list in a blockly block. maybe it
        //   needs to be vertical?
        // in the meantime, you can make an additional output row that uses
        //   exactly one cell
        throw new ReferenceError("Could not find NodeVariableUse");

        // cjbaik: this is what was here before, but the types don't match
        // this.nodeUseVariables = [ firstInput ];
      }
    } else {
      this.nodeUseVariables = [];
    }
    return this;
  }

  public traverse(fn: Function, fn2: Function) {
    fn(this);
    for (const nodeUseVar of this.nodeUseVariables) {
      nodeUseVar.traverse(fn, fn2);
    }
    fn2(this);
  }

  public pbvs() {
    return [];
  }

  public parameterizeForRelation(relation: GenericRelation) {
    if (relation instanceof TextRelation) { // only for text relations!
      // the textrelation's own function for grabbing current texts will handle
      //   keeping track of whether a given col should be scraped
      // note that this currently doesn't handle well cases where multiple
      //   output statements would be trying to grab the contents of a
      //   textrelation...

      // add relation if it's not already in there
      if (!this.relations.includes(relation)) {
        this.relations.push(relation);
      }
      return relation.columns;
    }
    return [];
  };
  
  public unParameterizeForRelation(relation: GenericRelation) {
    this.relations = this.relations.filter((rel) => rel !== relation);
  }

  public args(environment: Environment.Frame) {
    return [];
  }

  public run(runObject: RunObject, rbbcontinuation: Function,
      rbboptions: RunOptions) {
    // we've 'executed' an output statement. better send a new row to our output
    const cells = [];
    const nodeCells = [];

    // let's switch to using the nodeVariableUses that we keep
    for (const nodeUseVar of this.nodeUseVariables) {
      nodeUseVar.run(runObject, rbbcontinuation, rbboptions);
      const v = nodeUseVar.getCurrentVal();
      let n: MainpanelNode.Interface = _.clone(nodeUseVar.getCurrentNode());
      if (!n) {
        // an empty cell for cases where we never found the relevant node, since
        //   must send a node dict to server to store result
        n = {
          text: ""
        };
      }
      n.scraped_attribute = nodeUseVar.getAttribute();
      cells.push(v);
      nodeCells.push(n);
    }

    // for now we're assuming we always want to show the number of iterations of
    //   each loop as the final columns
    const loopIterationCounterTexts = this.getLoopIterationCounters().map(
        (i: number) => i.toString()
    );
    for (const ic of loopIterationCounterTexts) {
      cells.push(ic);
    }
    
    /*
    // todo: why are there undefined things in here!!!!????  get rid of them.
    //   seriously, fix that
    cells = _.filter(cells, function(cell) {return cell !== null && cell !== undefined;});
    */

    runObject.dataset.addRow(nodeCells);
    runObject.program.mostRecentRow = cells;

    const displayTextCells = cells.map((cell) => cell? cell : "EMPTY");

    window.helenaMainpanel.UIObject.addNewRowToOutput(runObject.tab, displayTextCells);
    window.helenaMainpanel.UIObject.updateRowsSoFar(runObject.tab,
      runObject.dataset.fullDatasetLength);

    rbbcontinuation(rbboptions); // and carry on when done
  }
}