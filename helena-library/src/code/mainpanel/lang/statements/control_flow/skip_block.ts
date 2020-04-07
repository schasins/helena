import * as Blockly from "blockly";
import * as _ from "underscore";

import { HelenaConsole } from "../../../../common/utils/helena_console";

import { HelenaLangObject } from "../../helena_lang";

import { NodeVariable } from "../../../variables/node_variable";

import { SkipBlockResponse, DatasetSliceRequest } from "../../../../common/messages";

import { GenericRelation } from "../../../relation/generic";
import { StatementContainer } from "../container";
import { RunObject, RunOptions } from "../../program";
import { Revival } from "../../../revival";
import { HelenaConfig } from "../../../../common/config/config";
import { HelenaServer } from "../../../utils/server";
import { Environment } from "../../../environment";
import { HelenaBlocks } from "../../../ui/blocks";

enum SkippingStrategies {
  ALWAYS = "always",
  NEVER = "never",
  ONERUNLOGICAL = "onerunlogical",
  SOMETIMESPHYSICAL = "physical",
  SOMETIMESLOGICAL = "logical"
}

enum TimeUnits {
  YEARS = "years",
  MONTHS = "months",
  WEEKS = "weeks",
  DAYS = "days",
  HOURS = "hours",
  MINUTES = "minutes"
}

const multipliersForSeconds: {
  [key: string]: number;
} = {};

multipliersForSeconds[TimeUnits.MINUTES] = 60;
multipliersForSeconds[TimeUnits.HOURS] =
  multipliersForSeconds[TimeUnits.MINUTES] * 60;
multipliersForSeconds[TimeUnits.DAYS] =
  multipliersForSeconds[TimeUnits.HOURS] * 24;
multipliersForSeconds[TimeUnits.WEEKS] =
  multipliersForSeconds[TimeUnits.DAYS] * 7;
multipliersForSeconds[TimeUnits.MONTHS] = 2628000;
multipliersForSeconds[TimeUnits.YEARS] =
  multipliersForSeconds[TimeUnits.DAYS] * 365;

export interface AnnotationItem {
  nodeVar: NodeVariable;
  attr: string;
}

export interface HashBasedParallel {
  on: boolean;
  numThreads: number;
  thisThreadIndex: number;
}

interface TransactionItem {
  attr: string;
  val: string | null;
}

export interface ServerTransaction {
  program_run_id?: number;
  program_id: string;
  transaction_attributes: string;
  annotation_id: number;
  logical_time_diff?: number;
  physical_time_diff_seconds?: number;
  commit_time?: number;
}

export class SkipBlock extends StatementContainer {
  public static counter = 0;
  public static color = 7;

  public annotationItems: AnnotationItem[];
  public availableAnnotationItems: AnnotationItem[];
  public ancestorAnnotations: SkipBlock[];
  public currentTransaction?: TransactionItem[];
  public datasetSpecificId: number;
  public descendIntoLocks?: boolean;
  public duplicatesInARow: number;
  public logicalTime?: number;
  public name: string;
  public physicalTime?: number;
  public physicalTimeUnit?: TimeUnits;
  public requiredAncestorAnnotations: SkipBlock[];
  public skippingStrategy: SkippingStrategies;

  constructor(annotationItems: AnnotationItem[],
      availableAnnotationItems: AnnotationItem[],
      bodyStatements: HelenaLangObject[]) {
    super();
    Revival.addRevivalLabel(this);
    this.setBlocklyLabel("skip_block");
    
    this.annotationItems = annotationItems;
    this.availableAnnotationItems = availableAnnotationItems;
    this.ancestorAnnotations = [];
    
    // we're also allowed to require that prior annotations match, as well as
    //   our own annotationItems
    this.requiredAncestorAnnotations = [];
    
    SkipBlock.counter += 1;
    this.name = `Entity${SkipBlock.counter}`;
    this.datasetSpecificId = SkipBlock.counter;
    this.updateChildStatements(bodyStatements);

    // by default, we'll skip if there's any duplicate in the history
    this.skippingStrategy = SkippingStrategies.ALWAYS;

    // make sure to set this to 0 at the beginning of a loop!
    this.duplicatesInARow = 0;
  }

