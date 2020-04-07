import * as _ from "underscore";

import { Indexable, Utilities } from "../common/utils";
import { DOMUtils } from "./dom_utils";
import { RingerParams } from "../common/params";

/**
 * Records effects of events (i.e. changes to a node).
 */
export interface Delta {
  changed?: NodeSnapshot;
  divergingProp?: string;
  orig?: NodeSnapshot;
  type: string;
}

export interface PropertyDifferentDelta extends Delta {
  changed: ElementSnapshot;
  orig: ElementSnapshot;
  divergingProp: string;
}

export interface NodeAddedDelta extends Delta {
  changed: NodeSnapshot;
  divergingProp: undefined;
  orig: undefined;
}

export interface NodeMissingDelta extends Delta {
  changed: undefined;
  divergingProp: undefined;
  orig: NodeSnapshot;
}

export interface MiscDelta extends Delta {
  changed: NodeSnapshot;
  divergingProp: undefined;
  orig: NodeSnapshot;
}

/**
 * An instance of a DOM node snapshot.
 */
export interface NodeSnapshot {
  children?: NodeSnapshot[];
  prop?: Indexable;
  text?: string;
  type: string;
}

export interface ElementSnapshot extends NodeSnapshot {
  children: NodeSnapshot[];
  prop: Indexable;
}

export interface TextNodeSnapshot extends NodeSnapshot {
  text: string;
}

/**
 * Dealing with DOM node snapshots by saving their properties and children.
 * These can be very expensive operations, so use sparingly.
 */
export namespace Snapshot {
  // Don't snapshot certain DOM nodes
  let ignoreTags = { 'script': true, 'style': true };

  /**
   * Check if {@link delta1} changes all the props that {@link delta2} changes
   *   or both leave property unchanged. Only checks for property differences.
   * @param delta1
   * @param delta2
   */
  function deltaEqual(delta1: Delta, delta2: Delta) {
    const type = 'Property is different.';
    if (delta1.type !== type || delta2.type !== type) {
      this.log.error('deltaEqual called on unknown delta type.', delta1,
        delta2);
      return false;
    }
  
    const prop1 = delta1.divergingProp;
    const prop2 = delta2.divergingProp;
  
    return prop1 && prop2 && prop1 === prop2 &&
           delta1.changed && delta2.changed &&
           delta1.changed.prop && delta2.changed.prop &&
           delta1.changed.prop[prop1] === delta2.changed.prop[prop2];
  }

  /**
   * Find properties for which two objects have different values.
   * @param obj1
   * @param obj2
   */
  function divergingProps(obj1: Indexable, obj2: Indexable) {
    if (!(obj1 && obj2)) {
      throw new ReferenceError('divergingProps called with bad arguements');
    }
    obj1 = _.omit(obj1, RingerParams.params.compensation.omittedProps);
    obj2 = _.omit(obj2, RingerParams.params.compensation.omittedProps);
  
    const divergingProps = [];
    for (const prop in obj1) {
      if (obj1[prop] != obj2[prop]) {
        divergingProps.push(prop);
      }
    }
    return divergingProps;
  }

  /**
   * Return the list of deltas, taking out any deltas that appear in 
   *   {@link deltasToRemove}.
   *
   * @param delta
   * @param deltasToRemove
   *
   * @returns Deltas contained in {@link delta} but not {@link deltasToRemove}
   */
  export function filterDeltas(deltas: Delta[], deltasToRemove: Delta[]) {
    const finalDeltas = [];
  
    // for (var i = 0, ii = deltas.length; i < ii; ++i) {
    for (const delta of deltas) {
      // var delta = deltas[i];
      let matched = false;
      // for (var j = 0, jj = deltasToRemove.length; j < jj; ++j) {
      for (const deltaToRemove of deltasToRemove) {
        // var deltaToRemove = deltasToRemove[j];
        /* check if every property changed by delta is also changed in the same
         * way by deltaToRemove */
        if (deltaEqual(delta, deltaToRemove)) {
          matched = true;
          continue;
        }
      }
  
      if (!matched) {
        finalDeltas.push(delta);
      }
    }
    return finalDeltas;
  }

