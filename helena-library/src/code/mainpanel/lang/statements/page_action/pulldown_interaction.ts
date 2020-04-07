import * as Blockly from "blockly";

import { HelenaConsole } from "../../../../common/utils/helena_console";

import { NodeSources, NodeVariable } from "../../../variables/node_variable";
import { PageActionStatement } from "./page_action";
import { GenericRelation } from "../../../relation/generic";
import { PageVariable } from "../../../variables/page_variable";
import { HelenaProgram } from "../../program";
import { Revival } from "../../../revival";
import { Trace, Traces } from "../../../../common/utils/trace";
import { MiscUtilities } from "../../../../common/misc_utilities";
import { Environment } from "../../../environment";
import { TextRelation } from "../../../relation/text_relation";
import { Relation } from "../../../relation/relation";
import { HelenaBlocks } from "../../../ui/blocks";

function deleteAPropDelta(trace: Trace, propertyName: string) {
  for (const event of trace) {
    if (event.type !== "dom") { continue; }
    const deltas = event.meta.deltas;
    if (deltas) {
      for (let j = 0; j < deltas.length; j++) {
        const delta = deltas[j];
        if (delta.divergingProp === propertyName) {
          deltas.splice(j, 1); // throw out the relevant delta
        }
      }
    }
  }
}

function firstUpdateToProp(trace: Trace, propertyName: string) {
  for (const event of trace) {
    if (event.type !== "dom") { continue; }
    const deltas = event.meta.deltas;
    if (deltas) {
      for (let j = 0; j < deltas.length; j++) {
        const delta = deltas[j];
        if (delta.divergingProp === propertyName && delta.changed) {
          for (const key in delta.changed.prop) {
            if (key === propertyName) {
              // phew, finally found it.  grab it from the changed, not the
              //   original snapshot (want what it changed to)
              return delta.changed.prop[key];
            }
          }
        }
      }
    }
  }
}

export class PulldownInteractionStatement extends PageActionStatement {
  public node: string;
  public origTrace?: Trace;
  public origCleanTrace?: Trace;
  public pageVar: PageVariable;

  constructor(trace?: Trace) {
    super();
    Revival.addRevivalLabel(this);
    this.setBlocklyLabel("pulldownInteraction");

    // Prematurely end, for the `createDummy` method
    if (!trace) {
      return;
    }

    this.trace = trace;
    
    // find the record-time constants that we'll turn into parameters
    this.cleanTrace = Traces.cleanTrace(trace);
    const ev = Traces.firstVisibleEvent(trace);
    this.pageVar = Traces.getDOMInputPageVar(ev);
    this.node = <string> ev.target.xpath;
    this.origNode = this.node;
    // we want the currentNode to be a nodeVariable so we have a name for the
    //   scraped node
    this.currentNode = NodeVariable.fromTrace(trace);
  }
  
  public static createDummy() {
    return new PulldownInteractionStatement();
  }

  public toStringLines() {
    return ["pulldown interaction"];
  }

  public updateBlocklyBlock(program?: HelenaProgram,
      pageVars?: PageVariable[], relations?: GenericRelation[]) {
    if (!program) {
      return;
    }
    // addToolboxLabel(this.blocklyLabel, "web");
    Blockly.Blocks[this.blocklyLabel] = {
      init: function(this: Blockly.Block) {
        this.appendDummyInput()
            .appendField("pulldown interaction");
        this.setPreviousStatement(true, null);
        this.setNextStatement(true, null);
        this.setColour(280);
      }
    };
  }

  public parameterizeNodeWithRelation(genericRelation: GenericRelation,
      pageVar: PageVariable) {
    // note: may be tempting to use the columns' xpath attributes to decide
    //   this, but this is not ok!  now that we can have mutliple suffixes
    //   associated with a column, that xpath is not always correct but we're
    //   in luck because we know the selector has just been applied to the
    //   relevant page (to produce relation.demonstrationTimeRelation and from
    //   that relation.firstRowXpaths) so we can learn from those attributes
    //   which xpaths are relevant right now, and thus which ones the user would
    //   have produced in the current demo
    
    // if the relation is a text relation, we actually don't want to do the
    //   below, because it doesn't represent nodes, only texts
    if (genericRelation instanceof TextRelation) {
      return null;
    }

    let relation = <Relation> genericRelation;

    // hey, this better be in the same order as relation.columns and
    //   relation.firstRowXpaths!
    // todo: maybe add some helper functions to get rid of this necessity? since
    //   it may not be clear in there...
    const nodeRepresentations = relation.firstRowNodeRepresentations();

    for (let i = 0; i < relation.firstRowXPaths.length; i++) {
      const firstRowXpath = relation.firstRowXPaths[i];
      if (firstRowXpath === this.origNode || 
          (this instanceof PulldownInteractionStatement &&
            this.origNode && firstRowXpath.includes(this.origNode))) {
        this.relation = relation;
        const name = relation.columns[i].name;
        const nodeRep = nodeRepresentations[i];

        // not ok to just overwrite currentNode, because there may be multiple
        //   statements using the old currentNode, and becuase we're interested
        //   in keeping naming consistent, they should keep using it so...just
        //   overwrite some things
        if (!this.currentNode) {
          // have to check if there's a current node because if we're dealing
          //   with pulldown menu there won't be
          this.currentNode = new NodeVariable();
        }
        if (name) {
          this.currentNode.setName(name);
        }
        this.currentNode.nodeRep = nodeRep;
        this.currentNode.setSource(NodeSources.RELATIONEXTRACTOR);
        // statement.currentNode = new NodeVariable(name, nodeRep, null, null,
        //   NodeSources.RELATIONEXTRACTOR); // note that this means the
        //   elements in the firstRowXPaths and the elements in columns must be
        //   aligned!
        // ps. in theory the above commented out line should have just worked
        //   because we could search all prior nodes to see if any is the same
        //   but we just extracted the relation from a fresh run of the script,
        //   so any of the attributes we use (xpath, text, or even in some cases
        //   url) could have changed, and we'd try to make a new node, and mess
        //   it up since we know we want to treat this as the same as a prior
        //   one, better to just do this

        // the statement should track whether it's currently parameterized for a
        //   given relation and column obj
        this.relation = relation;
        this.columnObj = relation.columns[i];

        return relation.columns[i]; 
      }
    }
    return null;
  }

