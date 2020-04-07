import * as Blockly from "blockly";

import { GenericRelation } from "../relation/generic";

import { PageVariable } from "../variables/page_variable";
import { StatementContainer } from "./statements/container";
import { RunObject, RunOptions, HelenaProgram } from "./program";
import { Revival } from "../revival";
import { IColumnSelector } from "../../content/selector/interfaces";

export interface StatementParameter {
  type: string;
  value: any;
}

export class HelenaLangObject implements Revival.Revivable {
  public ___revivalLabel___: string;

  public block: Blockly.Block;
  public blocklyLabel: string;
  public invisibleHead?: HelenaLangObject[];
  public invisibleTail?: HelenaLangObject[];
  public nullBlockly?: boolean;

  public parent: StatementContainer;

  public static createDummy() {
    return new HelenaLangObject();
  }

  public clearRunningState() {
    return;
  }

  public genBlocklyNode(prevBlock: Blockly.Block | null,
    workspace: Blockly.WorkspaceSvg): Blockly.Block | null {
      return null;
  }

  public getHelena() {
    return this;
  }

  public getLoopIterationCounters(acc: number[] = []): number[] {
    if (this.parent === null || this.parent === undefined) {
      return acc;
    } else {
      return this.parent.getLoopIterationCounters(acc);
    }
  }

  public hasOutputPageVars() {
    return false;
  }

  /**
   * Returns whether this Helena statement is Ringer based.
   */
  public isRingerBased() {
    return false;
  }

  public prepareToRun() {
    return;
  }

  public remove() {
    this.parent.removeChild(this);
  }

  /**
   * Run this Helena statement.
   * @param runObject 
   * @param rbbcontinuation run basic block continuation
   * @param rbboptions run basic block options
   */
  public run(runObject: RunObject, rbbcontinuation: Function,
    rbboptions: RunOptions) {
      return;
  }

  public setBlocklyLabel(label: string) {
    //console.log("setBlocklyLabel", obj, label, obj.___revivalLabel___);
    this.blocklyLabel = label;

    // it's important that we keep track of what things within the
    //   HelenaMainpanel object are blocks and which aren't
    // this may be a convenient way to do it, since it's going to be obvious if
    //   you introduce a new block but forget to call this whereas if you
    //   introduce a new function and forget to add it to a blacklist, it'll get
    //   called randomly, will be hard to debug
    const name = this.___revivalLabel___;
    if (!window.helenaMainpanel.blocklyNames.includes(name)) {
      window.helenaMainpanel.blocklyNames.push(name);
    }
  }

  public toStringLines() {
    return [""];
  }

  public traverse(fn: Function, fn2: Function) {
    fn(this);
    fn2(this);
  }

  public updateBlocklyBlock(program?: HelenaProgram,
      pageVars?: PageVariable[], relations?: GenericRelation[]) {
    return;
  }

  public usesRelation(rel: GenericRelation) {
    return false;
  }

  public parameterizeForRelation(relation: GenericRelation):
      (IColumnSelector | null)[] {
    return [];
  }

  public unParameterizeForRelation(relation: GenericRelation) {
    return;
  }
}