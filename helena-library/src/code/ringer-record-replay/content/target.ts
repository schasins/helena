import { Indexable, Utilities } from "../common/utils";
import { NodeSnapshot, Snapshot } from "./snapshot";
import { HelenaConsole } from "../../common/utils/helena_console";
import { DOMUtils } from "./dom_utils";
import { RecordState } from "../common/messages";

interface ElementFeatures {
  [key: string]: any;

  xpath: string;
}

interface DocumentFeatures extends ElementFeatures {
  xpath: string;
}

interface NonDocumentFeatures extends ElementFeatures {
  source_url: string;

  /** Text-related features */
  // child0Text, child1Text, ...
  // lastChild4Text, lastChild3Text, ...
  firstThreeWords?: string;
  firstTwoWords?: string;
  firstWord?: string;
  lastWord?: string;
  possibleHeading?: string;
  preColonText?: string;
  previousElementSiblingText?: string;
  textContent?: string;

  /** Also includes CSS properties */
  // there's a ton of these so won't list them here

  /** Table-related features */
  col_index?: number;
  col_reverse_index?: number;
  row_index?: number;
  row_reverse_index?: number;
}

export interface TargetInfo {
  [key: string]: any;

  branch?: NodeSnapshot[];
  requiredFeatures?: string[];
  snapshot: ElementFeatures;
  // snapshot: NodeFeatures;
  useXpathOnly?: boolean;
  xpath: string;
}

export enum TargetStatus {
  REQUIRED_FEATURE_FAILED = 1,
  REQUIRED_FEATURE_FAILED_CERTAIN,
  TIMED_OUT_CERTAIN
}

export namespace Target {
  /** Caches nodes that have already been identified. */
  let identifiedNodesCache: { [key: string]: Node } = {};

  /** Stores whether targets are missing required features or not. */
  let targetsMissingFeatures: { [key: string]: boolean } = {};

  /** Stores target lookups that timed out. */
  let timedOutNodes: { [key: string]: boolean } = {};

  /**
   * Find candidate elements given features.
   * @param features 
   */
  function getCandidateElements(features: ElementFeatures) {
    HelenaConsole.log("running getAllSimilarityCandidates");
    let tagName = "*";
    if (features.nodeName){
      tagName = features.nodeName;
    }
    //return document.getElementsByTagName(tagName);
    const visibleItems: Element[] = [];

    document.querySelectorAll(tagName).forEach((el) => {
      if ($(el).is(":visible")) {
        visibleItems.push(el);
      }
    });

    return visibleItems;
  }

