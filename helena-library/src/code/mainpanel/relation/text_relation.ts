import { HelenaConsole } from "../../common/utils/helena_console";
import { NodeSources, NodeVariable } from "../variables/node_variable";
import { GenericRelation } from "./generic";
import { PageVariable } from "../variables/page_variable";
import { RunObject } from "../lang/program";
import { Revival } from "../revival";
import { Environment } from "../environment";
import { IColumnSelector } from "../../content/selector/interfaces";

// used for relations that only have text in cells, as when user uploads the relation
export class TextRelation extends GenericRelation {
  private currentRowsCounter: number;
  public relation: string[][];

  constructor(csvFileContents?: string, name?: string) {
    super();
    Revival.addRevivalLabel(this);
    
    this.columns = [];

    // we will sometimes initialize with undefined, as when reviving a saved
    //   program
    if (csvFileContents) {
      this.relation = $.csv.toArrays(csvFileContents);
      this.firstRowTexts = this.relation[0];
      if (name) {
        this.name = name;
      }

      this.processColumns();

      // call this so that we make all of the node variables we'll need
      this.nodeVariables();
    }
    this.currentRowsCounter = -1;
  }

  public static createDummy() {
    return new TextRelation();
  }

  public demonstrationTimeRelationText() {
    return this.relation;
  }

  public firstRowNodeRepresentations() {
    return this.relation[0].map((text) => {
      return { text: text };
    });
  }

  public nodeVariables() {
    const firstRowNodeReps = this.firstRowNodeRepresentations();
    if (!this.nodeVars || this.nodeVars.length < 1) {
      this.nodeVars = [];
      for (let i = 0; i < this.columns.length; i++) {
        const column = this.columns[i];
        if (!column.name) {
          throw new ReferenceError("Column has no name.");
        }
        this.nodeVars.push(new NodeVariable(column.name, firstRowNodeReps[i],
          null, null, NodeSources.TEXTRELATION));
      }
    }
    return this.nodeVars;
  }

  public updateNodeVariables(environment: Environment.Frame,
      pageVar: PageVariable) {
    HelenaConsole.log("updateNodeVariables TextRelation");
    var nodeVariables = this.nodeVariables();
    var columns = this.columns; // again, nodeVariables and columns must be aligned
    for (let i = 0; i < columns.length; i++) {
      const column = columns[i];
      if (!column.index) {
        throw new ReferenceError("Column index is undefined.");
      }
      const text = this.relation[this.currentRowsCounter][column.index];
      const currNodeRep = {text: text};
      nodeVariables[i].setCurrentNodeRep(environment, currNodeRep);
    }
  }

  public processColumns() {
    for (let i = 0; i < this.relation[0].length; i++) {
      this.columns.push({
        index: i,
        name: `column_${i}`,
        firstRowText: this.firstRowTexts[i], // todo: don't want filler here
        
        // by default, assume we want to scrape all of a text relation's cols
        //   (or else, why are they even here?)
        scraped: true
      });
    }
  }

  public toJSON: () => string = () => {
    const stringifiedTextRelation = JSON.stringify(this.relation);
    return stringifiedTextRelation;
  }

  // has to be called on a page, to match the signature for the non-text
  //   relations, but we'll ignore the pagevar
  public getNextRow(runObject: RunObject, pageVar: PageVariable,
      callback: Function) {
    if (this.currentRowsCounter + 1 >= this.relation.length) {
      callback(false); // no more rows -- let the callback know we're done
    } else {
      this.currentRowsCounter += 1;
      callback(true);
    }
  }

  public getCurrentCellsText() {
    const cells = [];
    for (let i = 0; i < this.columns.length; i++) {
      if (this.columns[i].scraped) {
        const cellText = this.getCurrentText(this.columns[i]);
        cells.push(cellText);
      }
    }
    return cells;
  }

  public getCurrentText(columnObject: IColumnSelector) {
    if (!columnObject.index) {
      throw new ReferenceError("Column object contains no index.");
    }

    HelenaConsole.log(this.currentRowsCounter, "currentRowsCounter");
    return this.relation[this.currentRowsCounter][columnObject.index];
  };

  public getCurrentLink(pageVar: PageVariable,
    columnObject: IColumnSelector) {
    HelenaConsole.log("yo, why are you trying to get a link from a text " +
      "relation???");
    return "";
  }

  public clearRunningState() {
    this.currentRowsCounter = -1;
  }

  public setRelationContents(relationContents: string[][]) {
    this.relation = relationContents;
  }

  public getRelationContents() {
    return this.relation;
  }
}