  public parameterizeForRelation(relation: GenericRelation) {
    const col = this.parameterizeNodeWithRelation(relation, this.pageVar);

    // if we did actually parameterize, we need to do something kind of weird.
    //   need to replace the trace with something that just sets 'selected' to
    //   true for the target node
    if (col) {
      this.origTrace = this.trace;
      this.origCleanTrace = this.cleanTrace;

      // clone it.  update it.  put the xpath in the right places. put a delta
      //   for 'selected' being true
      const trace = MiscUtilities.dirtyDeepcopy(this.trace);
      for (const event of trace) {
        if (event.meta) {
          event.meta.forceProp = ({ selected: true });
        }
      }
      // don't try to update the value of select node just update the
      //   selectindex
      deleteAPropDelta(trace, "value");
      this.trace = trace;
      this.cleanTrace = Traces.cleanTrace(this.trace);
    }
    return [col];
  }

  public unParameterizeForRelation(relation: GenericRelation) {
    const col = this.unParameterizeNodeWithRelation(relation);
    // if we did find a col, need to undo the thing where we replaced the trace
    //   with the 'selected' update, put the old trace back in
    if (col) {
      if (!this.origTrace || !this.origCleanTrace) {
        throw new ReferenceError("origTrace or origCleanTrace not set.");
      }
      this.trace = this.origTrace;
      this.cleanTrace = this.origCleanTrace;

      this.origTrace = undefined; // just to be clean
      this.origCleanTrace = undefined;
    }
  }

  public pbvs() {
    var pbvs = [];
    if (this.currentTab()) {
      // do we actually know the target tab already?  if yes, go ahead and
      //   paremterize that
      pbvs.push({
        type: "tab",
        value: this.originalTab()
      });
    }

    // we only want to pbv for things that must already have been extracted by
    //   relation extractor
    if (this.currentNode instanceof NodeVariable &&
        this.currentNode.getSource() === NodeSources.RELATIONEXTRACTOR) {
      //pbvs.push({type:"node", value: this.node});
      // crucial to make sure that selectedIndex for the select node gets
      //   updated
      // otherwise things don't change and it doesn't matter if change event is
      //   raised
      // what index was selected in the recording?
      const origVal = firstUpdateToProp(this.trace, "selectedIndex");
      const originalValDict = {
        property: "selectedIndex",
        value: origVal
      };
      pbvs.push({
        type: "property",
        value: originalValDict
      });
    }
    return pbvs;
  }

  public args(environment: Environment.Frame) {
    const args = [];
    args.push({
      type: "tab",
      value: this.currentTab()
    });
    // we only want to pbv for things that must already have been extracted by
    //   relation extractor
    if (this.currentNode instanceof NodeVariable &&
        this.currentNode.getSource() === NodeSources.RELATIONEXTRACTOR) {
      //args.push({type:"node", value: currentNodeXpath(this, environment)});
      // crucial to make sure that selectedIndex for the select node gets
      //   updated. otherwise things don't change and it doesn't matter if
      //   change event is raised

      // extract the correct selectedIndex from the xpath of the current option
      //   node
      const xpath = <string> this.currentNodeXpath(environment);
      HelenaConsole.log("currentNodeXpath", xpath);
      const segments = xpath.split("[")
      let indexStr = segments[segments.length - 1].split("]")[0]; 
      let indexOfNextOption = parseInt(indexStr);
      // our node-to-xpath converter starts counting at 1, but selectedIndex
      //   property starts counting at 0, so subtract one
      indexOfNextOption = indexOfNextOption - 1;
      const valDict = {
        property: "selectedIndex",
        value: indexOfNextOption
      };

      args.push({
        type: "property",
        value: valDict
      });
    }
    return args;
  }

  public genBlocklyNode(prevBlock: Blockly.Block,
    workspace: Blockly.WorkspaceSvg) {
    this.block = workspace.newBlock(this.blocklyLabel);
    HelenaBlocks.attachToPrevBlock(this.block, prevBlock);
    window.helenaMainpanel.setHelenaStatement(this.block, this);
    return this.block;
  }

  public usesRelation(rel: GenericRelation) {
    if (rel instanceof Relation) {
      if (this.pageVar?.name === rel.pageVarName &&
          this.node && rel.firstRowXPaths.includes(this.node)) {
        return true;
      }
      const xpath = this.node;
      for (const cXpath of rel.firstRowXPaths) {
        // so if the xpath of the pulldown menu appears in the xpath of the
        //   first row cell
        if (cXpath.includes(xpath)) {
          return true;
        }
      }
    }
    return false;
  }
}