  /**
   * Featurize a DOM node.
   * @param node 
   */
  function getFeatures(node: Node) {
    const info: ElementFeatures = {
      xpath: DOMUtils.nodeToXPath(node)
    };

    // another special case for document, which doesn't have a lot of the
    //   functions we'll call below
    if (node === document) {
      return <DocumentFeatures> info;
    }

    const el = <Element & Indexable> node;

    let features: NonDocumentFeatures = {
      ...info,
      source_url: window.location.href
    };

    for (const prop in el) {
      try {
        let val = el[prop];

        if (val !== null && typeof val === 'object') {
          val = val.toString(); // sometimes get that toString not allowed
        } else if (typeof val === 'function'){
          continue;
        }
      
        features[prop] = val;
      } catch(err) {
        continue;
      }
    }

    const text = el.textContent;
    if (text) {
      features.textContent = text;
      const trimmedText = text.trim();

      const firstSpaceInd = trimmedText.indexOf(" ");
      if (firstSpaceInd > -1){
          features.firstWord = trimmedText.slice(0,firstSpaceInd);
          const secondSpaceInd = trimmedText.indexOf(" ", firstSpaceInd + 1);
          features.firstTwoWords = trimmedText.slice(0,secondSpaceInd);
          const thirdSpaceInd = trimmedText.indexOf(" ", secondSpaceInd + 1);
          features.firstThreeWords = trimmedText.slice(0,thirdSpaceInd);
          features.lastWord = trimmedText.slice(trimmedText.lastIndexOf(" "),
            trimmedText.length);
      }

      const colonIndex = trimmedText.indexOf(":");
      if (colonIndex > -1) {
        features.preColonText = trimmedText.slice(0, colonIndex);
      }
    }
    
    const childNodes = el.childNodes;
    const l = childNodes.length;
    for (let i = 0; i < l; i++) {
      const childText = childNodes[i].textContent;
      features[`child${i}text`] = childText;
      features[`lastChild${l-i}text`] = childText;
    }

    // keep ascending the parent links as long as the inner text is the same.
    //   as soon as it's not the same, add the first text of the new thing as a
    //   possible heading
    let currentNode = $(el);
    while (
      $(currentNode).parent().text().trim() ===
        $(currentNode).text().trim() ||
      $(currentNode).parent().text().trim().startsWith(
        $(currentNode).text().trim())) {
      currentNode = $(currentNode).parent();
    }
  
    // ok, let's go one more up to get to that parent node that has different
    //   text.
    currentNode = $(currentNode).parent();
    const children = currentNode[0].children;
    let possibleHeading = undefined;
    for (let i = 0; i < children.length; i++) {
      const child = children.item(i);
      if (child?.textContent) {
        possibleHeading = child.textContent.trim();
        break;
      }
    }
    features.possibleHeading = possibleHeading;

    const prev = el.previousElementSibling;
    if (prev && prev.textContent) {
      features.previousElementSiblingText = prev.textContent;
    }

    // TODO: cjbaik: checked, and I don't think boundingBox has ANY properties
    //   fulfilling hasOwnProperty so this is essentially doing nothing
    const boundingBox = el.getBoundingClientRect();
    for (const prop in boundingBox) {
      if (boundingBox.hasOwnProperty(prop)) {
        features[prop] = (<Indexable> boundingBox)[prop];
      }
    }
  
    const style = window.getComputedStyle(el, null);
    for (let i = 0; i < style.length; i++) {
      const prop = style[i];
      features[prop] = style.getPropertyValue(prop);
    }

    // this may be a table cell, in which case we'll add a couple extra features
    const $element = $(el);
    const $table = $element.closest('table');
    if ($table.length > 0) {
      // cool, it is in a table
      // want index and reverse index for rows and columns

      // might not be good for nested tables, although at least we'll have
      //   chosen the deepest table that contains the $element. todo: be better
      const $rows = $table.find("tr");
      for (let i = 0; i < $rows.length; i++){
        const $row = $rows[i];
        if ($row.contains(el)) {
          features.row_index = i;
          features.row_reverse_index = $rows.length - i;
          break;
        }
      }
      const $tr = $element.closest('tr');

      // same issue as comment above potentially.  todo: try again
      const $cells = $tr.find(features.nodeName);
      for (let i = 0; i < $cells.length; i++){
        const $cell = $cells[i];
        if ($cell.contains(el)) {
          features.col_index = i;
          features.col_reverse_index = $cells.length - i;
          break;
        }
      }
    }

    // for some pages, the strings for various text-y things get crazy long
    // we're going to play around with truncating them to see if this helps with
    //   some memory issues
    Utilities.truncateDictionaryStrings(info, 300, ["value",
      "xpath"]);

    return features;
  }

  export function getTarget(targetInfo: TargetInfo) {
    // console.log("identifiedNodesCache", identifiedNodesCache.length,
    //   identifiedNodesCache);
    if (!targetInfo) {
      return null;
    }

    if (targetInfo.xpath in timedOutNodes) {
      HelenaConsole.namedLog("nodeTimeout", "nope, this node timed out");
      return TargetStatus.TIMED_OUT_CERTAIN;
    }
    if (missingRequiredFeatures(targetInfo)) {
      HelenaConsole.namedLog("nodeTimeout",
        "nope, already know we don't have those features");
      return TargetStatus.REQUIRED_FEATURE_FAILED_CERTAIN;
      // return "REQUIREDFEATUREFAILURECERTAIN";
    }

    const xpath = targetInfo.xpath;
    if (xpath in identifiedNodesCache) {
      // we've already had to find this node on this page. use the cached node.
      const cachedNode = identifiedNodesCache[xpath];
      // unless the page has changed and that node's not around anymore!
      if (document.body.contains(cachedNode) && $(cachedNode).is(':visible')){
        return cachedNode;
      }
    }

    // we have a useXpathOnly flag set to true when the top level has
    //   parameterized on xpath, and normal node addressing approach should be
    //   ignored
    if (targetInfo.useXpathOnly) {
      const nodes = DOMUtils.xPathToNodes(xpath);
      if (nodes.length > 0) {
        const xpathNode = nodes[0];
        HelenaConsole.namedLog("nodeTimeout", "xpathNode", xpathNode);
        return xpathNode;
      }
    }
    // the top-level tool may specify that some subset of features remain stable
    //   (text, id, so on, if they have special knowledge of page design)
    // in this case, we should grab these requiredFeatures to use as a filter
    let filterFeatures: string[] = [];
    if (targetInfo.requiredFeatures) {
      filterFeatures = targetInfo.requiredFeatures;
    }

    // ok, now let's use similarity-based node finding
    const features = targetInfo.snapshot;
    const winningNode = findBestElement(features, filterFeatures);
    
    // don't cache the TargetStatus return values we sometimes use
    if (winningNode && typeof winningNode !== 'number') {
      identifiedNodesCache[xpath] = winningNode;
    }
    return winningNode;
  }

