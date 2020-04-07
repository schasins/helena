import * as Blockly from "blockly";

import { HelenaConsole } from "../../../../common/utils/helena_console";

import { NodeSources, NodeVariable } from "../../../variables/node_variable";

import { OutputRowStatement } from "../output_row";

import { MainpanelNode } from "../../../../common/mainpanel_node";

import { PageActionStatement, HelenaBlockUIEvent } from "./page_action";
import { GenericRelation } from "../../../relation/generic";
import { PageVariable } from "../../../variables/page_variable";
import { HelenaProgram, RunObject } from "../../program";
import { Revival } from "../../../revival";
import { Trace, Traces } from "../../../../common/utils/trace";
import { Environment } from "../../../environment";
import { HelenaBlocks } from "../../../ui/blocks";

export class ScrapeStatement extends PageActionStatement {
  public static maxDim = 50;
  public static maxHeight = 20;

  public alternativeBlocklyLabel: string;
  public associatedOutputStatements: OutputRowStatement[];
  public currentNodeCurrentValue?: MainpanelNode.Interface;
  public pageUrl?: string;
  public preferredXpath?: string;
  public scrapeLink?: boolean;    // true if scraping link, not just text
  public xpaths: string[];

  constructor(trace?: Trace) {
    super();
    Revival.addRevivalLabel(this);
    this.setBlocklyLabel("scrape");

    this.alternativeBlocklyLabel = "scrape_ringer";
    this.associatedOutputStatements = [];
    this.scrapeLink = false;
    this.xpaths = [];

    // Prematurely end, for the `createDummy` method
    if (!trace) {
      return;
    }

    this.trace = trace;
    this.cleanTrace = Traces.cleanTrace(this.trace);

    // may get 0-length trace if we're just adding a scrape statement by editing
    //   (as for a known column in a relation)
    if (trace.length > 0) {
      // find the record-time constants that we'll turn into parameters
      const ev = Traces.firstVisibleEvent(trace);
      this.pageVar = Traces.getDOMInputPageVar(ev);
      this.node = <string> ev.target.xpath;
      this.pageUrl = <string> ev.frame.topURL;
      // for now, assume the ones we saw at record time are the ones we'll want
      //   at replay
      // this.currentNode = this.node;
      this.origNode = this.node;

      for (const event of trace) {
        if (event.additional && event.additional.scrape) {
          if (event.additional.scrape.linkScraping) {
            this.scrapeLink = true;
            break;
          }
        }
      }

      // actually we want the currentNode to be a nodeVariable so we have a name
      //   for the scraped node
      this.currentNode = NodeVariable.fromTrace(trace);
    }
  }

  public static createDummy() {
    return new ScrapeStatement();
  }

  public remove() {
    this.parent.removeChild(this);
    for (const stmt of this.associatedOutputStatements) {
      stmt.removeAssociatedScrapeStatement(this);
    }
  }

  public prepareToRun() {
    if (this.currentNode instanceof NodeVariable) {
      var feats = this.currentNode.getRequiredFeatures();
      this.requireFeatures(feats);
    }
  }

  public clearRunningState() {
    this.xpaths = [];
    this.preferredXpath = undefined;
  }

  public toStringLines() {
    // todo: could be it's already bound even without being relation extracted,
    //   so should really handle that
    const alreadyBound = this.currentNode instanceof NodeVariable &&
      this.currentNode.getSource() === NodeSources.RELATIONEXTRACTOR;
    if (alreadyBound) {
      return [ `scrape(${this.currentNode.getName()})` ];
    }
    const nodeRep = this.getNodeRepresentation(this.scrapeLink);
    return [ `scrape(${nodeRep}, ${this.currentNode.getName()})` ];
  }

