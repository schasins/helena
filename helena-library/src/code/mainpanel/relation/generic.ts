import { HelenaConsole } from "../../common/utils/helena_console";
import { MainpanelNode } from "../../common/mainpanel_node";
import { NodeVariable } from "../variables/node_variable";
import { PageVariable } from "../variables/page_variable";
import { RunObject } from "../lang/program";
import { Revival } from "../revival";
import { RelationMessage } from "../../common/messages";
import { Environment } from "../environment";
import { IColumnSelector } from "../../content/selector/interfaces";

export class GenericRelation implements Revival.Revivable {
  public ___revivalLabel___: string;
  public name: string;
  public columns: IColumnSelector[];
  public firstRowTexts: string[];
  public nodeVars: NodeVariable[];

  public clearRunningState() {
    return;
  }

  public columnName(colObj: (IColumnSelector | null) []) {
    return colObj.map((colObj) => {
      if (colObj && colObj.name) {
        return colObj.name;
      } else {
        return "undefined";
      }
    });
  }

  public columnNames() {
    return this.columns.map((colObj) => colObj.name? colObj.name : "undefined");
  }

  public demonstrationTimeRelationText(): string[][] {
    return [];
  }

  public firstRowNodeRepresentation(colObj: IColumnSelector) {
    if (!colObj.index) {
      throw new ReferenceError("ColumnSelector has no index.");
    }
    const firstRow = this.firstRowNodeRepresentations();
    return firstRow[colObj.index];
  }

  public firstRowNodeRepresentations(): MainpanelNode.Interface[] {
    return [];
  }

  public getColumnObjectFromXpath(xpath: string) {
    for (const column of this.columns) {
      if (column.xpath === xpath) {
        return column;
      }
    }
    HelenaConsole.log("Ack!  No column object for that xpath: ",
      this.columns, xpath);
    return null;
  }

  public getNextRow(runObject: RunObject, pageVar: PageVariable,
    callback: Function) {
      return;
  }

  public nodeVariables(): NodeVariable[] {
    return [];
  }

  public processColumns() {
    return;
  }

  public scrapedColumnNames() {
    return this.columns.filter((colObj) => colObj.scraped)
                       .map((colObj) => colObj.name? colObj.name : "undefined");
  }

  public setColumnName(columnObj: IColumnSelector, v: string) {
    columnObj.name = v;

    if (!columnObj.index) {
      throw new ReferenceError("Column selector index not provided.");
    }
    
    const nodeVariables = this.nodeVariables();
    nodeVariables[columnObj.index].setName(v);
    window.helenaMainpanel.UIObject.updateDisplayedScript();
  }

  /**
   * Could not name this `toJSON` because JSOG treats objects with `toJSON`
   *   methods in a special way.
   */
  public convertToJSON: () => RelationMessage | string;

  public updateNodeVariables(environment: Environment.Frame,
    pageVar: PageVariable) {
      return;
  }
}