  /**
   * Returns true if the targetInfo is known to be missing required features.
   * @param targetInfo 
   */
  function missingRequiredFeatures(targetInfo: TargetInfo) {
    if (!targetInfo.requiredFeatures){ return false; }
    return targetsMissingFeatures[toString(targetInfo)];
  }

  /**
   * Find the best element matching the features.
   * @param features 
   * @param filterFeatures
   */
  function findBestElement(features: ElementFeatures,
      filterFeatures: string[] = []) {
    HelenaConsole.log("getTargetForSimilarityFiltered", features,
      filterFeatures);

    let unfilteredCandidates = [];
    if (window.helenaContent.ringerUseXpathFastMode ||
        filterFeatures.includes("xpath")) {
      // this is a special case, where we can just speed it up by using the
      //   xpath they want, since it's a required feature
      const nodes = DOMUtils.xPathToNodes(features.xpath);
      unfilteredCandidates = nodes;
    } else {
      // recall that this could be just the body node if nothing's loaded yet
      unfilteredCandidates = getCandidateElements(features);
    }

    // soon we'll filter by text, since we're doing
    //   getTargetForSimilarityFilteredByText
    // but we need to filter based on the user-provided filterFeatures (the ones
    //   required to be stable) first
    let userFilteredCandidates = null;
    if (filterFeatures.length === 0) {
      userFilteredCandidates = unfilteredCandidates;
    } else {
      // have to convert to feature view to do our filtering!
      const unfilteredCandidatesFeatures = unfilteredCandidates.map(
        (c: Element) => getFeatures(c));
      userFilteredCandidates = [];
      for (let i = 0; i < unfilteredCandidates.length; i++){
        const matchedAllFeatures = filterFeatures.every((feature) =>
          unfilteredCandidatesFeatures[i][feature] === features[feature]
        );
        if (matchedAllFeatures){
          userFilteredCandidates.push(unfilteredCandidates[i]);
        }
      }

      HelenaConsole.log("userFilteredCandidates", userFilteredCandidates.length,
        userFilteredCandidates);
      // 1 because we should always at least see the body node, which just means
      //   we're not ready, right?
      if (unfilteredCandidates.length > 1 &&
          userFilteredCandidates.length === 0) {
        // this is a case where, because user can require features that no
        //   longer appear, we can get zero matches!
        return TargetStatus.REQUIRED_FEATURE_FAILED;
        // return "REQUIREDFEATUREFAILURE";
      }
    }

    if (userFilteredCandidates.length === 0) {
      // console.log("After filtering on user-selected features, no candidates
      //   qualify.");
      return null;
    }

    // ok, now filter by text
    const targetText = features.textContent;
    const candidates = [];
    for (const cand of userFilteredCandidates) {
      if (cand.textContent === targetText){
        candidates.push(cand);
      }
    }
    if (candidates.length === 0) {
      //fall back to the normal one that considers all nodes
      return selectBestCandidate(features, userFilteredCandidates);
    }
    
    //otherwise, let's just run similarity on the nodes that have the same text
    return selectBestCandidate(features, candidates);
  }