  public updateBlocklyBlock(program?: HelenaProgram,
      pageVars?: PageVariable[], relations?: GenericRelation[]) {
    if (!program || !pageVars) {
      return;
    }
    // addToolboxLabel(this.blocklyLabel, "web");
    const pageVarsDropDown = PageVariable.makePageVarsDropdown(pageVars);
    Blockly.Blocks[this.blocklyLabel] = {
      init: function(this: Blockly.Block) {
        this.appendDummyInput()
            .appendField("scrape")

            // switch to pulldown
            .appendField(new Blockly.FieldTextInput("node"), "node")

            .appendField("in")
            .appendField(new Blockly.FieldDropdown(pageVarsDropDown), "page");
        this.setPreviousStatement(true, null);
        this.setNextStatement(true, null);
        this.setColour(280);
      },
      onchange: function(ev: Blockly.Events.Abstract) {
        const newName = this.getFieldValue("node");
        const scrapeStmt = <ScrapeStatement> window.helenaMainpanel.getHelenaStatement(this);
        const currentName = scrapeStmt.currentNode.getName();
        if (newName !== currentName) {
          // new name so update all our program display stuff
          scrapeStmt.currentNode.setName(newName);

          // update without updating how blockly appears
          window.helenaMainpanel.UIObject.updateDisplayedScript(false);

          // now make sure the relation column gets renamed too
          const colObj = scrapeStmt.currentColumnObj();
          if (colObj) {
            colObj.name = newName;
            window.helenaMainpanel.UIObject.updateDisplayedRelations();
          }
        }

        if (ev instanceof Blockly.Events.Ui) {
          const uiEv = <HelenaBlockUIEvent> ev;
          
          // unselected
          if (uiEv.element === "selected" && uiEv.oldValue === this.id) {
            window.helenaMainpanel.UIObject.updateDisplayedScript(true);
          }
        }
      }
    }

    // now any blockly blocks we'll need but don't want to have in the toolbox
    //   for whatever reason (usually because we can only get the statement from
    //   ringer)
    this.updateAlternativeBlocklyBlock(program, pageVars, relations);
  }

  public updateAlternativeBlocklyBlock(program?: HelenaProgram,
      pageVars?: PageVariable[], relations?: GenericRelation[]) {
    if (!program || !pageVars) {
      return;
    }

    const pageVarsDropDown = PageVariable.makePageVarsDropdown(pageVars);
    const defaultName = "name";
    Blockly.Blocks[this.alternativeBlocklyLabel] = {
      init: function(this: Blockly.Block) {
        this.appendDummyInput()
            .appendField("scrape")
            .appendField(new Blockly.FieldImage("node", ScrapeStatement.maxDim,
              ScrapeStatement.maxHeight, "node image"), "node")
            .appendField("in")
            .appendField(new Blockly.FieldDropdown(pageVarsDropDown), "page")
            .appendField("and call it")
            .appendField(new Blockly.FieldTextInput(defaultName), "name");
        this.setPreviousStatement(true, null);
        this.setNextStatement(true, null);
        this.setColour(280);
      },
      onchange: function(ev: Blockly.Events.Abstract) {
        const newName = this.getFieldValue("name");
        const scrapeStmt = <ScrapeStatement> window.helenaMainpanel.getHelenaStatement(this);
        const currentName = scrapeStmt.currentNode.getName();
        if (newName !== defaultName && (newName !== currentName)) {
          // new name so update all our program display stuff
          scrapeStmt.currentNode.setName(newName);
          // update without updating how blockly appears
          window.helenaMainpanel.UIObject.updateDisplayedScript(false);
        }
        if (ev instanceof Blockly.Events.Ui) {
          const uiEv = <HelenaBlockUIEvent> ev;
          
          // unselected
          if (uiEv.element === "selected" && uiEv.oldValue === this.id) {
            window.helenaMainpanel.UIObject.updateDisplayedScript(true);
          }
        }
      }
    };
  };


