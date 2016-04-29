/**********************************************************************
 * Author: S. Chasins
 **********************************************************************/

/**********************************************************************
 * Message handling
 **********************************************************************/

utilities.listenForMessage("mainpanel", "content", "likelyRelation", function(msg){console.log("biggestRelation: ", msg); SelectorSynthesis.likelyRelation(msg);});

var RelationFinder = (function() { var pub = {};

  /**********************************************************************
   * Web-specific relation-finder code -- how to get features, how to tell when features match, how to combine features to get a more general feature, all candidates
   **********************************************************************/

  /* Available features:
   * tag
   * class
   * left, bottom, right, top
   * font-size, font-family, font-style, font-weight, color
   * background-color
   * xpath
   * Additional processing:
   * excludeFirst
   */

   pub.all_features = ["tag", "class", 
   "left", "bottom", "right", "top", "width", "height",
   "font-size", "font-family", "font-style", "font-weight", "color",
   "background-color", 
   "preceding-text", "text",
   "xpath"];

   function getFeature(element, feature){
    if (feature === "xpath"){
      return xPathToXPathList(nodeToXPath(element));
    }
    else if (feature === "preceding-text"){
      return $(element).prev().text();
    }
    else if (feature === "text"){
      return $(element).text();
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

  function featureMatch(feature, value, acceptable_values){
    if (feature === "xpath"){
      return _.reduce(acceptable_values, function(acc, av){ return (acc || (XPathList.xPathMatch(av, value))); }, false);
    }
    else if (feature === "class"){
      //class doesn't have to be same, just has to include the target class
      //TODO: Decide if that's really how we want it
      return _.reduce(acceptable_values, function(acc, av){ return (acc || (value.indexOf(av) > -1)); }, false);
    }
    else {
      return _.contains(acceptable_values,value);
    }
  }

  function collapseValues(feature, values){
    if (feature === "xpath"){
      return xPathReduction(values);
    }
    return _.uniq(values);
  }

  function makeSubcomponentFunction(suffixes){
    var subcomponentFunction = function(candidateRow){
      var candidate_subitems = [];
      var candidate_xpath = XPathList.xPathToXPathList(nodeToXPath(candidateRow));
      var null_subitems = 0;
      for (var j = 0; j < suffixes.length; j++){
        var xpath = candidate_xpath.concat(suffixes[j]);
        var xpath_string = XPathList.xPathToString(xpath);
        var nodes = xPathToNodes(xpath_string);
        if (nodes.length > 0){
          candidate_subitems.push(nodes[0]);
        }
        else{
          null_subitems += 1;
          candidate_subitems.push(null);
        }
      }
      if (candidate_subitems.length > 0 && candidate_subitems.length > null_subitems){
        return candidate_subitems;
      }
      return null;
    };
  }

  function getAllCandidates(){
    return document.getElementsByTagName("*");
  }

  /**********************************************************************
   * Domain-independent function to go from a selector to a relation of elements
   **********************************************************************/

  // given a selector, what elements from the domain match the selector?
  // feature_dict is the primary part of our selector
  // exclude_first tells us whether to skip the first row, as we often do when we have headers
  // suffixes tell us how to find subcomponents of a row in the relation
  pub.interpretRelationSelectorHelper = function(feature_dict, exclude_first, subcomponents_function){
    var candidates = getAllCandidates();
    var list = [];
    for (i=0;i<candidates.length;i++){
      var candidate = candidates[i];
      var candidate_ok = true;
      for (var feature in feature_dict){
        var value = getFeature(candidate,feature);
        var acceptable_values = feature_dict[feature]["values"];
        var pos = feature_dict[feature]["pos"];
        var candidate_feature_match = featureMatch(feature, value, acceptable_values);
        if ((pos && !candidate_feature_match) || (!pos && candidate_feature_match)){
          candidate_ok = false;
          break;
        }
      }
      if (candidate_ok){
        candidate_subitems = subcomponents_function(candidate);
        if (candidate_subitems !== null){
          list.push(candidate_subitems);
        }
      }
    }
    if (exclude_first && list.length > 0){
      return list.slice(1,list.length);
    }
    return list;
  };

  pub.interpretRelationSelector = function(selector){
    return RelationFinder.interpretRelationSelectorHelper(selector.dict, selector.exclude_first, makeSubcomponentFunction(selector.suffixes));
  };

return pub;}());


/**********************************************************************
 * How to actually synthesize the selectors used by the relation-finder above
 **********************************************************************/

var SelectorSynthesis = (function() { var pub = {};

  function findCommonAncestor(nodes){
    var xpath_lists = _.map(nodes, function(node){ return XPathList.xPathToXPathList(nodeToXPath(node)); });
    if (xpath_lists.length === 0){
      console.log("Why are you trying to get the common ancestor of 0 nodes?");
      return;
    }
    var first_xpath_list = xpath_lists[0];
    for (var i = 0; i< first_xpath_list.length; i++){
      var all_match = _.reduce(xpath_lists, function(acc, xpath_list){return acc && _.isEqual(xpath_list[i],first_xpath_list[i]);}, true);
      if (!all_match){ break; }
    }
    var last_matching = i - 1;
    var ancestor_xpath_list = first_xpath_list.slice(0,last_matching+1);
    var ancestor_nodes = xPathToNodes(XPathList.xPathToString(ancestor_xpath_list));
    return ancestor_nodes[0];
  }

  function hasAllSubnodes(node, suffixes){
    var xpath_list = XPathList.xPathToXPathList(nodeToXPath(node));
    //check whether this node has an entry for all desired suffixes
    for (var j = 0; j < suffixes.length; j++){
      var suffix = suffixes[j];
      var suffix_xpath_string = XPathList.xPathToString(xpath_list.concat(suffix));
      var suffix_nodes = xPathToNodes(suffix_xpath_string);
      if (suffix_nodes.length === 0){
        return false;
      }
      return true;
    }
  }

  function findSiblingAtLevelIIndexJ(xpath_list, i, j, suffixes){
    xpath_list[i].index = j;
    var xpath_string = XPathList.xPathToString(xpath_list); 
    var nodes = xPathToNodes(xpath_string); // the node at index j, because we updated the index in xpath_list
    xpath_list[i].index = index; // set it back to the original index since we may be using it later
    if (nodes.length > 0) { 
      // awesome.  there's actually a node at this xpath.  let's make it our candidate node
      var candidateNode = nodes[0];
      if (hasAllSubnodes(candidateNode, suffixes)){
        return candidateNode;
      }
    }
    return null;
  }

  // find a sibling of the argument node that also has all the suffixes
  function findSibling(node, suffixes){
    var xpath_list = XPathList.xPathToXPathList(nodeToXPath(node));
    var xpath_list_length = xpath_list.length;
    for (var i = (xpath_list.length - 1); i >= 0; i--){ // start at the end of the xpath, move back towards root
      var index = parseInt(xpath_list[i].index); // at this component of the xpath, what index?
      var candidateNode = findSiblingAtLevelIIndexJ(xpath_list, i, index + 1, suffixes); // try one index over
      if (candidateNode !== null) {return candidateNode;}
      if (index > 0){
        // ok, adding 1 to our index didn't work.  but we started above 0, so let's try subtracting 1
        var candidateNode = findSiblingAtLevelIIndexJ(xpath_list, i, index - 1, suffixes); // subtracting
        if (candidateNode !== null) {return candidateNode;}
      }
    }
    return null;
  }

  function suffixesFromNodeAndSubnodes(node, subnodes){
    var nodexpl = XPathList.xPathToXPathList(nodeToXPath(node));
    var nodexpllength = nodexpl.length;
    suffixes = [];
    for (var i = 0; i < subnodes.length; i++){
      var subnodexpl = XPathList.xPathToXPathList(nodeToXPath(subnodes[i]));
      var suffix = subnodexpl.slice(nodexpllength, subnodexpl.length);
      suffixes.push(suffix);
    }
    return suffixes;
  }

  var almost_all_features = _.without(RelationFinder.all_features, "xpath");

  function synthesizeSelector(features){
    if(typeof(features)==='undefined') {features = ["tag", "xpath"];}
    
    var feature_dict = featureDict(features, positive_nodes);
    if (feature_dict.hasOwnProperty("xpath") && feature_dict["xpath"].length > 3 && features !== almost_all_features){
      //xpath alone can't handle our positive nodes
      return synthesizeSelector(almost_all_features);
    }
    //if (feature_dict.hasOwnProperty("tag") && feature_dict["tag"].length > 1 && features !== all_features){
    //  return synthesizeSelector(all_features);
    //}
    var rows = interpretListSelector(feature_dict, false, suffixes);
    console.log("rows", rows);
    
    //now handle negative examples
    var exclude_first = false;
    for (var j = 0; j < rows.length; j++){
      var nodes = rows[j];
      for (var i = 0; i < nodes.length ; i++){
        var node = nodes[i];
        if (_.contains(negative_nodes, node)){
          if (j === 0){
            exclude_first = true;
          }
          else if (features !== almost_all_features) {
            //xpaths weren't enough to exclude nodes we need to exclude
            console.log("need to try more features.");
            return synthesizeSelector(almost_all_features);
          }
          else {
            console.log("using all our features and still not working.  freak out.");
            console.log(feature_dict);
            //we're using all our features, and still haven't excluded
            //the ones we want to exclude.  what do we do?  TODO
          }
        }
      }
    }
    
    return {"dict": feature_dict, "exclude_first": exclude_first, "suffixes": suffixes};
  }

  function featureDict(features, positive_nodes){
    //initialize empty feature dict
    var feature_dict = {};
    for (var i = 0; i < features.length; i++){
      feature_dict[features[i]] = {"values":[],"pos":true};
    }
    //add all positive nodes' values into the feature dict
    for (var i = 0; i < positive_nodes.length; i++){
      var node = positive_nodes[i];
      for (var j = 0; j < features.length; j++){
        var feature = features[j];
        var value = getFeature(node,feature);
        feature_dict[feature]["values"].push(value);
      }
    }

    console.log("featureDict feature_dict", feature_dict);
    
    //where a feature has more then 3 values, it's too much
    //also need to handle xpath differently, merging to xpaths with *s
    var filtered_feature_dict = {};
    for (var feature in feature_dict){
      var values = collapseValues(feature, feature_dict[feature]["values"]);
      console.log(feature, values.length, positive_nodes.length);
      if (feature === "xpath" || (values.length <= 3 && values.length !== positive_nodes.length)){
        console.log("accept feature: ", feature);
        filtered_feature_dict[feature] = {"values":values,"pos":true};
      }
    }

    console.log("returning featureDict filtered_feature_dict", filtered_feature_dict);
    return filtered_feature_dict;
  }

  pub.synthesizeFromSingleRow = function(rowNodes){
    var ancestor = findCommonAncestor(rowNodes);
    var positive_nodes = [ancestor];
    var suffixes = suffixesFromNodeAndSubnodes(ancestor, rowNodes);
    var likeliest_sibling = findSibling(ancestor, suffixes);
    if (likeliest_sibling !== null){
      positive_nodes.push(likeliest_sibling);
    }
    return synthesizeSelector();
  }

  function combinations(arr) {
      var ps = [[]];
      for (var i=0; i < arr.length; i++) {
          for (var j = 0, len = ps.length; j < len; j++) {
              ps.push(ps[j].concat(arr[i]));
          }
      }
      return ps;
  }

  function synthesizeSelectorForSubsetThatProducesLargestRelation(rowNodes){
    var combos = combinations(rowNodes);
    var maxNumCells = 0;
    var maxSelector = null;
    for (var i = 0; i < combos.length; i++){
      var combo = combos[i];
      if (combo.length < 1){ continue; }
      var selector = SelectorSynthesis.synthesizeFromSingleRow(combo);
      var relation = RelationFinder.interpretRelationSelector(selector);
      var numCells = combo.length * relation.length;
      if (numCells > maxNumCells){
        maxNumCells = numCells;
        maxSelector = selector;
        console.log(maxSelector);
        console.log(relation);
      }
    }
    return maxSelector;
  }

  pub.likelyRelation = function(msg){
    var nodes = [];
    var xpaths = msg.xpaths;
    for (var i = 0; i < xpaths.length; i++){
      nodes.push(xPathToNodes(xpaths[i])[0]);
    }
    return synthesizeSelectorForSubsetThatProducesLargestRelation(nodes);
  }

return pub;}());