  /**
   * Mark a target as missing necessary features.
   * @param targetInfo 
   */
  export function markAsMissingFeatures(targetInfo: TargetInfo) {
    HelenaConsole.namedLog("nodeTimeout", "marked as missing features");
    targetsMissingFeatures[toString(targetInfo)] = true;
  }

  /**
   * Mark a target timed out, when it doesn't appear to exist on current page.
   * @param targetInfo target info
   */
  export function markTimedOut(targetInfo: TargetInfo) {
    HelenaConsole.namedLog("nodeTimeout", "marked timed out");
    timedOutNodes[targetInfo.xpath] = true;
  }

  /**
   * Store information about the DOM node.
   * @param target DOM node
   * @param recording recording status
   */
  export function saveTargetInfo(target: Element, recording: string) {
    const targetInfo: TargetInfo = {
      //change this line to change node addressing approach
      // snapshot: Snapshot.snapshotNode(target),
      snapshot: getFeatures(target),
      xpath: DOMUtils.nodeToXPath(target)
    };
    if (recording === RecordState.RECORDING) {
      targetInfo.branch = Snapshot.snapshotBranch(target);
    }
    return targetInfo;
  }

  /**
   * Select the best candidate element matching the features.
   * @param features 
   * @param candidates 
   */
  export function selectBestCandidate(features: ElementFeatures,
      candidates: Node[]) {
    let bestScore = -1;
    let bestNode = null;
    for (const cand of candidates) {
      const info = getFeatures(cand);
      let similarityCount = 0;
      for (const prop in features) {
        if (features.hasOwnProperty(prop)) {
          if (features[prop] === info[prop]) {
            similarityCount += 1;
          }
        }
      }
      if (similarityCount > bestScore){
        bestScore = similarityCount;
        bestNode = cand;
      }
    }
    return bestNode;
  }

  /**
   * Convert a {@link TargetInfo} to string.
   * @param targetInfo 
   */
  function toString(targetInfo: TargetInfo) {
    if (!targetInfo.requiredFeatures) {
      throw new ReferenceError("Expected requiredFeatures.");
    }
    const featureNames = targetInfo.requiredFeatures.sort();
    const values = featureNames.map((f) => targetInfo.snapshot[f]);
    return `${featureNames.join("_")}____${values.join("_")}`;
  }
}