  public genBlocklyNode(prevBlock: Blockly.Block,
    workspace: Blockly.WorkspaceSvg) {
    if (this.relation) {
      // scrapes a relation node
      this.block = workspace.newBlock(this.blocklyLabel);
      this.block.setFieldValue(this.getNodeRepresentation(), "node");
    } else {
      // ah, a ringer-scraped node
      this.block = workspace.newBlock(this.alternativeBlocklyLabel);
      this.block.setFieldValue(this.currentNode.getName(), "name");
      this.block.setFieldValue(this.getNodeRepresentation(), "node");
    }
    if (!this.pageVar) {
      throw new ReferenceError("Page variable not set.");
    }
    this.block.setFieldValue(this.pageVar.toString(), "page");
    HelenaBlocks.attachToPrevBlock(this.block, prevBlock);
    window.helenaMainpanel.setHelenaStatement(this.block, this);
    return this.block;
  }

  public scrapingRelationItem() {
    return this.relation !== null && this.relation !== undefined;
  }

  public pbvs() {
    const pbvs = [];
    // no need to make pbvs based on this statement's parameterization if it
    //   doesn't have any events to parameterize anyway...
    if (this.trace.length > 0) {
      if (this.currentTab()) {
        // do we actually know the target tab already?  if yes, go ahead and
        //   parameterize that
        pbvs.push({
          type: "tab",
          value: this.originalTab()
        });
      }
      if (this.scrapingRelationItem()) {
        pbvs.push({
          type: "node",
          value: this.node
        });
      }
      if (this.preferredXpath) {
        // using the usual pbv process happens to be a convenient way to enforce
        //   a preferred xpath, since it sets it to prefer a given xpath and
        //   replaces all uses in the trace of a given xpath with a preferred
        //   xpath but may prefer to extract this non-relation based pbv process
        //   from the normal relation pbv.  we'll see
        // side note: the node pbv above will only appear if it's a use of a
        //   relation cell, and this one will only appear if it's not
        pbvs.push({
          type: "node",
          value: this.node
        });
      }
    }

    return pbvs;
  }

  public parameterizeForRelation(relation: GenericRelation) {
    HelenaConsole.log("scraping cleantrace", this.cleanTrace);

    if (!this.pageVar) {
      throw new ReferenceError("Page var not set.");
    }

    // this sets the currentNode
    const relationColumnUsed = this.parameterizeNodeWithRelation(relation,
      this.pageVar);
    
    return [relationColumnUsed];
  }

  public unParameterizeForRelation(relation: GenericRelation) {
    const columnObject = this.unParameterizeNodeWithRelation(relation);
    // todo: right now we're assuming we only scrape a given column once in a
    //   given script, so if we unparameterize here we assume no where else is
    //   scraping this column, and we reset the column object's scraped value
    //   but there's no reason for this assumption to be true.  it doesn't
    //   matter much, so not fixing it now.  but fix in future
      
    // will be null if we're not actually unparameterizing anything
    if (columnObject) {
      columnObject.scraped = false; // should really do reference counting
    }

    // have to go back to actually running the scraping interactions...
    //   note! right now unparameterizing a scrape statement adds back in all
    //   the removed scraping events, which won't always be necessary
    // should really do it on a relation by relation basis, only remove the ones
    //   related to the current relation
    this.cleanTrace = Traces.cleanTrace(this.trace);
  }

  public args(environment: Environment.Frame) {
    const args = [];
    // no need to make pbvs based on this statement's parameterization if it
    //   doesn't have any events to parameterize anyway...
    if (this.trace.length > 0) {
      if (this.scrapingRelationItem()) {
        args.push({
          type: "node",
          value: this.currentNodeXpath(environment)
        });
      }

      args.push({
        type: "tab",
        value: this.currentTab()
      });

      if (this.preferredXpath) {
        args.push({
          type: "node",
          value: this.preferredXpath
        });
      }
    }
    return args;
  }