  /**
   * Calculates differences between two node snapshots.
   *
   * @param orig A snapshot of the original node
   * @param changed A snapshot of the node after possible changes
   *
   * @returns a list of deltas, each delta indicating a property change
   */
  export function getDeltas(orig: NodeSnapshot | undefined,
      changed: NodeSnapshot | undefined): Delta[] {
    if (!orig && !changed) {
      throw new ReferenceError("both nodes doesn't actually exist");
    }
  
    /* check if both nodes are DOM nodes and not just text nodes */
    if (orig && changed &&
        orig.type === 'DOM' && changed.type === 'DOM') {
      const deltas = [];
  
      /* we've tried to match a node that turns out not to be the same
       * we want to mark that this is a divergence, but there may be  more
       * relevant deltas among its children, so let's just add this divergence
       * and continue descending */
      if (!nodeEquals(orig, changed)) {
        let props1 = orig.prop || [];
        let props2 = changed.prop || [];
        const omittedProps = RingerParams.params.compensation.omittedProps;
  
        props1 = _.omit(props1, omittedProps);
        props2 = _.omit(props2, omittedProps);
  
        const diffProps = divergingProps(props1, props2);
        for (const diffProp of diffProps) {
          deltas.push({
            type: 'Property is different.',
            orig: orig,
            changed: changed,
            divergingProp: diffProp
          });
        }
      }
      return deltas;
    } else {
      /* at least one node isn't a DOM node */
      if (!orig) {
        return [{
          type: 'New node in changed DOM.',
          orig: orig,
          changed: changed
        }];
      } else if (!changed) {
        return [{
          type: 'Node missing in changed DOM.',
          orig: orig,
          changed: changed
        }];
      } else if (orig.type === 'DOM' || changed.type === 'DOM') {
        return [{
          type: 'Node types differ.',
          orig: orig,
          changed: changed
        }];
      } else if (orig.type === 'text' && orig.type === 'text') {
        /* Both nodes should be text nodes */
        if (nodeEquals(orig, changed)) {
          return [];
        }
        /* sad, we descended all the way and the nodes aren't the same */
        return [{
          'type': 'Nodes not the same.',
          'orig': orig,
          'changed': changed
        }];
      } else {
        throw new ReferenceError("Unable to create deltas.");
      }
    }
  }

  /**
   * Creates a snapshot of node properties. Only string, number, and boolean
   * properties are copied.
   *
   * @param node The DOM node whose values should be copied.
   * @param props An array of properties which should be copied. Alternatively
   *     'all' can be specified which will copy all properties of the node.
   *
   * @returns mapping from property name to value.
   */
  function getProperties(node: Node & Indexable, props: 'all' | string[]) {
    if (props === 'all') {
      props = [];
      for (const prop in node) {
        props.push(prop);
      }
    } else if (!props) {
      props = [];
    }

    const mapping: Indexable = {};
    for (const prop of props) {
      try {
        const firstChar = prop.charCodeAt(0);
        if (firstChar >= 65 && firstChar <= 90) {
          continue;
        }
        const val = node[prop];
        const type = typeof val;
        if (type == 'string' || type == 'number' || type == 'boolean') {
          mapping[prop] = val;
        }
      } catch (e) {
        // do nothing
      }
    }
    // let's add one special one that's useful for some purposes
    mapping.source_url = window.location.href;

    // for some pages, the strings for various text-y things get crazy long
    // we're going to play around with truncating them to see if this helps with
    //   some memory issues
    // todo: is 300 a good limit?
    Utilities.truncateDictionaryStrings(mapping, 300, ["xpath"]);

    return mapping;
  }

  /**
   * Checks if two node snapshots have all the same properties.
   * @param node1
   * @param node2
   */
  function nodeEquals(node1: NodeSnapshot, node2: NodeSnapshot) {
    if (node1 && node2) {
      if ('prop' in node1 && 'prop' in node2) {
        const omittedProps = RingerParams.params.compensation.omittedProps;
        const node1RelevantProps = _.omit(node1.prop, omittedProps);
        const node2RelevantProps = _.omit(node2.prop, omittedProps);
  
        return _.isEqual(node1RelevantProps, node2RelevantProps);
      } else if ('text' in node1 && 'text' in node2) {
        return node1.text === node2.text;
      }
    }
    return node1 === node2;
  }