  public static createDummy() {
    return new SkipBlock([], [], []);
  }

  public clearRunningState() {
    this.currentTransaction = undefined;
    this.duplicatesInARow = 0;
    return;
  }

  public toStringLines() {
    let ancestorString = "";
    for (const ancestor of this.ancestorAnnotations) {
      ancestorString += ", " + ancestor.name;
    }
    const annotationItemsStr = this.annotationItems.map(
      (item) => annotationItemToString(item)).join(", ");
    const prefix =
      `skipBlock(${this.name}(${annotationItemsStr})${ancestorString}) {`;
    const statementStrings = this.bodyStatements
      .reduce((acc: string[], stmt) => acc.concat(stmt.toStringLines()), [])
      .map((line) => `&nbsp;&nbsp;&nbsp;&nbsp; ${line}`);
    return [prefix].concat(statementStrings).concat(["}"]);
  }

  public genBlocklyNode(prevBlock: Blockly.Block,
    workspace: Blockly.WorkspaceSvg) {
    const self = this;

    // cjbaik: this previously referenced `this.id`, but since it doesn't exist
    //   I presume datasetSpecificId is correct?
    const customBlocklyLabel = this.blocklyLabel + this.datasetSpecificId;
  
    const name = this.name;
    const ancestorAnnotations = this.ancestorAnnotations;
    const requiredAncestorAnnotations = this.requiredAncestorAnnotations;
    const availableAnnotationItems = this.availableAnnotationItems;
    const annotationItems = this.annotationItems;
    
    console.log("in genBlocklyNode", this, this.name, ancestorAnnotations,
      requiredAncestorAnnotations);

    Blockly.Blocks[customBlocklyLabel] = {
      init: function(this: Blockly.Block) {
        console.log("in init", ancestorAnnotations,
          requiredAncestorAnnotations);
        let fieldsSoFar = this.appendDummyInput()
            .appendField("entity name: ")
            .appendField(new Blockly.FieldTextInput(name), "name");
        if (availableAnnotationItems.length > 0) {
          fieldsSoFar = this.appendDummyInput().appendField("attributes:");
        }
        for (let i = 0; i < availableAnnotationItems.length; i++) {
          const availItem = availableAnnotationItems[i];
          const onNow = toBlocklyBoolString(annotationItems.includes(availItem));
          let extra = "";
          if (i > 0) {
            extra = ",  ";
          }
          const toggleItemUse = function() {
            var ind = annotationItems.indexOf(availItem);
            if (ind >= 0) {
              annotationItems.splice(ind, 1);
            } else {
              annotationItems.push(availItem);
            }
          };
          fieldsSoFar = fieldsSoFar
            .appendField(extra + annotationItemToString(availItem) + ":")
            .appendField(new Blockly.FieldCheckbox(onNow, toggleItemUse),
              annotationItemToString(availableAnnotationItems[i]));
        }
        if (ancestorAnnotations.length > 0) {
          fieldsSoFar = this.appendDummyInput()
            .appendField("other entitites: ");
        }
        for (const ancestor of ancestorAnnotations) {
          const onNow = toBlocklyBoolString(
            requiredAncestorAnnotations.includes(ancestor));
          fieldsSoFar = fieldsSoFar
            .appendField(ancestor.name + ":")
            .appendField(new Blockly.FieldCheckbox(onNow),
              ancestor.name);
        }

        // ok, time to let the user decide on the skipping strategy

        fieldsSoFar = this.appendDummyInput().appendField(
          "When should we skip an item? ");
        
        const skippingOptions = [
          "Never skip, even if it's a duplicate.", 
          "Skip if we've ever scraped a duplicate.", 
          "Skip if we scraped a duplicate in the same run.", 
          "Skip if we scraped a duplicate in the last", 
          "Skip if we scraped a duplicate in the last"
        ];
        const skippingStrategies = [
          SkippingStrategies.NEVER,
          SkippingStrategies.ALWAYS,
          SkippingStrategies.ONERUNLOGICAL,
          SkippingStrategies.SOMETIMESLOGICAL,
          SkippingStrategies.SOMETIMESPHYSICAL
        ];
        
        const block = this;

        const allSkippingStrategyCheckboxes: SkippingStrategies[] = [];
        const skipStratChange = (skippingStrategy: SkippingStrategies) => {
          console.log(skippingStrategy);
          if (block.getFieldValue(skippingStrategy) ===
            toBlocklyBoolString(false)) {
            // if it's been turned off till now, it's on now, so go ahead and
            //   set the skipping strategy
            console.log("turned on", block.getFieldValue(skippingStrategy));
            self.skippingStrategy = skippingStrategy;
          }
          for (const checkboxName of allSkippingStrategyCheckboxes) {
            if (checkboxName === skippingStrategy) {
              continue;
            }
            block.setFieldValue(toBlocklyBoolString(false),
              checkboxName);
          }
        }
  
        for (let i = 0; i < skippingOptions.length; i++) {
          const skipOption = skippingOptions[i];
          const skipStrat = skippingStrategies[i];

          let onNow = toBlocklyBoolString(self.skippingStrategy === skipStrat);
          allSkippingStrategyCheckboxes.push(skipStrat);

          fieldsSoFar = block.appendDummyInput().appendField(
            new Blockly.FieldCheckbox(onNow, () => skipStratChange(skipStrat)),
              skipStrat);
          fieldsSoFar = fieldsSoFar.appendField(skipOption);
          
          if (skipStrat === SkippingStrategies.SOMETIMESLOGICAL) {
            let curLogicalTime = self.logicalTime;
            if (curLogicalTime === null || curLogicalTime === undefined) {
              curLogicalTime = 1;
            }
            console.log("curLogicalTime", curLogicalTime);
            
            const logicalTimeFieldName = "logicalTime";
            const textInput = new Blockly.FieldTextInput(
              curLogicalTime.toString(), (str: string) => {
                const ret = Blockly.FieldTextInput.numberValidator(str);
                if (ret) {
                  self.logicalTime = parseInt(
                    block.getFieldValue(logicalTimeFieldName));
                }
                return ret;
              }
            );
            fieldsSoFar = fieldsSoFar
              .appendField(textInput, logicalTimeFieldName)
              .appendField(" runs.");
            if (self.logicalTime === null || self.logicalTime === undefined) {
              self.logicalTime = 1;
            }
          }
        
          if (skipStrat === SkippingStrategies.SOMETIMESPHYSICAL) {
            let curPhysicalTime = self.physicalTime;
            if (curPhysicalTime === null || curPhysicalTime === undefined) {
              curPhysicalTime = 1;
            }
            console.log("curPhysicalTime", curPhysicalTime);
      
            const physicalTimeFieldName = "physicalTime";
            const textInput = new Blockly.FieldTextInput(
              curPhysicalTime.toString(), (str: string) => {
                const ret = Blockly.FieldTextInput.numberValidator(str);
                if (ret) {
                  self.physicalTime = parseInt(block.getFieldValue(physicalTimeFieldName));
                }
                return ret;
              }
            )
            fieldsSoFar = fieldsSoFar.appendField(textInput,
              physicalTimeFieldName);

            const options = [];
            options.push([ TimeUnits.YEARS, TimeUnits.YEARS ]);
            options.push([ TimeUnits.MONTHS, TimeUnits.MONTHS ]);
            options.push([ TimeUnits.WEEKS, TimeUnits.WEEKS ]);
            options.push([ TimeUnits.DAYS, TimeUnits.DAYS ]);
            options.push([ TimeUnits.HOURS, TimeUnits.HOURS ]);
            options.push([ TimeUnits.MINUTES, TimeUnits.MINUTES ]);

            // here we actually set the entityScope's time unit, since no
            //   guarantee the user will interact with that pulldown and trigger
            //   the setting, but we have to show something, so want what we
            //   show to match with prog representation
            if (!self.physicalTimeUnit) {
              self.physicalTimeUnit = TimeUnits.YEARS;
            }
            if (self.physicalTime === null || self.physicalTime === undefined) {
              self.physicalTime = 1;
            }
            const timeUnitsFieldName = "timeunits";
            fieldsSoFar = fieldsSoFar
              .appendField(new Blockly.FieldDropdown(options,
                (newVal: TimeUnits) => {
                  self.physicalTimeUnit = newVal;
                  console.log(self.physicalTimeUnit);
              }), timeUnitsFieldName);
            fieldsSoFar = fieldsSoFar.appendField(".");

            // set it to the current time unit
            block.setFieldValue(self.physicalTimeUnit, timeUnitsFieldName);
          }
        }

        this.appendStatementInput("statements") // must be called this
            .setCheck(null)
            .appendField("do");
        
        this.setPreviousStatement(true, null);
        this.setNextStatement(true, null);
        this.setColour(SkipBlock.color);
      },
      onchange: function(this: Blockly.Block, ev: Blockly.Events.Abstract) {
        const newName = this.getFieldValue("name");
        const skipBlock = <SkipBlock> window.helenaMainpanel.getHelenaStatement(this);
        if (newName !== skipBlock.name) {
          skipBlock.name = newName;
        }
      }
    };
    this.block = workspace.newBlock(customBlocklyLabel);
    HelenaBlocks.attachToPrevBlock(this.block, prevBlock);

    // handle the body statements
    const firstNestedBlock = HelenaBlocks.helenaSeqToBlocklySeq(
      this.bodyStatements, workspace);
    HelenaBlocks.attachNestedBlocksToWrapper(this.block, firstNestedBlock);

    window.helenaMainpanel.setHelenaStatement(this.block, this);
    return this.block;
  }