  public postReplayProcessing(runObject: RunObject, trace: Trace,
      temporaryStatementIdentifier: number) {
    if (!this.scrapingRelationItem()) {
      // ok, this was a ringer-run scrape statement, so we have to grab the
      //   right node out of the trace

      // it's not just a relation item, so relation extraction hasn't extracted
      //   it, so we have to actually look at the trace
      // find the scrape that corresponds to this scrape statement based on
      //   temporarystatementidentifier
      const stmtTraceSegment = trace.filter(
        (ev) => Traces.getTemporaryStatementIdentifier(ev) ===
          temporaryStatementIdentifier);
      const scrapedContentEvent =
        Traces.firstScrapedContentEventInTrace(stmtTraceSegment);
      if (scrapedContentEvent) {
        // for now, all scrape statements have a NodeVariable as currentNode, so
        //   can call setCurrentNodeRep to bind name in current environment
        let node: MainpanelNode.Interface | null | undefined =
          scrapedContentEvent.additional?.scrape;
        if (!node) {
          node = null
        }
        this.currentNode.setCurrentNodeRep(runObject.environment, node);  
      } else {
        this.currentNode.setCurrentNodeRep(runObject.environment, null);
      }

      // it's not a relation item, so let's start keeping track of the xpaths of
      //   the nodes we actually find, so we can figure out if we want to stop
      //   running full similarity
      // note, we could factor this out and let this apply to other statement
      //   types --- clicks, typing but empirically, have mostly had this issue
      //   slowing down scraping, not clicks and the like, since there are
      //   usually few of those

      // if we haven't yet picked a preferredXpath...
      if (!this.preferredXpath) {
        if (scrapedContentEvent) {
          const firstNodeUse = scrapedContentEvent;
          const xpath = firstNodeUse.target.xpath;
          this.xpaths.push(<string> xpath);
          if (this.xpaths.length === 5) {
            // ok, we have enough data now that we might be able to decide to do
            //   something smarter
            const uniqueXpaths = [...new Set(this.xpaths)];
            if (uniqueXpaths.length === 1) {
              // we've used the exact same one this whole time... let's try
              //   using that as our preferred xpath
              this.preferredXpath = uniqueXpaths[0];
            }
          }
        }
      } else {
        // we've already decided we have a preferred xpath. we should check and
        //   make sure we're still using it.  if we had to revert to using
        //   similarity we should stop trying to use the current preferred
        //   xpath, start tracking again.  maybe the page has been redesigned
        //   and we can discover a new preferred xpath so we'll enter that phase
        //   again

        // only make this call if we actually have an event that aligns...
        if (scrapedContentEvent) {
          const firstNodeUse = scrapedContentEvent; 
          const xpath = firstNodeUse.target.xpath;
          if (xpath !== this.preferredXpath) {
            this.preferredXpath = undefined;
            this.xpaths = [];
          }
        }
      }
    }

    // and now get the answer in a way that works both for relation-scraped and
    //   ringer-scraped, because of using NodeVariable
    this.currentNodeCurrentValue = this.currentNode.currentNodeRep(
      runObject.environment);
    if (!this.currentNodeCurrentValue) {
      // TODO: cjbaik: naively initialized this. is that okay?
      this.currentNodeCurrentValue = { text: "" };
    }

    if (this.scrapeLink) {
      this.currentNodeCurrentValue.scraped_attribute = "LINK";
    } else {
      this.currentNodeCurrentValue.scraped_attribute = "TEXT";
    }
  }

  public addAssociatedOutputStatement(outputStatement: OutputRowStatement) {
    this.associatedOutputStatements.push(outputStatement);
    this.associatedOutputStatements =
      [...new Set(this.associatedOutputStatements)];
  }

  public removeAssociatedOutputStatement(outputStatement: OutputRowStatement) {
    this.associatedOutputStatements = this.associatedOutputStatements.filter(
      (stmt) => stmt !== outputStatement
    );
  }

  public currentRelation() {
    return this.relation;
  }

  public currentColumnObj() {
    return this.columnObj;
  }
}