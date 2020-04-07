import { XPath } from "./xpath";
import XPathNode = XPath.XPathNode;
import XPathList = XPath.XPathList;

interface IndexableDOMRect extends DOMRect {
  [key: string]: any;
}

/**
 * Interfaces and functions for creating and modifying features of DOM elements.
 */
export namespace Features {

  /**
   * All supported features.
   */
  const SUPPORTED_FEATURES = ["tag", "class", "left", "bottom", "right", "top",
    "width", "height", "font-size", "font-family", "font-style", "font-weight",
    "color", "background-color", "preceding-text", "text", "xpath"];

  /**
   * All supported features except XPath.
   */
  export const FEATURES_EXCEPT_XPATH = SUPPORTED_FEATURES.slice().filter(
    (feature) => feature !== "xpath");

  /**
   * Contains information on what criteria to match for a certain feature.
   */
  interface FeatureCriteria {
    /**
     * Whether the criteria is positive or negative.
     * true means positive; node should match this value
     * false means negate; node should NOT match this value
     */
    pos: boolean;
  
    values: (string | XPathNode[])[];
  }
  
  /**
   * A generic interface to inherit specific feature sets from.
   */
  export interface GenericFeatureSet {
  }
  
  /**
   * A set of features describing how to find the rows for a relation.
   */
  export interface FeatureSet extends GenericFeatureSet {
    [key: string]: FeatureCriteria;
  }

  /**
   * A separate feature set for handling tables.
   */
  export interface TableFeatureSet extends GenericFeatureSet {
    table: boolean;
    xpath: string;
  }

  export interface PulldownFeatureSet extends GenericFeatureSet {
    type: string;
    index: number;
  }

  /**
   * Computes the value of a feature from an element.
   * @param element element
   * @param feature feature name
   */
  export function computeFeatureFromElement(element: HTMLElement,
    feature: string) {
    if (feature === "xpath") {
      return XPath.toXPathNodeList(<string> XPath.fromNode(element));
    } else if (feature === "preceding-text") {
      return element.previousElementSibling?.textContent;
    } else if (feature === "text") {
      return element.textContent;
    } else if (feature === "tag") {
      return element.tagName;
    } else if (feature === "class") {
      return element.className;
    } else if (["top", "right", "bottom", 
                "left", "width", "height"].includes(feature)) {
      let rect = <IndexableDOMRect> element.getBoundingClientRect();
      return rect[feature];
    } else {
      return window.getComputedStyle(element, null).getPropertyValue(feature);
    }
  }

  /**
   * Checks if feature value is within acceptable values.
   * @param feature feature type
   * @param value feature value
   * @param acceptable_values acceptable feature values to match to
   * @returns true if feature value is within acceptable values
   */
  export function featureMatches(feature: string, value: string | XPathList,
    acceptable_values: (string | XPathList)[]) {
    if (feature === "xpath") {
      return acceptable_values.some((av: XPathList) =>
        XPath.matches(av, <XPathList> value)
      );
    } else if (feature === "class") {
      // class doesn't have to be same, just has to include the target class
      // TODO: Decide if that's really how we want it
      return acceptable_values.some(
        (av: string) => (<string> value).includes(av));
    } else {
      return acceptable_values.includes(value);
    }
  }


  /**
   * Merges feature values from multiple elements to find common feature values.
   *   Removes any features for which there are no common feature values or the
   *   maximum common feature values is exceeded.
   * For general arrays, deduplicate feature value arrays.
   * For xpath arrays, multiple xpaths with overlapping sections are merged
   *   using wildcard (*)s where possible.
   * @param featureSet the unmerged feature set
   * @param maxFeatureValues the maximum number of common feature values
   */
  export function mergeFeatureValues(featureSet: FeatureSet,
    maxFeatureValues = 3) {
    for (const feature in featureSet) {
      let featureValues = featureSet[feature].values;
      if (feature === "xpath") {
        featureSet[feature].values = XPath.condenseList(
          <XPathList[]> featureValues);
      } else {
        let origFeatureCount = featureValues.length;
        let mergedVals = [...new Set(featureValues)];   // de-duplicate
        if (mergedVals.length <= maxFeatureValues &&
            mergedVals.length < origFeatureCount) {
          featureSet[feature].values = mergedVals; 
        } else {
          delete featureSet[feature];
        }
      }
    }
  }


  /**
   * Creates a {@link FeatureSet} for features from matched elements.
   * @param features list of features to use
   * @param matchedEls matched elements
   */
  export function getFeatureSet(features: string[], matchedEls: HTMLElement[]) {
    let featureSet: FeatureSet = {};

    for (const feature of features) {
      featureSet[feature] = { values: [], pos: true };

      // add all positive nodes' values into the feature dict
      for (const posNode of matchedEls) {
        let value = computeFeatureFromElement(posNode, feature);
        featureSet[feature].values.push(value);
      }
    }

    mergeFeatureValues(featureSet);

    return featureSet;
  }


  /**
   * Create a {@link TableFeatureSet} from a table element.
   * @param tableEl table element
   */
  export function createTableFeatureSet(tableEl: HTMLElement): TableFeatureSet {
    return {
      table: true,
      xpath: <string> XPath.fromNode(tableEl)
    };
  }

  /**
   * Convert a server-retrieved message of a featureSet to a {@link FeatureSet}.
   * @param featureSetMsg the message
   */
  /*
  export function fromMessage(featureSetMsg: FeatureSetMessage) {
    let featureSet: FeatureSet = {};
    
    for (const feature in featureSetMsg) {
      if (feature === 'xpath') {
        featureSet.xpath = {
          pos: featureSetMsg.xpath.pos,
          values: []
        };
        for (const value of featureSetMsg.xpath.values) {
          let xpathList: XPathList = [];
          let messageXPathList = <XPathNodeMessage[]> value;
          for (const msgXPathNode of messageXPathList) {
            xpathList.push({
              nodeName: msgXPathNode.nodeName,
              iterable: msgXPathNode.iterable,
              index: parseInt(msgXPathNode.index)
            });
          };
          featureSet.xpath.values.push(xpathList);
        }
      } else {
        featureSet[feature] = <FeatureCriteria> featureSetMsg[feature];
      }
    }
    return featureSet;
  }*/
}