  public getHelena() {
    // all well and good to have the things attached after this block, but also
    //   need the bodyStatements updated
    const firstNestedBlock = this.block.getInput('statements').connection
      .targetBlock();
    const seq = window.helenaMainpanel.blocklySeqToHelenaSeq(firstNestedBlock);
    this.bodyStatements = seq;
    return this;
  }

  public traverse(fn: Function, fn2: Function) {
    fn(this);
    for (const bodyStmt of this.bodyStatements) {
      bodyStmt.traverse(fn, fn2);
    }
    fn2(this);
  }

  public endOfLoopCleanup(continuation: Function) {
    this.currentTransaction = undefined;
    this.duplicatesInARow = 0;
  }

  public run(runObject: RunObject, rbbcontinuation: Function,
      rbboptions: RunOptions) {
    const self = this;
    
    if (rbboptions.ignoreEntityScope ||
        this.skippingStrategy === SkippingStrategies.NEVER) {
      // this is the case where we just want to assume there's no duplicate
      //   because we're pretending the annotation isn't there
      //   or we have the never-skip strategy on
      //   or we're in hashBasedParallel mode and the hash tells us it's not our
      //     work
      runObject.program.runBasicBlock(runObject, self.bodyStatements,
        rbbcontinuation, rbboptions);
      return;
    }

    // if we're not ignoring entityscope, we're in the case where choice depends
    //   on whether there's a saved duplicate on server
    this.currentTransaction = this.singleAnnotationItems(runObject.environment);

    let inParallelMode = rbboptions.parallel;

    // let's check if we're divvying work up based on hashes
    if (rbboptions.hashBasedParallel && rbboptions.hashBasedParallel.on) {
      if (!isThisMyWorkBasedOnHash(this.currentTransaction,
        rbboptions.hashBasedParallel)) {
        // this isn't our responsibility in any case. no need to talk to server.
        //   just skip
        rbbcontinuation(rbboptions);
        return; // very important to return after the skip
      } else {
        // ok, let's just fall back into treating it like normal parallel mode
        inParallelMode = true;
      }
    }

    // this is where we should switch to checking if the current task has been
    //   locked/claimed if we're in parallel mode
    let targetUrl = HelenaConfig.helenaServerUrl + '/transactionexists';
    if (inParallelMode) {
      targetUrl = HelenaConfig.helenaServerUrl + '/locktransaction';
      if (this.descendIntoLocks) {
        // this one's a weird case.  in this case, we're actually re-entering a
        //   skip block already locked by another worker because it has
        //   descendant work that we can help with and because we want good load
        //   balancing
        targetUrl = HelenaConfig.helenaServerUrl + '/takeblockduringdescent';
      }
    }

    // you only need to talk to the server if you're actually going to act
    //   (skip) now on the knowledge of the duplicate
    const msg = this.serverTransactionRepresentationCheck(runObject);

    HelenaServer.checkSkipBlockTransaction(targetUrl, msg,
      (resp: SkipBlockResponse) => {
        if (resp.exists || resp.task_yours === false) {
          // this is a duplicate, current loop iteration already done, so
          //   we're ready to skip to the next so actually nothing should happen
          //   the whole entityscope should be a no-op
          self.duplicatesInARow += 1;
          HelenaConsole.namedLog("duplicates", "new duplicate",
            self.duplicatesInARow);
          if (rbboptions.breakAfterXDuplicatesInARow &&
              self.duplicatesInARow >= rbboptions.breakAfterXDuplicatesInARow) {
            // ok, we're actually in a special case, because not only are we not
            //   doing the body of the entityScope, we're actually breaking out
            //   of this loop
            rbboptions.breakMode = true;
          }
          rbbcontinuation(rbboptions);
        } else {
          self.duplicatesInARow = 0;
          // no duplicate saved, so just carry on as usual
          runObject.program.runBasicBlock(runObject, self.bodyStatements, () => {
            // and when we're done with processing the bodystatements, we'll
            //   want to commit and then once we've committed, we can go ahead
            //   and do the original rbbcontinuation
            self.commit(runObject, rbbcontinuation, rbboptions);
          }, rbboptions);
        }
    });
  };

