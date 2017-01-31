/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set shiftwidth=2 tabstop=2 autoindent cindent expandtab: */

'use strict'

var getTarget;
var getTargetFunction;
var targetFunctions;
var saveTargetInfo;

(function() {
  var log = getLog('target');

function getFeature(element, feature){
  if (feature === "xpath"){
    return nodeToXPath(element);
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
}

function getFeatures(element){
  var info = {};
  info.xpath = nodeToXPath(element);
  for (var prop in element) {
    try{
      var val = element[prop];
      }
    catch(err){
      continue;
    }
    if (val !== null && typeof val === 'object'){
        try{
          val = val.toString(); //sometimes get that toString not allowed
        }
        catch(err){
          continue;
        }
    }
    else if (typeof val === 'function'){
      continue;
    }
    info[prop] = val;
  } //test

  var text = element.textContent;
  info.textContent = text;
  var trimmedText = text.trim();
  info.firstWord = trimmedText.slice(0,trimmedText.indexOf(" "));
  info.lastWord = trimmedText.slice(trimmedText.lastIndexOf(" "),trimmedText.length);
  var colonIndex = trimmedText.indexOf(":")
  if (colonIndex > -1){
    info.preColonText = trimmedText.slice(0,colonIndex);
  }
  var children = element.childNodes;
  var l = children.length;
  for (var i = 0; i< l; i++){
    var childText = children[i].textContent;
    info["child"+i+"text"] = childText;
    info["lastChild"+(l-i)+"text"] = childText;
  }

  var prev = element.previousElementSibling;
  if (prev !== null){
    info.previousElementSiblingText = prev.textContent;
  }

  var boundingBox = element.getBoundingClientRect();
  for (var prop in boundingBox) {
    if (boundingBox.hasOwnProperty(prop)) {
      info[prop] = boundingBox.prop;
    }
  }
  var style = window.getComputedStyle(element, null);
  for (var i = 0; i < style.length; i++) {
    var prop = style[i];
    info[prop] = style.getPropertyValue(prop);
  }

  // this may be a table cell, in which case we'll add a couple extra features
  var $element = $(element);
  var $table = $element.closest('table');
  if ($table.length > 0){
    // cool, it is in a table
    // want index and reverse index for rows and columns
    var $rows = $table.find("tr"); // might not be good for nested tables, although at least we'll have chosen the deepest table that contains the $element.  todo: be better
    for (var i = 0; i < $rows.length; i++){
      var $row = $rows[i];
      if ($row.contains(element)){
        info.row_index = i;
        info.row_reverse_index = $rows.length - i;
        break;
      }
    }
    var $tr = $element.closest('tr');
    var $cells = $tr.find(info.nodeName); // same issue as comment above potentially.  todo: try again
    for (var i = 0; i < $cells.length; i++){
      var $cell = $cells[i];
      if ($cell.contains(element)){
        info.col_index = i;
        info.col_reverse_index = $cells.length - i;
        break;
      }
    }
  }


  return info;
}

  /* Store information about the DOM node */
  saveTargetInfo = function _saveTargetInfo(target, recording) {
    var targetInfo = {};
    targetInfo.xpath = nodeToXPath(target);
    //change this line to change node addressing approach
    //targetInfo.snapshot = snapshotNode(target);
    targetInfo.snapshot = getFeatures(target);
    if (recording == RecordState.RECORDING) {
      targetInfo.branch = snapshotBranch(target);
    }
    return targetInfo;
  };

  /* The following functions are different implementations to take a target
   * info object, and convert it to a list of possible DOM nodes */ 

  function getTargetSimple(targetInfo) {
    return xPathToNodes(targetInfo.xpath);
  }

  function getTargetSuffix(targetInfo) {

    function helper(xpath) {
      var index = 0;
      while (xpath[index] == '/')
        index++;

      if (index > 0)
        xpath = xpath.slice(index);

      var targets = xPathToNodes('//' + xpath);

      if (targets.length > 0) {
        return targets;
      }

      /* If we're here, we failed to find the child. Try dropping
       * steadily larger prefixes of the xpath until some portion works.
       * Gives up if only three levels left in xpath. */
      if (xpath.split('/').length < 4) {
        /* No more prefixes to reasonably remove, so give up */
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
      return xPathToNodes('//*[text()="' + text + '"]');
    }
    return [];
  }

  function getTargetSearch(targetInfo) {
    /* search over changes to the ancesters (replacing each ancestor with a
     * star plus changes such as adding or removing ancestors) */

    function helper(xpathSplit, index) {
      if (index == 0)
        return [];

      var targets;

      if (index < xpathSplit.length - 1) {
        var clone = xpathSplit.slice(0);
        var xpathPart = clone[index];

        clone[index] = '*';
        targets = xPathToNodes(clone.join('/'));
        if (targets.length > 0)
          return targets;

        clone.splice(index, 0, xpathPart);
        targets = xPathToNodes(clone.join('/'));
        if (targets.length > 0)
          return targets;
      }

      targets = xPathToNodes(xpathSplit.join('/'));
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
      //xPathToNodes("//*[@class='" + className + "']");

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
  }

  /* Set the target function */
  getTargetFunction = getTargetComposite;

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

  function getAllSimilarityCandidates(targetInfo){
    var tagName = "*";
    if (targetInfo.nodeName){
      tagName = targetInfo.nodeName;
    }
    return document.getElementsByTagName(tagName);
  }

  var getTargetForSimilarityHelper = function(targetInfo, candidates){
    var bestScore = -1;
    var bestNode = null;
    for (var i = 0; i<candidates.length; i++){
      var info = getFeatures(candidates[i]);
      var similarityCount = 0;
      for (var prop in targetInfo) {
        if (targetInfo.hasOwnProperty(prop)) {
          if (targetInfo[prop] === info[prop]){
                  similarityCount += 1;
          }
        }
      }
      if (similarityCount > bestScore){
        bestScore = similarityCount;
        bestNode = candidates[i];
      }
    }
    return bestNode;
  };

  var getTargetForSimilarity = function(targetInfo) {
    var candidates = getAllSimilarityCandidates(targetInfo);
    return getTargetForSimilarityHelper(targetInfo, candidates);
  };

  var getTargetForSimilarityFilteredByText = function(targetInfo, filterFeatures) {
    //console.log("getTargetForSimilarityFilteredByText", targetInfo, filterFeatures);
    if (filterFeatures === undefined){ filterFeatures = []; }
    //console.log("getTargetForSimilarityFilteredByText", targetInfo);
    var unfilteredCandidates = getAllSimilarityCandidates(targetInfo);

    // soon we'll filter by text, since we're doing getTargetForSimilarityFilteredByText
    // but we need to filter based on the user-provided filterFeatures (the ones required to be stable) first
    var userFilteredCandidates = null;
    if (filterFeatures.length === 0){
      userFilteredCandidates = unfilteredCandidates
    }
    else{
      userFilteredCandidates = [];
      for (var i = 0; i < unfilteredCandidates.length; i++){
        var matchedAllFeatures = _.reduce(filterFeatures, function(acc, feature){return (acc && (unfilteredCandidates[i][feature] === targetInfo[feature]));}, true);
        if (matchedAllFeatures){
          userFilteredCandidates.push(unfilteredCandidates[i]);
        }         
      }
    }
    //console.log("userFilteredCandidates", userFilteredCandidates.length, userFilteredCandidates);
    // this is a case where, because user can require features that no longer appear, we can get zero matches!
    if (userFilteredCandidates.length === 0){
      console.log("After filtering on user-selected features, no candidates qualify.");
      return null;
    }

    // ok, now filter by text
    var targetText = targetInfo.textContent;
    var candidates = [];
    for (var i = 0; i < userFilteredCandidates.length; i++){
      if (userFilteredCandidates[i].textContent === targetText){
        candidates.push(userFilteredCandidates[i]);
      }
    }
    if (candidates.length === 0){
      //fall back to the normal one that considers all nodes
      return getTargetForSimilarityHelper(targetInfo, userFilteredCandidates);
    }
    
    //otherwise, let's just run similarity on the nodes that have the same text
    return getTargetForSimilarityHelper(targetInfo, candidates);
  };


  var identifiedNodesCache = {};

  getTarget = function(targetInfo) {
    console.log("identifiedNodesCache", identifiedNodesCache.length, identifiedNodesCache);
    if (! targetInfo){
      return null;
    }
    var xpath = targetInfo.xpath;
    if (xpath in identifiedNodesCache){
      // we've already had to find this node on this page.  go ahead and use the cached node.
      var cachedNode = identifiedNodesCache[xpath];
      // unless the page has changed and that node's not around anymore!
      if ($.inArray(cachedNode, $("*")) > -1){
        return cachedNode;
      }
      return cachedNode;
    }
    // we have a useXpathOnly flag set to true when the top level has parameterized on xpath, and normal node addressing approach should be ignored
    if (targetInfo.useXpathOnly){
      var nodes = xPathToNodes(xpath);
      if (nodes.length > 0){
        var xpathNode = nodes[0];
        console.log("xpathNode", xpathNode);
        return xpathNode;
      }
    }
    // the top-level tool may specify that some subset of features remain stable (text, id, so on, if they have special knowledge of page design)
    // in this case, we should grab these requiredFeatures to use as a filter
    var filterFeatures = [];
    if (targetInfo.requiredFeatures){
      filterFeatures = targetInfo.requiredFeatures;
    }

    // ok, now let's use similarity-based node finding
    var features = targetInfo.snapshot;
    var winningNode = getTargetForSimilarityFilteredByText(features, filterFeatures);
    identifiedNodesCache[xpath] = winningNode;
    return winningNode;
  }

  /* List of all target functions. Used for benchmarking */
  targetFunctions = {
    simple: getTargetSimple,
    suffix: getTargetSuffix,
    text: getTargetText,
    class: getTargetClass,
    id: getTargetId,
    search: getTargetSearch
  };

})();