/*
function getFeature(element, feature){
  if (feature === "xpath"){
    return DOMUtils.nodeToXPath(element);
  }
  else if (feature === "id"){
    return element.id;
  }
  else if (feature === "preceding-text"){
    return $(element).prev().text();
  }
  else if (_.contains(["tag","class"],feature)){
    return element[feature+"Name"];
  }
  else if (_.contains(["top", "right", "bottom", "left", "width", "height"], feature)){
    var rect = element.getBoundingClientRect();
    return rect[feature];
  }
  else{
    var style = window.getComputedStyle(element, null);
    return style.getPropertyValue(feature);
  }
}*/
  /* The following functions are different implementations to take a target
   * info object, and convert it to a list of possible DOM nodes */ 

   /*
  function getTargetSimple(targetInfo) {
    return DOMUtils.xPathToNodes(targetInfo.xpath);
  }

  function getTargetSuffix(targetInfo) {

    function helper(xpath) {
      var index = 0;
      while (xpath[index] == '/')
        index++;

      if (index > 0)
        xpath = xpath.slice(index);

      var targets = DOMUtils.xPathToNodes('//' + xpath);

      if (targets.length > 0) {
        return targets;
      }

      /* If we're here, we failed to find the child. Try dropping
       * steadily larger prefixes of the xpath until some portion works.
       * Gives up if only three levels left in xpath.
      if (xpath.split('/').length < 4) {
        /* No more prefixes to reasonably remove, so give up
        return [];
      }

      var index = xpath.indexOf('/');
      xpathSuffix = xpath.slice(index + 1);
      return helper(xpathSuffix);
    }

    return helper(targetInfo.xpath);
  }

  function getTargetText(targetInfo) {
    var text = targetInfo.snapshot.prop.innerText;
    if (text) {
      return DOMUtils.xPathToNodes('//*[text()="' + text + '"]');
    }
    return [];
  }

  function getTargetSearch(targetInfo) {
    /* search over changes to the ancesters (replacing each ancestor with a
     * star plus changes such as adding or removing ancestors)

    function helper(xpathSplit, index) {
      if (index == 0)
        return [];

      var targets;

      if (index < xpathSplit.length - 1) {
        var clone = xpathSplit.slice(0);
        var xpathPart = clone[index];

        clone[index] = '*';
        targets = DOMUtils.xPathToNodes(clone.join('/'));
        if (targets.length > 0)
          return targets;

        clone.splice(index, 0, xpathPart);
        targets = DOMUtils.xPathToNodes(clone.join('/'));
        if (targets.length > 0)
          return targets;
      }

      targets = DOMUtils.xPathToNodes(xpathSplit.join('/'));
      if (targets.length > 0)
        return targets;

      return helper(xpathSplit, index - 1);
    }

    var split = targetInfo.xpath.split('/');
    return helper(split, split.length - 1);
  }

  function getTargetClass(targetInfo) {
    var className = targetInfo.snapshot.prop.className;
    if (className) {
      //DOMUtils.xPathToNodes("//*[@class='" + className + "']");

      var classes = className.trim().replace(':', '\\:').split(' ');
      var selector = '';
      for (var i = 0, ii = classes.length; i < ii; ++i) {
        var className = classes[i];
        if (className)
          selector += '.' + classes[i];
      }

      return $.makeArray($(selector));
    }
    return [];
  }

  function getTargetId(targetInfo) {
    var id = targetInfo.snapshot.prop.id;
    if (id) {
      var selector = '#' + id.trim().replace(':', '\\:');
      return $.makeArray($(selector));
    }
    return [];
  }

  /*
  function getTargetComposite(targetInfo) {
    var targets = [];
    var metaInfo = [];

    for (var strategy in targetFunctions) {
      try {
        var strategyTargets = targetFunctions[strategy](targetInfo);
        for (var i = 0, ii = strategyTargets.length; i < ii; ++i) {
          var t = strategyTargets[i];
          var targetIndex = targets.indexOf(t);
          if (targetIndex == -1) {
            targets.push(t);
            metaInfo.push([strategy]);
          } else {
            metaInfo[targetIndex].push(strategy);
          }
        }
      } catch (e) {}
    }

    var maxStrategies = 0;
    var maxTargets = [];
    for (var i = 0, ii = targets.length; i < ii; ++i) {
      var numStrategies = metaInfo[i].length;
      if (numStrategies == maxStrategies) {
        maxTargets.push(targets[i]);
      } else if (numStrategies > maxStrategies) {
        maxTargets = [targets[i]];
        maxStrategies = numStrategies;
      }
    }

    return maxTargets;
  }*/

  /* Set the target function */
  // getTargetFunction = getTargetComposite;

  /* Given the target info, produce a single target DOM node. May get several
   * possible candidates, and would just return the first candidate. */
   /*
  getTarget = function(targetInfo) {
	console.log("targetInfo", targetInfo);
    var targets = getTargetFunction(targetInfo);
    if (!targets) {
      console.log("No target found.");
      log.debug('No target found');
      return null;
    } else if (targets.length > 1) {
      log.debug('Multiple targets found:', targets);
      return null;
    } else {
      return targets[0];
    }
  };
  */

  /*
  var getTargetForSimilarity = function(targetInfo) {
    var candidates = getAllSimilarityCandidates(targetInfo);
    return getTargetForSimilarityHelper(targetInfo, candidates);
  };*/

/* List of all target functions. Used for benchmarking */
/*
targetFunctions = {
  simple: getTargetSimple,
  suffix: getTargetSuffix,
  text: getTargetText,
  class: getTargetClass,
  id: getTargetId,
  search: getTargetSearch
};

  // now let's not go crazy with recording when we've seen a timeout. if the
  //   page changes, let's clear out all our timedOutNodes
  // todo: should we also clear out the identifiedNodesCache
  var observer = new window.MutationObserver(function(mutations, observer) {
      // fired when a mutation occurs
      HelenaConsole.namedLog("nodeTimeout",
        "observed dom change, clearing timeout cache");
      timedOutNodes = {};
      targetsMissingFeatures = {};
  });
  */