  private commit(runObject: RunObject, rbbcontinuation: Function,
      rbboptions: RunOptions) {
    // it could be that something has happened that will cause us to skip any
    //  commits that happen in a particular loop iteration (no node that has all
    //  required features, for example)
    if (!rbboptions.skipCommitInThisIteration) {
      const transactionMsg = this.serverTransactionRepresentationCommit(
        runObject, new Date().getTime());
      const datasetSliceMsg = runObject.dataset.datasetSlice();
      const fullMsg: ServerTransaction & DatasetSliceRequest =
        _.extend(transactionMsg, datasetSliceMsg);
      HelenaServer.newSkipBlockTransaction(fullMsg, () => {});
    }
    rbbcontinuation(rbboptions);
  }

  private singleAnnotationItems(environment: Environment.Frame) {
    const rep = [];
    for (const item of this.annotationItems) {
      const nodeVar = item.nodeVar;
      let val = null;
      if (item.attr === "TEXT") {
        val = nodeVar.currentText(environment);
      } else if (item.attr === "LINK") {
        val = <string> nodeVar.currentLink(environment);
      } else { 
        HelenaConsole.warn("yo, we don't know what kind of attr we're " +
          "looking for: ", item.attr);
      }
      rep.push({
        val: val,
        attr: item.attr
      });
    }
    return rep;
  }