  export function snapshot() {
    const body = document.body;
    const nodeName = body.nodeName.toLowerCase();
    if (nodeName === 'body') {
      return snapshotSubtree(body, 'html/body[1]');
    }
    throw new ReferenceError("Snapshot failed.");
  }

  /**
   * Create an array of snapshots from the node until the its highest parent
   *   is reached.
   *
   * @param node
   * @returns List of node snapshots, starting the highest ancestor.
   */
  export function snapshotBranch(node: Element | null) {
    const path = [];
    const props = ['className', 'id'];
    while (node !== null) {
      path.push(snapshotNodeHelper(node, DOMUtils.nodeToXPath(node),
        true, props));
      node = node.parentElement;
    }
    return path.reverse();
  }

  export function snapshotNode(node: Element | null) {
    if (!node) { return undefined; }

    return snapshotNodeHelper(node, DOMUtils.nodeToXPath(node), false, 'all');
  }

  /**
   * Serializes a DOM node by saving properties of the node.
   *
   * @param node The DOM node to snapshot
   * @param xpath The xpath of {@link node}
   * @param childTags Whether the tags of {@link node}'s children
   *     should also be snapshotted
   * @param props The node's properties which should be saved
   * 
   * @returns an object representing the {@link node}
   */
  function snapshotNodeHelper(node: Element, xpath: string, childTags: boolean,
      props: 'all' | string[]) {
    xpath = xpath.toLowerCase();

    const nodeName = node.nodeName.toLowerCase();
    const returnVal: NodeSnapshot = {
      children: [],
      prop: {},
      type: 'DOM'
    };

    // possible failure due to cross-domain browser restrictions
    if (nodeName !== 'iframe') {
      returnVal.prop = getProperties(node, props);
    }

    const snapshotProps = <Indexable> returnVal.prop;
    snapshotProps['nodeName'] = nodeName;
    snapshotProps['xpath'] = xpath;

    if (childTags) {
      const childNodes = node.children;
      const children = <NodeSnapshot[]> returnVal.children;
      const childrenTags: { [key: string]: number } = {};

      for (let i = 0; i < childNodes.length; ++i) {
        const child = <Node> childNodes.item(i);
        const nodeType = child.nodeType;

        // let's track the number of tags of this kind we've seen in the
        //   children so far, to build the xpath
        const childNodeName = child.nodeName.toLowerCase();
        if (!(childNodeName in childrenTags)) {
          childrenTags[childNodeName] = 1;
        } else {
          childrenTags[childNodeName] += 1;
        }

        if (nodeType === Node.ELEMENT_NODE) {
          if (!(childNodeName in ignoreTags)) {
            const newPath = xpath + '/' + childNodeName + '[' +
              childrenTags[childNodeName] + ']';
            children.push(
              snapshotNodeHelper(<Element> child, newPath, false, [])
            );
          }
        }
      }
    }

    return returnVal;
  }

  /**
   * Create a tree of snapshots representing the subtree rooted at {@link node}.
   *
   * @returns a {@link NodeSnapshot} for the tree.
   */
  function snapshotSubtree(node: Element, xpath: string) {
    const returnVal = snapshotNodeHelper(node, xpath, false, 'all');

    const childNodes = node.childNodes;
    const children: NodeSnapshot[] = [];
    returnVal.children = children;

    const childrenTags: Indexable = {};
    for (let i = 0; i < childNodes.length; ++i) {
      const child = <Node> childNodes.item(i);
      const nodeType = child.nodeType;

      // let's track the number of tags of this kind we've seen in the
      //   children so far, to build the xpath
      const childNodeName = child.nodeName.toLowerCase();
      if (!(childNodeName in childrenTags)) {
        childrenTags[childNodeName] = 1;
      } else {
        childrenTags[childNodeName] += 1;
      }

      if (nodeType === Node.TEXT_NODE) {
        const value = child.nodeValue;
        if (value) {
          children.push({
            text: value.trim(),
            type: 'text'
          });
        }
      } else if (nodeType === Node.ELEMENT_NODE) {
        if (!(childNodeName in ignoreTags) &&
            !(<Element> child).classList.contains('replayStatus')) {
          const newPath = xpath + '/' + childNodeName + '[' +
                        childrenTags[childNodeName] + ']';
          children.push(snapshotSubtree(<Element> child, newPath));
        }
      }
    }

    return returnVal;
  }
}