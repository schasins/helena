import { RelationSelector, ContentSelector } from "../selector/relation_selector";

import { HelenaConsole } from "../../common/utils/helena_console";
import { Messages } from "../../common/messages";
import { Highlight } from "./highlight";
import { KnownRelationResponse, ServerRelationMessage } from "../../mainpanel/utils/server";

export interface KnownRelation {
  selectorObj: RelationSelector;
  nodes: (HTMLElement | null)[];
  relationOutput: (HTMLElement | null)[][];
  highlighted: boolean;
  highlightNodesTime?: number;
  highlightNodes?: JQuery<HTMLElement>[];
}

/**
 * Highlight relations that can be found on the page on hover.
 */
export class RelationHighlighter {
  public currentlyHighlighted: JQuery<HTMLElement>[] = [];
  public highlightColors: string[];
  public knownRelations: KnownRelation[];

  constructor () {
    this.currentlyHighlighted = [];
    this.knownRelations = [];
    this.highlightColors = ["#9EE4FF","#9EB3FF", "#BA9EFF", "#9EFFEA",
      "#E4FF9E", "#FFBA9E", "#FF8E61"];
  }

  public clearCurrentlyHighlighted() {
    for (const node of this.currentlyHighlighted) {
      Highlight.clearHighlight(node);
    }
    this.currentlyHighlighted = [];
  }

  /**
   * Retrieve known relations from the server.
   */
  public getKnownRelations() {
    const self = this;
    // TODO: cjbaik: switch this to a port rather than a one time msg

    // have to ask background to make the extension make a POST
    // request because modern Chrome won't let us request http content from
    // https pages and we don't currently have ssl certificate for kaofang
    Messages.sendMessage("content", "background", "getKnownRelations",
      { url: window.location.href });
    Messages.listenForMessageOnce("background", "content", "getKnownRelations",
      (resp: KnownRelationResponse) => {
        HelenaConsole.log(resp);
        self.preprocessKnownRelations(resp.relations);
      }
    );
  }

  /**
   * Massage and reformat server response about known relations.
   * @param resp server response
   */
  private preprocessKnownRelations(resp: ServerRelationMessage[]) {
    for (let i = 0; i < resp.length; i++) {
      let selector = RelationSelector.fromJSON(resp[i]);
      // first let's apply each of our possible relations to see which nodes
      //   appear in them
      try {
        // let selector = RelationSelector.fromMessage(selectorMsg);
        let relationOutput = selector.getMatchingRelation();
        let nodes = relationOutput.reduce((memo, row) => memo.concat(row),
          []);

        // then let's make a set of highlight nodes for each relation, so we
        //   can toggle them between hidden and displayed based on user's
        //   hover behavior
        this.knownRelations.push(
          {
            selectorObj: selector,
            nodes: nodes,
            relationOutput: relationOutput,
            highlighted: false
          }
        );
      } catch (err) {
        console.error(err);
        // console.warn(`Known relation ${JSON.stringify(resp[i])} failed.`);
        continue;
      }
    }  
  }

  /**
   * Given an element, find most relevant relation and highlight.
   * @param element element to highlight
   */
  public highlightRelevantRelation(element: HTMLElement) {
    // for now we'll just pick whichever node includes the current node and has
    //   the largest number of nodes on the current page
    let winningRelation = null;
    let winningRelationSize = 0;
    for (const relationInfo of this.knownRelations) {
      if (relationInfo.nodes.includes(element)) {
        if (relationInfo.nodes.length > winningRelationSize) {
          winningRelation = relationInfo;
          winningRelationSize = relationInfo.nodes.length;
        }
      }
    }
    if (winningRelation) {
      // cool, we have a relation to highlight
      winningRelation.highlighted = true;
      
      // important to make the highlight nodes now, since the nodes might be
      // shifting around throughout interaction, especially if things still
      // loading
      let currTime = new Date().getTime();
      let highlightNodes: JQuery<HTMLElement>[] | undefined = undefined;

      if (winningRelation.highlightNodes &&
        winningRelation.highlightNodesTime &&
        ((currTime - winningRelation.highlightNodesTime) < 2000)) {
        // cache the highlight nodes for up to two second, then go ahead and
        //   recompute those positions
        highlightNodes = winningRelation.highlightNodes;
      } else {
        highlightNodes = this.highlightRelation(
          winningRelation.relationOutput, false, false);
      }
      winningRelation.highlightNodes = highlightNodes;
      winningRelation.highlightNodesTime = new Date().getTime();

      for (let i = 0; i < highlightNodes.length; i++) {
        highlightNodes[i].css("display", "block");
      }
    }
  }

  /**
   * Highlight the relation.
   * @param relation elements in relation
   * @param display whether to show highlight nodes or not
   * @param pointerEvents whether to enable or disable CSS pointer-events on
   *   highlight nodes
   * @returns highlighted nodes
   */
  public highlightRelation(relation: (HTMLElement | null)[][], display: boolean,
    pointerEvents: boolean) {
    let nodes = [];
    for (const row of relation) {
      for (let cellIndex = 0; cellIndex < row.length; cellIndex++) {
        let cell = row[cellIndex];
        if (cell === null){ continue; }
        // first make sure there is a color at index j, add one if there isn't
        if (cellIndex >= this.highlightColors.length) {
          this.highlightColors.push(
            "#000000".replace(/0/g,function () {
              return (~~(Math.random()*16)).toString(16);
            }));
        }
        let node = Highlight.highlightNode(cell,
          this.highlightColors[cellIndex], display, pointerEvents);
        if (node) {
          nodes.push(node);
        }
      }
    }
    this.currentlyHighlighted = nodes;
    return nodes;
  }

  /**
   * Unhighlight the relation.
   */
  public unhighlight() {
    for (let i = 0; i < this.knownRelations.length; i++) {
      let relationInfo = this.knownRelations[i];
      if (relationInfo.highlightNodes) {
        for (let j = 0; j < relationInfo.highlightNodes.length; j++) {
          relationInfo.highlightNodes[j].css("display", "none");
        }
      }
    }
  };
}