  private serverTransactionRepresentation(runObject: RunObject):
      ServerTransaction {
    let rep: TransactionItem[] = [];
    // build up the whole set of attributes that we use to find a duplicate
    //   some from this annotation, but some from any required ancestor
    //   annotations
    for (const ancestor of this.requiredAncestorAnnotations) {
      if (ancestor.currentTransaction) {
        rep = rep.concat(ancestor.currentTransaction);
      }
    }
    if (this.currentTransaction) {
      rep = rep.concat(this.currentTransaction);
    }
    return {
      program_run_id: runObject.dataset.getId(),
      program_id: runObject.program.id,
      transaction_attributes: encodeURIComponent(JSON.stringify(rep)),
      annotation_id: this.datasetSpecificId
    };
  };

  private serverTransactionRepresentationCheck(runObject: RunObject,
      recencyConstraintOptions?: object) {
    const rep = this.serverTransactionRepresentation(runObject);
    var strat = this.skippingStrategy;
    if (strat === SkippingStrategies.ALWAYS) {
      // actually don't need to do anything.  the default looks through the
      //   whole log and skips if there's any duplicate match
    } else if (strat === SkippingStrategies.ONERUNLOGICAL) {
      rep.logical_time_diff = 0; // we're allowed to go back exactly 0 logical runs, must only reason about this logical run.
    } else if (strat === SkippingStrategies.SOMETIMESPHYSICAL) {
      if (!this.physicalTime || !this.physicalTimeUnit) {
        throw new ReferenceError("Physical time or unit not set.");
      }
      rep.physical_time_diff_seconds =
        this.physicalTime * multipliersForSeconds[this.physicalTimeUnit];
    }
    else if (strat === SkippingStrategies.SOMETIMESLOGICAL) {
      rep.logical_time_diff = this.logicalTime; // the run id is already associated, so we only need to know how many back we're allowed to go
    } else {
      HelenaConsole.warn("Woah, there was a skipping strategy that we " +
        "actually don't support: ", strat);
    }
    return rep;
  }

  public serverTransactionRepresentationCommit(runObject: RunObject,
      commitTime: number) {
    const rep = this.serverTransactionRepresentation(runObject);
    rep.commit_time = commitTime;
    return rep;
  };

  public parameterizeForRelation(relation: GenericRelation) {
    return [];
  }

  public unParameterizeForRelation(relation: GenericRelation) {
    return;
  }
}

function annotationItemToString(item: AnnotationItem) {
  return item.nodeVar.toString() + "." + item.attr;
}


function hash(str: string) {
  // from https://github.com/darkskyapp/string-hash
  // The hashing function returns a number between 0 and 4294967295 (inclusive).

  let hash = 5381;
  let i = str.length;

  while (i) {
    hash = (hash * 33) ^ str.charCodeAt(--i);
  }

  /* JavaScript does bitwise operations (like XOR, above) on 32-bit signed
   * integers. Since we want the results to be always positive, convert the
   * signed int to an unsigned by doing an unsigned bitshift. */
  return hash >>> 0;
}

function transactionToHash(currentTransaction: TransactionItem[]) {
  let transactionStr = "";
  for (const item of currentTransaction) {
    transactionStr += "_" + item.attr + "___" + item.val;
  }
  const h = hash(transactionStr);
  HelenaConsole.log(transactionStr, h);
  return h;
}

function isThisMyWorkBasedOnHash(currentTransaction: TransactionItem[],
    hashBasedParallelObject: HashBasedParallel) {
  const numThreads = hashBasedParallelObject.numThreads;
  const thisThreadIndex = hashBasedParallelObject.thisThreadIndex;
  const h = transactionToHash(currentTransaction);
  // The hashing function returns a number between 0 and 4294967295 (inclusive)
  const limitLow = (thisThreadIndex / numThreads) * 4294967295;
  const limitHigh = ((thisThreadIndex + 1) / numThreads) * 4294967295;
  if (h >= limitLow && h <= limitHigh) {
    return true;
  }
  return false;
}

export function toBlocklyBoolString(bool: boolean) {
  return bool? "TRUE": "FALSE";
}


// for testing only!  no reason to actually use this!
/*
var bins = {};
function bin(currentTransaction) {
  var lim = 8;
  for (var i = 0; i < lim; i++) {
    var res = isThisMyWorkBasedOnHash(currentTransaction, {numThreads: lim, thisThreadIndex: i});
    if (res) {
      if (i in bins) {
        bins[i] = bins[i] + 1;
      }
      else{
        bins[i] = 1;
      }
    }
  }
  console.log("bins", bins);
}*/