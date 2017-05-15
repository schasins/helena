/**********************************************************************
 * Author: S. Chasins
 **********************************************************************/

var RelationFinder = (function _RelationFinder() { var pub = {};

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

   var all_features = ["tag", "class", 
   "left", "bottom", "right", "top", "width", "height",
   "font-size", "font-family", "font-style", "font-weight", "color",
   "background-color", 
   "preceding-text", "text",
   "xpath"];

    var almost_all_features = _.without(all_features, "xpath");

   function getFeature(element, feature){
    if (feature === "xpath"){
      return XPathList.xPathToXPathList(nodeToXPath(element));
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
      return XPathList.xPathReduction(values);
    }
    return _.uniq(values);
  }

  function makeSubcomponentFunction(suffixes){
    var subcomponentFunction = function(candidateRow){
      var candidate_subitems = [];
      var candidate_xpath = XPathList.xPathToXPathList(nodeToXPath(candidateRow));
      var null_subitems = 0;
      for (var j = 0; j < suffixes.length; j++){
        // note that suffixes[j] will be depth 2 if only one suffix available, depth 3 if list of suffixes available; todo: clean that up
        var suffixLs = suffixes[j];
        if (MiscUtilities.depthOf(suffixLs) < 3){ // <3 rather than === 2 because we use empty suffix for single-col datasets
          suffixLs = [suffixLs];
        }
        var foundSubItem = false;
        for (var k = 0; k < suffixLs.length; k++){
          var xpath = candidate_xpath.concat(suffixLs[k]);
          var xpath_string = XPathList.xPathToString(xpath);
          var nodes = xPathToNodes(xpath_string);
          if (nodes.length > 0){
            candidate_subitems.push(nodes[0]);
            foundSubItem = true;
            break;
          }
        }
        if (!foundSubItem){
          // uh oh, none of the suffixes available to us were able to actually find a node
          null_subitems += 1;
          candidate_subitems.push(null);
        }
      }
      if (candidate_subitems.length > 0 && candidate_subitems.length > null_subitems){
        return candidate_subitems;
      }
      return null;
    };
    return subcomponentFunction;
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
  pub.interpretRelationSelectorHelper = function _interpretRelationSelectorHelper(feature_dict, exclude_first, subcomponents_function){
    // WALconsole.log("interpretRelationSelectorHelper", feature_dict, exclude_first, subcomponents_function);
    var candidates = getAllCandidates();
    var list = [];
    for (i=0;i<candidates.length;i++){
      var candidate = candidates[i];
      var candidate_ok = true;
      for (var feature in feature_dict){
        var value = getFeature(candidate,feature);
        var acceptable_values = feature_dict[feature].values;
        var pos = feature_dict[feature].pos;
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
    if (exclude_first > 0 && list.length > exclude_first){
      return list.slice(exclude_first,list.length);
    }
    WALconsole.log(list);
    return list;
  };

  pub.interpretRelationSelector = function _interpretRelationSelector(selector){
    if (selector.selector.constructor === Array){
      var selectorArray = selector.selector;
      for (var i = 0; i < selectorArray.length; i++){
        var possibleSelector = selectorArray[i];
        selector.selector = possibleOutput;
        var possibleOutput = pub.interpretRelationSelector(possibleOutput);
        if (possibleOutput.length > 0){
          selector.selector = selectorArray;
          return possibleOutput;
        }
      }
      WALconsole.warn("None of our possible selectors seems to work.");
      return [];
    }
    if (selector.selector.table === true){
      // let's go ahead and sidetrack off to the table extraction routine
      return pub.interpretTableSelector(selector.selector, selector.exclude_first, selector.columns);
    }
    var suffixes = _.pluck(selector.columns, "suffix");
    WALconsole.log("interpretRelationSelector", selector);
    return pub.interpretRelationSelectorHelper(selector.selector, selector.exclude_first, makeSubcomponentFunction(suffixes));
  };

  pub.interpretTableSelector = function _interpretTableSelector(featureDict, excludeFirst, columns){
    // we don't use this for nested tables!  this is just for very simple tables, otherwise we'd graduate to the standard approach
    var nodes = xPathToNodes(featureDict.xpath);
    var table = null;
    if (nodes.length > 0){
      // awesome, we have something at the exact xpath
      table = $(nodes[0]);
    }
    else {
      // ok, I guess we'll have to see which table on the page is closest
      var tables = $("table");
      var bestTableScore = Number.POSITIVE_INFINITY;

      _.each(tables, function(t){
        var distance = MiscUtilities.levenshteinDistance(nodeToXPath(t), featureDict.xpath);
        if (distance < bestTableScore){
          bestTableScore = distance;
          table = $(t);
        }
      })
    }

    // ok, now we know which table to use

    if (table === null){
      return []; // todo: why is this arising?
    }

    var rows = table.find("tr");
    rows = rows.slice(excludeFirst, rows.length);

    // now we'll use the columns info to actually get the cells
    var suffixes = _.pluck(columns, "suffix");
    var subcomponentsFunction = makeSubcomponentFunction(suffixes);
    var cells = _.map(rows, function(row){return subcomponentsFunction(row);});
    return cells;
  }

/**********************************************************************
 * How to actually synthesize the selectors used by the relation-finder above
 **********************************************************************/

  function findCommonAncestor(nodes){
    // this doesn't handle null nodes, so filter those out first
    nodes = _.filter(nodes, function(node){return node !== null && node !== undefined;});
    var xpath_lists = _.map(nodes, function(node){ return XPathList.xPathToXPathList(nodeToXPath(node)); });
    if (xpath_lists.length === 0){
      WALconsole.log("Why are you trying to get the common ancestor of 0 nodes?");
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
      xpath_list[i].index = index; // set it back to the original index since we may be using it later
    }
    return null;
  }

  function suffixFromAncestor(ancestor, descendant){
    var axpl = XPathList.xPathToXPathList(nodeToXPath(ancestor));
    var dxpl = XPathList.xPathToXPathList(nodeToXPath(descendant));
    var suffix = dxpl.slice(axpl.length, dxpl.length);
    return suffix;
  }

  function columnsFromNodeAndSubnodes(node, subnodes){
    columns = [];
    for (var i = 0; i < subnodes.length; i++){
      var xpath = nodeToXPath(subnodes[i]);
      var suffix = suffixFromAncestor(node, subnodes[i]);
      columns.push({xpath: xpath, suffix: suffix, id: null});
    }
    return columns;
  }

  function Selector(dict, exclude_first, columns, positive_nodes, negative_nodes){
    return {selector: dict, exclude_first: exclude_first, columns: columns, positive_nodes: positive_nodes, negative_nodes: negative_nodes};
  }

  function synthesizeSelector(positive_nodes, negative_nodes, columns, features){
    if(typeof(features)==='undefined') {features = ["tag", "xpath"];}
    
    var feature_dict = featureDict(features, positive_nodes);
    if (feature_dict.hasOwnProperty("xpath") && feature_dict["xpath"].length > 3 && features !== almost_all_features){
      //xpath alone can't handle our positive nodes
      return synthesizeSelector(positive_nodes, negative_nodes, columns, almost_all_features);
    }
    //if (feature_dict.hasOwnProperty("tag") && feature_dict["tag"].length > 1 && features !== all_features){
    //  return synthesizeSelector(all_features);
    //}
    var rows = pub.interpretRelationSelector(Selector(feature_dict, false, columns));
    
    //now handle negative examples
    var exclude_first = 0;
    for (var j = 0; j < rows.length; j++){
      var nodes = rows[j];
      for (var i = 0; i < nodes.length ; i++){
        var node = nodes[i];
        if (_.contains(negative_nodes, node)){
          if (j === 0){
            exclude_first = 1;
          }
          else if (features !== almost_all_features) {
            //xpaths weren't enough to exclude nodes we need to exclude
            WALconsole.log("need to try more features.");
            return synthesizeSelector(positive_nodes, negative_nodes, columns, almost_all_features);
          }
          else {
            WALconsole.log("using all our features and still not working.  freak out.");
            WALconsole.log(feature_dict);
            //we're using all our features, and still haven't excluded
            //the ones we want to exclude.  what do we do?  TODO
          }
        }
      }
    }
    return Selector(feature_dict, exclude_first, columns, positive_nodes, negative_nodes);
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

    WALconsole.log("featureDict feature_dict", feature_dict);
    
    //where a feature has more then 3 values, it's too much
    //also need to handle xpath differently, merging to xpaths with *s
    var filtered_feature_dict = {};
    for (var feature in feature_dict){
      var values = collapseValues(feature, feature_dict[feature]["values"]);
      WALconsole.log(feature, values.length, positive_nodes.length);
      if (feature === "xpath" || (values.length <= 3 && values.length !== positive_nodes.length)){
        WALconsole.log("accept feature: ", feature);
        filtered_feature_dict[feature] = {"values":values,"pos":true};
      }
    }

    WALconsole.log("returning featureDict filtered_feature_dict", filtered_feature_dict);
    return filtered_feature_dict;
  }

  function synthesizeEditedSelectorFromOldSelector(currentSelectorToEdit){
    var newSelector = synthesizeSelector(currentSelectorToEdit.positive_nodes, currentSelectorToEdit.negative_nodes, currentSelectorToEdit.columns);
    // now remember -- must keep the features of the old selector that don't relate to the actual row selector
    newSelector.next_type = currentSelectorToEdit.next_type;
    newSelector.next_button_selector = currentSelectorToEdit.next_button_selector;
    newSelector.name = currentSelectorToEdit.name;
    newSelector.id = currentSelectorToEdit.id;
    newSelector.url = currentSelectorToEdit.url;
    return newSelector;
  }
    

  pub.synthesizeFromSingleRow = function _synthesizeFromSingleRow(rowNodes){
    var ancestor = findCommonAncestor(rowNodes);
    var positive_nodes = [ancestor];
    var columns = columnsFromNodeAndSubnodes(ancestor, rowNodes);
    var suffixes = _.pluck(columns, "suffix");
    var likeliest_sibling = findSibling(ancestor, suffixes);
    if (likeliest_sibling !== null){
      positive_nodes.push(likeliest_sibling);
    }
    return synthesizeSelector(positive_nodes, [], columns);
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

  function synthesizeSelectorForSubsetThatProducesLargestRelation(rowNodes, smallestSubsetToConsider){
    // todo: in future, can we just order the combos by number of rowNodes included in the combo, stop once we get one that has a good selector?
    // could this avoid wasting so much time on this?  even in cases where we don't already have server-suggested to help us with smallestSubsetToConsider?
    var combos = combinations(rowNodes);
    var maxNumCells = -1;
    var maxSelector = null;
    for (var i = 0; i < combos.length; i++){
      // the if below is an inefficient way to do this!  do it better in future!  just make the smaller set of combos! todo
      if (combos.length < smallestSubsetToConsider){
        continue;
      }
      var combo = combos[i];
      if (combo.length < 1){ continue; }
      var selector = pub.synthesizeFromSingleRow(combo);
      WALconsole.log("selector", selector);
      var relation = pub.interpretRelationSelector(selector);
      var numCells = combo.length * relation.length;
      if (numCells > maxNumCells){
        maxNumCells = numCells;
        maxSelector = selector;
        WALconsole.log("maxselector", maxSelector);
        WALconsole.log("relation", relation);
      }
    }
    if (!maxSelector){
      return null;
    }
    maxSelector.relation = relation;
    return maxSelector;
  }

  function tableFeatureDict(tableNode){
    return {table: true, xpath: nodeToXPath(tableNode)};
  }

  function jqueryIndexOf(list, item){
    for (var i = 0; i < list.length; i++){
      if (list[i] === item){
        return i;
      }
    }
    return -1;
  }

  function synthesizeSelectorForWholeSetTable(rowNodes){
    WALconsole.log(rowNodes);
    var parents = $(rowNodes[0]).parents();
    var trs = [];
    for (var i = 0; i < parents.length; i++){
      if (parents[i].tagName === "TR"){
        trs.push(parents[i]);
        // for the time being, we're choosing not to deal with nested tables;  may ultimately want to return and do more; todo.
        break;
      }
    }

    if (trs.length === 0){
      WALconsole.log("No tr parents.");
      return null;
    }

    var parentLists = _.map(rowNodes, function(rowNode){return $(rowNode).parents();});
    var acceptedTrs = [];  // there could in fact be multiple, if we have nested tables...not totally sure how want to do multiples, but for now we'll just assume we want the one with the most cells
    _.each(trs, function(tr){
      var allInRow = _.reduce(parentLists, function(acc, parentList) {return acc && jqueryIndexOf(parentList, tr) > -1;}, true);
      if (allInRow){
        acceptedTrs.push(tr);
      }
    });

    if (acceptedTrs.length === 0){
      WALconsole.log("No shared tr parents.");
      return null;
    }

    var bestScore = 0;
    var bestSelector = null;
    for (var i = 0; i < acceptedTrs.length; i++){
      var tr = acceptedTrs[i];
      var parents = $(tr).parents();
      var tableParent = null;
      for (var j = 0; j < parents.length; j++){
        if (parents[j].tagName === "TABLE"){
          tableParent = parents[j];
          break;
        }
      }
      var children = $(tableParent).find("tr");
      var index = jqueryIndexOf(children, tr); // using this as the number of rows to exclude from the top of the table, since the rowNodes arg should represent first row of target table
      if (index === -1){
        throw "hey, we already know these are all part of one tr";
      }
      var featureDict = tableFeatureDict(tableParent);
      var cellNodes = _.union($(tr).find("td, th").toArray(), rowNodes); // we'll make columns for each argument node of course, but let's also do all the td elements
      var selector = Selector(featureDict, index, columnsFromNodeAndSubnodes(tr, cellNodes), rowNodes, []);
      var relation = pub.interpretRelationSelector(selector);
      selector.relation = relation;
      var score = relation.length * relation[0].length;
      if (score > bestScore){
        bestScore = score;
        bestSelector = selector;
      }
    }

    return bestSelector;
  }

  function numMatchedXpaths(targetXpaths, firstRow){
    var firstRowXpaths = _.pluck(firstRow, "xpath");
    var matchedXpaths = _.intersection([targetXpaths, firstRowXpaths]);
    return matchedXpaths.length;
  }

  function recordComparisonAttributesNewSelector(selectorData, targetXpaths){
    var rel = selectorData.relation;
    selectorData.numMatchedXpaths = numMatchedXpaths(targetXpaths, rel[0]);
    selectorData.numRows = rel.length;
    selectorData.numRowsInDemo = selectorData.numRows;
    if (rel.length < 1){
      selectorData.numColumns = 0;
    }
    else{
      selectorData.numColumns = rel[0].length;
    }
  }

  function recordComparisonAttributesServerSelector(selectorData, targetXpaths){
    var rel = selectorData.relation;
    selectorData.numMatchedXpaths = numMatchedXpaths(targetXpaths, rel[0]);
    selectorData.numRows = rel.length;
    selectorData.numRowsInDemo = selectorData.num_rows_in_demonstration;
    selectorData.numColumns = rel[0].length;
  }

  function bestSelector(defaultRel, alternativeRel){
    if (defaultRel.numMatchedXpaths > alternativeRel.numMatchedXpaths){
      return defaultRel;
    }
    else if (defaultRel.numMatchedXpaths === alternativeRel.numMatchedXpaths){
      if (defaultRel.numRows > alternativeRel.numRows){
        return defaultRel;
      }
      else if (defaultRel.numRows === alternativeRel.numRows){
        if (defaultRel.numRowsInDemo > alternativeRel.numRowsInDemo){
          return defaultRel;
        }
        else if (defaultRel.numRowsInDemo === alternativeRel.numRowsInDemo){
          if (defaultRel.numColumns > alternativeRel.numColumns){
            return defaultRel;
          }
          else if (defaultRel.numColumns === alternativeRel.numColumns){
            if (defaultRel.next_type !== null && alternativeRel.next_type === null){
              // defaultRel has a next button method, but alternativeRel doesn't, so defaultRel better
              return defaultRel;
            }
            else if (!(alternativeRel.next_type !== null && defaultRel.next_type === null)){
              // it's not the case that altRel has next method and defRel doesn't, so either both have it or neither has it, so they're the same
              // they're the same, so just return the default one
              return defaultRel;
            }
          }
        }
      }
    }
    return alternativeRel;
  }

  var timesToTry = 5;
  var timesTried = 0;
  // todo: does it make any sense to have this here when we have the mainpanel asking multiple times anyway?
  pub.likelyRelationWrapper = function _likelyRelationWrapper(msg){
    var msg = pub.likelyRelation(msg);
    WALconsole.log("msg", msg);
    if (msg){ // a casual way to check if maybe this isn't a serious enough relation.  should probably do better
      timesTried = 0;
      WALconsole.log("msg", msg);
      return msg;
    }
    else if (timesTried <= timesToTry) {
      // you never know...we may need to just wait a little while...
      timesTried += 1;
      return null;
    }
    else{
      // ok, time to give up
      return msg;
    }
  }

  var processedCount = 0;
  var processedLikelyRelationRequest = false;
  pub.likelyRelation = function _likelyRelation(msg){
    if (processedLikelyRelationRequest){
      // should only even send a likely relation once from one page, since it gets closed after we get the answer we wanted
      // may end up sending multiples if we're sent the inciting message multiple times because the page loads slowly
      return;
    }
    var nodes = [];
    var xpaths = msg.xpaths;
    for (var i = 0; i < xpaths.length; i++){
      var node = xPathToNodes(xpaths[i])[0];
      if (!node){
        continue; // todo: this may not be the right thing to do!  for now we're assuming that if we can't find a node at this xpath, it's because we jumbled in the nodes from a different page into the relation for this page (becuase no updat to url or something); but it may just mean that this page changed super super quickly, since the recording
      }
      nodes.push(node);
    }

    var maxNodesCoveredByServerRelations = 0;
    var serverSuggestedRelations = msg.serverSuggestedRelations;
    for (var i = 0; i < serverSuggestedRelations.length; i++){
      var rel = serverSuggestedRelations[i];
      if (rel === null){
        continue;
      }
      var columns = rel.columns;
      var relXpaths = _.pluck(columns, "xpath");
      WALconsole.log(relXpaths);
      var matched = 0;
      for (var j = 0; j < xpaths.length; j++){
        if (relXpaths.indexOf(xpaths[j]) > -1){
          matched += 1;
        }
      }
      if (matched > maxNodesCoveredByServerRelations){
        maxNodesCoveredByServerRelations = matched;
      }
    }
    WALconsole.log("maxNodesCoveredByServerRelations", maxNodesCoveredByServerRelations);

    // if this is actually in an html table, let's take a shortcut, since some sites use massive tables and trying to run the other approach would take forever
    var selectorData = synthesizeSelectorForWholeSetTable(nodes);

    if (selectorData === null){
      // ok, no table, we have to do the standard, possibly slow approach
      selectorData = synthesizeSelectorForSubsetThatProducesLargestRelation(nodes, maxNodesCoveredByServerRelations + 1);
    }
    if (selectorData === null){
      // well, huh.  we just don't know what to do here.
      selectorData = {};
      selectorData.relation = [];
    }
    var relationData = _.map(selectorData.relation, function(row){return _.map(row, function(cell){return NodeRep.nodeToMainpanelNodeRepresentation(cell);});});
    selectorData.relation = relationData;

    // this (above) is the candidate we auto-generate from the page, but want to compare to the relations the server suggested
    // criteria (1) largest number of target xpaths in the first row, (2) largest number of rows retrieved from the page, (3), largest num of rows in original demonstration (4) largest number of columns associated with relation
    // and if it's tied after all of that, pick the one from the server since it might have next interaction associated, might have good col names

    var bestSelectorIsNew = true;
    var currBestSelector = selectorData;
    recordComparisonAttributesNewSelector(selectorData, xpaths);

    var serverSuggestedRelations = msg.serverSuggestedRelations;
    for (var i = 0; i < serverSuggestedRelations.length; i++){
      var rel = serverSuggestedRelations[i];
      if (rel === null){
        continue;
      }
      var selector_obj = Selector(rel.selector, rel.exclude_first, rel.columns);
      var relationNodes = pub.interpretRelationSelector(selector_obj, rel.selector_version);
      if (relationNodes.length === 0){
        // no need to consider empty one
        continue;
      }
      var relationData = _.map(relationNodes, function(row){return _.map(row, function(cell){return NodeRep.nodeToMainpanelNodeRepresentation(cell);});});
      rel.relation = relationData; 
      recordComparisonAttributesServerSelector(rel, xpaths);

      // use the server-provided rel as our default, since that'll make the server-side processing when we save the relation easier, and also gives us the nice names
      var newBestSelector = bestSelector(rel, currBestSelector);
      if (newBestSelector !== currBestSelector){
        currBestSelector = newBestSelector;
        bestSelectorIsNew = false;
      }
    }

    newMsg = {page_var_name: msg.pageVarName, url: window.location.href}; // this pageVarName is used by the mainpanel to keep track of which pages have been handled already
    if (bestSelectorIsNew) {
      newMsg.relation_id = null;
      newMsg.name = null;
      // we always guess that there are no more items (no more pages), and user has to correct it if this is not the case
      newMsg.next_type = NextTypes.NONE;
      newMsg.next_button_selector = null;
    }
    else {
      newMsg.relation_id = currBestSelector.id;
      newMsg.name = currBestSelector.name;
      newMsg.next_type = currBestSelector.next_type;
      newMsg.next_button_selector = currBestSelector.next_button_selector;
    }
    WALconsole.log("currBestSelector", currBestSelector);
    newMsg.exclude_first = currBestSelector.exclude_first;
    newMsg.num_rows_in_demonstration = currBestSelector.relation.length;
    newMsg.selector = currBestSelector.selector;
    newMsg.selector_version = 1; // right now they're all 1.  someday may want to be able to add new versions of selectors that are processed differently
    newMsg.columns = currBestSelector.columns;
    newMsg.first_page_relation = currBestSelector.relation;

    if (currBestSelector.relation.length < 1){
      processedCount += 1;
      if (processedCount < 10){
        // ok, looks like we don't actually have any data yet.  might be because data hasn't fully loaded on page yet
        // the mainpanel will keep asking for likelyrelations, so let's wait a while, see if the next time works; try 10 times
        // todo: not sure this is where we want to deal with this?
        return null;
      }
    }

    //utilities.sendMessage("content", "mainpanel", "likelyRelation", newMsg);
    processedLikelyRelationRequest = true;
    return newMsg; // return rather than sendmessage because it's a builtin response handler one
  }

  pub.getRelationItems = function _getRelationItems(msg, sendMsg){
    if (sendMsg === undefined){ sendMsg = true; }
    var relation = pub.interpretRelationSelector(msg);
    var relationData = pub.relationNodesToMainpanelNodeRepresentation(relation);
    if (sendMsg){
      utilities.sendMessage("content", "mainpanel", "relationItems", {relation: relationData});
    }
    return relationData;
  };

  pub.relationNodesToMainpanelNodeRepresentation = function _relationNodesToMainpanelNodeRepresentation(relationNodes){
    var relationData = _.map(relationNodes, function(row){return _.map(row, function(cell){return NodeRep.nodeToMainpanelNodeRepresentation(cell);});});
    return relationData;
  }

  function selectorId(selectorObject){
    return StableStringify.stringify(selectorObject);
  }

/**********************************************************************
 * Highlight stuff
 **********************************************************************/

  var colors = ["#9EE4FF","#9EB3FF", "#BA9EFF", "#9EFFEA", "#E4FF9E", "#FFBA9E", "#FF8E61"];
  pub.highlightRelation = function _highlightRelation(arrayOfArrays, display, pointerEvents){
    var nodes = [];
    for (var i = 0; i < arrayOfArrays.length ; i++){
      for (var j = 0; j < arrayOfArrays[i].length; j++){
        var node = arrayOfArrays[i][j];
        if (node === null){continue;}
        // first make sure there is a color at index j, add one if there isn't
        if (j >= colors.length){
          colors.push("#000000".replace(/0/g,function(){return (~~(Math.random()*16)).toString(16);}));
        }
        var node = Highlight.highlightNode(node, colors[j], display, pointerEvents);
        nodes.push(node);
      }
    }
    return nodes;
  }

/**********************************************************************
 * Everything we need for editing a relation selector
 **********************************************************************/

  var currentSelectorToEdit = null;
  var initialSelectorEmptyOnThisPage = false;
  pub.editRelation = function _editRelation(msg){
    if (currentSelectorToEdit !== null){
      // we've already set up to edit a selector, and we should never use the same tab to edit multiples
      // always close tab and reload.  so don't run setup again
      return;
    }
    // utilities.sendMessage("mainpanel", "content", "editRelation", {selector: this.selector, selector_version: this.selectorVersion, exclude_first: this.excludeFirst, columns: this.columns}, null, null, [tab.id]);};
    currentSelectorToEdit = msg;
    document.addEventListener('click', editingClick, true);
    // don't try to process the page till it's loaded!  jquery onloaded stuff will run immediately if page already loaded, once loaded else
    var editingSetup = function(){
      pub.setRelation(currentSelectorToEdit);
      if (currentSelectorToEdit.relation.length < 1){
        // ugh, but maybe the page just hasn't really finished loading, so try again in a sec
        //setTimeout(editingSetup, 1000);
	// but also need to send the editing colors just in case
	       pub.sendSelector(currentSelectorToEdit);
         initialSelectorEmptyOnThisPage = true;
        return;
      }
      pub.highlightSelector(currentSelectorToEdit);
      // start with the assumption that the first row should definitely be included
      msg.positive_nodes = [findCommonAncestor(currentSelectorToEdit.relation[0]),findCommonAncestor(currentSelectorToEdit.relation[1])];
      msg.negative_nodes = [];
      pub.sendSelector(currentSelectorToEdit);
      if (msg.next_type === NextTypes.NEXTBUTTON || msg.next_type === NextTypes.MOREBUTTON){
        highlightNextOrMoreButton(msg.next_button_selector);
      }

      // we want to highlight the currently hovered node
      document.addEventListener('mouseenter', highlightHovered, true);

      // also, if we have a selector highlighted, and the user scrolls, we're going to need to update...
      var didScroll = false;
      $("*").scroll(function() {
        didScroll = true;
      });

      setInterval(function() {
        if ( didScroll ) {
          didScroll = false;
          // Ok, we're ready to redo the relation highlighting with new page situation
          WALconsole.log("scroll updating");
          pub.newSelectorGuess(currentSelectorToEdit);
        }
        }, 250);
    };

    $(editingSetup);
  };

  pub.setEditRelationIndex = function _setEditRelationIndex(i){
    currentSelectorToEdit.editingClickColumnIndex = i;
  }

  var currentHoverHighlight = null;
  function highlightHovered(event){
    var prevHoverHighlight = currentHoverHighlight;
    var color = "#9D00FF";
    if (listeningForNextButtonClick){
      color = "#E04343";
    }
    if (prevHoverHighlight) {prevHoverHighlight.remove(); prevHoverHighlight = null;}
    currentHoverHighlight = Highlight.highlightNode(event.target, color);
  }

  pub.setRelation = function _setRelation(selectorObj){
    selectorObj.relation = pub.interpretRelationSelector(selectorObj);
    selectorObj.num_rows_in_demo = selectorObj.relation.length;
  };

  pub.highlightSelector = function _highlightSelector(selectorObj){
    return pub.highlightRelation(selectorObj.relation, true, true); // we want to allow clicks on the highlights (see editingClick)
  };

  pub.sendSelector = function _sendSelector(selectorObj){
    var relation = selectorObj.relation;
    var relationData = _.map(relation, function(row){return _.map(row, function(cell){return NodeRep.nodeToMainpanelNodeRepresentation(cell);});}); // mainpanel rep version
    selectorObj.demonstration_time_relation = relationData;
    selectorObj.relation = null; // don't send the relation
    selectorObj.colors = colors;
    utilities.sendMessage("content", "mainpanel", "editRelation", selectorObj);
    selectorObj.relation = relation; // restore the relation
  };

  var currentSelectorHighlightNodes = [];
  pub.newSelectorGuess = function _newSelectorGuess(selectorObj){
    pub.setRelation(selectorObj);
    for (var i = 0; i < currentSelectorHighlightNodes.length; i++){
      Highlight.clearHighlight(currentSelectorHighlightNodes[i]);
    }
    currentSelectorHighlightNodes = pub.highlightSelector(selectorObj);
    pub.sendSelector(selectorObj);
  }

  function findAncestorLikeSpec(spec_ancestor, node){
    //will return exactly the same node if there's only one item in first_row_items
    WALconsole.log("findAncestorLikeSpec", spec_ancestor, node);
    var spec_xpath_list = XPathList.xPathToXPathList(nodeToXPath(spec_ancestor));
    var xpath_list = XPathList.xPathToXPathList(nodeToXPath(node));
    var ancestor_xpath_list = xpath_list.slice(0,spec_xpath_list.length);
    var ancestor_xpath_string = XPathList.xPathToString(ancestor_xpath_list);
    var ancestor_xpath_nodes = xPathToNodes(ancestor_xpath_string);
    return ancestor_xpath_nodes[0];
  }

  var targetsSoFar = [];
  function editingClick(event){
    if (listeningForNextButtonClick){
      // don't want to do normal editing click...
      nextButtonSelectorClick(event);
      return;
    }

    event.stopPropagation();
    event.preventDefault();

    var target = event.target;

    if (initialSelectorEmptyOnThisPage){
      // ok, it's empty right now, need to make a new one
      if (!currentSelectorToEdit.selectorArr){
        currentSelectorToEdit.selectorArr = [currentSelectorToEdit.selector]
      }
      targetsSoFar.push(target);
      var newSelector = pub.synthesizeFromSingleRow(targetsSoFar);
      currentSelectorToEdit.currentIndividualSelector = newSelector
      currentSelectorToEdit.selector = [newSelector].concat(currentSelectorToEdit.selectorArr)
      //currentSelectorToEdit = newSelector;
      pub.newSelectorGuess(currentSelectorToEdit);
      // and let's go back to using .selector as the current one we want to edit and play with
      currentSelectorToEdit.selector = currentSelectorToEdit.currentIndividualSelector;
      return;
    }

    var removalClick = false;
    // it's only a removal click if the clicked item is a highlight
    if (Highlight.isHighlight(target)){
      removalClick = true;
      // actual target is the one associated with the highlight
      target = Highlight.getHighligthedNodeFromHighlightNode(target);
      var nodeToRemove = target; // recall the target itself may be the positive example, as when there's only one column
      if (currentSelectorToEdit.positive_nodes.indexOf(target) < 0){
        // ok it's not the actual node, better check the parents
        var parents = $(target).parents(); 
        for (var i = parents.length - 1; i > 0; i--){
          var parent = parents[i];
          var index = currentSelectorToEdit.positive_nodes.indexOf(parent);
          if ( index > -1){
            // ok, so this click is for removing a node.  removing the row?  removing the column?
            // not that useful to remove a column, so probably for removing a row...
            nodeToRemove = parent;
            break;
          }
        }
      }
      // actually remove the node from positive, add to negative
      var ind = currentSelectorToEdit.positive_nodes.indexOf(nodeToRemove);
      currentSelectorToEdit.positive_nodes.splice(ind, 1);
      currentSelectorToEdit.negative_nodes.push(nodeToRemove);
    }
    // we've done all our highlight stuff, know we no longer need that
    // dehighlight our old list
    _.each(currentSelectorHighlightNodes, Highlight.clearHighlight);

    if (!removalClick){
      // ok, so we're trying to add a node.  is the node another cell in an existing row?  or another row?  could be either.
      // for now we're assuming it's always about adding rows, since it's already possible to add columns by demonstrating first row

      var newCellInExistingRow = false;
      if (newCellInExistingRow){
        // for now, assume it's another cell in an existing row
        // todo: give the user an interaction that allows him or her say it's actually another row
        // todo: put some kind of outline around the ones we think of the user as having actually demonstrated to us?  the ones we're actually using to generate the selector?  so that he/she knows which to actually click on to change things
        // maybe green outlines (or color-corresponding outlines) around the ones we're trying to include, red outlines around the ones we're trying to exclude.

        // let's figure out which row it should be
        // go through all rows, find common ancestor of the cells in the row + our new item, pick whichever row produces an ancestor deepest in the tree
        var currRelation = currentSelectorToEdit.relation;
        var deepestCommonAncestor = null;
        var deepestCommonAncestorDepth = 0;
        var currRelationIndex = 0;
        for (var i = 0; i < currRelation.length; i++){
          var nodes = currRelation[i];
          var ancestor = findCommonAncestor(nodes.concat([target]));
          var depth = $(ancestor).parents().length;
          if (depth > deepestCommonAncestorDepth){
            deepestCommonAncestor = ancestor;
            deepestCommonAncestorDepth = depth;
            currRelationIndex = i;
          }
        }

        var columns = columnsFromNodeAndSubnodes(deepestCommonAncestor, currRelation[currRelationIndex].concat([target]));
        currentSelectorToEdit.columns = columns;

        // let's check whether the common ancestor has actually changed.  if no, this is easy and we can just change the columns
        // if yes, it gets more complicated
        var origAncestor = findCommonAncestor(currRelation[currRelationIndex]);
        var newAncestor = findCommonAncestor(currRelation[currRelationIndex].concat([target]));
        if (origAncestor === newAncestor){
          // we've already updated the columns, so we're ready
          pub.newSelectorGuess(currentSelectorToEdit);
          return;
        }
        // drat, the ancestor has actually changed.
        // let's assume that all the items in our current positive nodes list will have *corresponding* parent nodes...  (based on difference in depth.  not really a good assumption, but we already assume that we have fixed xpaths to get to subcomponents, so we're already making that assumption)
        var xpath = nodeToXPath(newAncestor);
        var xpathlen = xpath.split("/").length;
        var xpathO = nodeToXPath(origAncestor);
        var xpathlenO = xpath.split("/").length;
        var depthDiff = xpathlenO - xpathlen;
        for (var i = 0; i < currentSelectorToEdit.positive_nodes.length; i++){
          var ixpath = nodeToXPath(currentSelectorToEdit.positive_nodes[i]);
          var components = ixpath.split("/");
          components = components.slice(0, components.length - depthDiff);
          var newxpath = components.join("/");
          currentSelectorToEdit.positive_nodes[i] = xPathToNodes(newxpath)[0];
        }
        if (currentSelectorToEdit.positive_nodes.indexOf(deepestCommonAncestor) === -1){
          currentSelectorToEdit.positive_nodes.push(deepestCommonAncestor);
        }
      }
      else{
        // this one's the easy case!  the click is telling us to add a row, rather than to add a cell to an existing row
        // or it may be telling us to add a cell in an existing row to an existing column, which also should not require us to change
        // the ancestor node.  if it does require changing the ancestor node,then we will run into trouble bc won't find appropriate ancestor
        // todo: better structure available here?  maybe merge this and the above?
        var appropriateAncestor = findAncestorLikeSpec(currentSelectorToEdit.positive_nodes[0], target);
        var currColumnObj = currentSelectorToEdit.columns[currentSelectorToEdit.editingClickColumnIndex];
        var currSuffixes = currColumnObj.suffix;
        if (MiscUtilities.depthOf(currSuffixes) < 3){
          // when we have only one suffix, we don't store it in a list, but the below is cleaner if we just have a list; todo: clean up
          currSuffixes = [currSuffixes];
        }

        // is this suffix already in our suffixes?  if yes, we can just add the ancestor/row node, don't need to mess with columns
        var newSuffix = suffixFromAncestor(appropriateAncestor, target);
        var newSuffixAlreadyPresent = _.reduce(currSuffixes, function(acc, currSuffix){return acc || _.isEqual(currSuffix, newSuffix);}, false);
        if (!newSuffixAlreadyPresent){
          // ok it's not in our current suffixes, so we'll have to make the new suffixes list
          currSuffixes.push(newSuffix);     
          currColumnObj.suffix = currSuffixes;     
        }
    
        // is this ancestor node already in our positive_nodes?  if no, make new selector.  if yes, we're already set
        if (currentSelectorToEdit.positive_nodes.indexOf(appropriateAncestor) === -1){
          // this ancestor node (row node) is new to us, better add it to the positive examples
          currentSelectorToEdit.positive_nodes.push(appropriateAncestor);
        }
      }

    }

    var newSelector = synthesizeEditedSelectorFromOldSelector(currentSelectorToEdit);
    currentSelectorToEdit = newSelector;
    pub.newSelectorGuess(currentSelectorToEdit);
  }

/**********************************************************************
 * Handling next buttons
 **********************************************************************/

  var listeningForNextButtonClick = false;
  pub.nextButtonSelector = function _nextButtonSelector(){
    // ok, now we're listening for a next button click
    listeningForNextButtonClick = true;
    pub.clearNextButtonSelector(); // remove an old one if there is one
  };

  pub.clearNextButtonSelector = function _clearNextButtonSelector(){
    // we just want to unhighlight it if there is one...
    unHighlightNextOrMoreButton();
  };

  function nextButtonSelectorClick(event){
    listeningForNextButtonClick = false;

    event.stopPropagation();
    event.preventDefault();
    
    var next_or_more_button = $(event.target);
    var data = {};
    data.tag = next_or_more_button.prop("tagName");
    data.text = next_or_more_button.text();
    data.id = next_or_more_button.attr("id");
    data.src = next_or_more_button.prop('src');
    data.xpath = nodeToXPath(event.target);
    data.frame_id = SimpleRecord.getFrameId();
    
    utilities.sendMessage("content", "mainpanel", "nextButtonSelector", {selector: data});
    highlightNextOrMoreButton(data);
  }

  function rightText(next_button_data, node){
    // either there's an actual image and it's the same, or the text is the same
    if (next_button_data.src){
      return (node.prop('src') === next_button_data.src);
    }
    return (node.text() === next_button_data.text);
  }

  function findNextButton(next_button_data){
    WALconsole.log(next_button_data);
    var next_or_more_button_tag = next_button_data.tag;
    var next_or_more_button_text = next_button_data.text;
    var next_or_more_button_id = next_button_data.id;
    var next_or_more_button_xpath = next_button_data.xpath;
    var next_or_more_button_src = next_button_data.src;
    var button = null;
    var candidate_buttons = $(next_or_more_button_tag).filter(function(){ return rightText(next_button_data, $(this));});
    //hope there's only one button
    if (candidate_buttons.length === 1){
      button = candidate_buttons[0];
    }
    else{
      //if not and demo button had id, try using the id
      if (next_or_more_button_id !== undefined && next_or_more_button_id !== ""){
        button = $("#"+next_or_more_button_id);
      }
      else{
        //see which candidate has the right text and closest xpath
        var min_distance = 999999;
        var min_candidate = null;
        for (var i=0; i<candidate_buttons.length; i++){
          candidate_xpath = nodeToXPath(candidate_buttons[i]);
          var distance = MiscUtilities.levenshteinDistance(candidate_xpath,next_or_more_button_xpath);
          if (distance<min_distance){
            min_distance = distance;
            min_candidate = candidate_buttons[i];
          }
        }
        if (min_candidate === null){
          WALconsole.log("couldn't find an appropriate 'more' button");
          WALconsole.log(next_or_more_button_tag, next_or_more_button_id, next_or_more_button_text, next_or_more_button_xpath);
        }
        button = min_candidate;
      }
    }
    console.log("button", button);
    return button;
  }

  var nextOrMoreButtonHighlight = null;
  function highlightNextOrMoreButton(selector){
    WALconsole.log(selector);
    var button = findNextButton(selector);
    nextOrMoreButtonHighlight = Highlight.highlightNode(button, "#E04343", true);
  }

  function unHighlightNextOrMoreButton(){
    if (nextOrMoreButtonHighlight !== null){
      Highlight.clearHighlight(nextOrMoreButtonHighlight);
    }
  }

/**********************************************************************
 * Handling everything we need for actually running the next interactions during replays
 **********************************************************************/

  var nextInteractionSinceLastGetFreshRelationItems = {}; // this will be adjusted when we're in the midst of running next button interactions
  var currentRelationData = {};
  var currentRelationSeenNodes = {};
  var noMoreItemsAvailable = {};

  // below the methods for actually using the next button when we need the next page of results
  // this also identifies if there are no more items to retrieve, in which case that info is stored in case someone tries to run getFreshRelationItems on us
  pub.runNextInteraction = function _runNextInteraction(msg){

    utilities.sendMessage("content", "mainpanel", "runningNextInteraction", {}); // todo: will this always reach the page?  if not, big trouble
    var sid = selectorId(msg);
    nextInteractionSinceLastGetFreshRelationItems[sid] = true; // note that we're assuming that the next interaction for a given relation only affects that relation

    var next_button_type = msg.next_type;

    if (next_button_type === NextTypes.SCROLLFORMORE){
      WALconsole.namedLog("nextInteraction", "scrolling for more");
      var crd = currentRelationData[sid];
      var knowTheLastElement = false;
      // let's try scrolling to last element if we know it
      if (crd && crd.length > 0 && crd[crd.length - 1] && crd[crd.length - 1].length > 0){
        var lastRowReps = crd[crd.length - 1];
        var lastElementXpath = lastRowReps[lastRowReps.length - 1].xpath;
        var lastElementNodes = xPathToNodes(lastElementXpath);
        if (lastElementNodes.length > 0){
          var lastElement = lastElementNodes[0];
          lastElement.scrollIntoView();
          knowTheLastElement = true;
        }
      }
      // but if we don't know it, just try scrolling window to the bottom
      // sadly, this doesn't work for everything.  (for instance, if have an overlay with a relation, the overlay may not get scrolled w window scroll)
      if (!knowTheLastElement){
        window.scrollTo(0, document.body.scrollHeight);
      }
    }
    else if (next_button_type === NextTypes.MOREBUTTON || next_button_type === NextTypes.NEXTBUTTON){
      WALconsole.namedLog("nextInteraction", "msg.next_button_selector", msg.next_button_selector);
      var button = findNextButton(msg.next_button_selector);
      if (button !== null){
        WALconsole.namedLog("nextInteraction", "clicked next or more button");
        button.click();
        /*
        $button = $(button);
        $button.trigger("mousedown");
        //$button.trigger("focus");
        $button.trigger("mouseup");
        $button.trigger("click");
        //$button.trigger("blur");
        */
      }
      else{
        WALconsole.namedLog("nextInteraction", "next or more button was null");
        noMoreItemsAvailable[sid] = true;
      }
    }
    else if (next_button_type === NextTypes.NONE){
      noMoreItemsAvailable[sid] = true;
    }
    else{
      WALconsole.namedLog("nextInteraction", "Failure.  Don't know how to produce items because don't know next button type.  Guessing we just want the current page items.");
      noMoreItemsAvailable[sid] = true;
    }
  }

  pub.getFreshRelationItems = function _getFreshRelationItems(msg){
    var respMsg = pub.getFreshRelationItemsHelper(msg);
    console.log('respMsg', respMsg);
    utilities.sendMessage("content", "mainpanel", "freshRelationItems", respMsg);
  }

  relationFinderIdCounter = 0;
  pub.getFreshRelationItemsHelper = function _getFreshRelationItemsHelper(msg){
    var strMsg = selectorId(msg);
    WALconsole.log("noMoreItemsAvailable", noMoreItemsAvailable[strMsg], noMoreItemsAvailable);
    if (noMoreItemsAvailable[strMsg]){
      // that's it, we're done.  last use of the next interaction revealed there's nothing left
      console.log("no more items at all, because noMoreItemsAvailable was set.");
      return {type: RelationItemsOutputs.NOMOREITEMS, relation: null};
    }
    // below is commented out in case there are cases where after first load, it may take a while for the data to all get there (get empty list first, that kind of deal)  Does that happen or is this a wasted opportunity to cache?
    /*
    if (!nextInteractionSinceLastGetFreshRelationItems[strMsg] && (strMsg in currentRelationData)){
      // we have a cached version and the data shouldn't have changed since we cached it
      utilities.sendMessage("content", "mainpanel", "freshRelationItems", {type: RelationItemsOutputs.NEWITEMS, relation: currentRelationData[strMsg]});
      return;
    }
    */
    // ok, don't have a cached version, either because never collected before, or bc done a next interaction since then.  better grab the data afresh

    var relationNodes = pub.interpretRelationSelector(msg);
    WALconsole.log("relationNodes", relationNodes);

    // ok, let's go through these nodes and give them ids if they've never been scraped for a node before
    // then we want to figure out whether we're in a next interaction or a more interaction, so we now how to deal with info about whether we've scraped already
    var relationNodesIds = [];
    _.each(relationNodes, function(row){
      var rowIds = [];
      _.each(row, function(cell){
        var id = null;
        if (cell === null || cell === undefined) { 
          // can't save an id on null
          return;
        }
        else if (!("___relationFinderId___" in cell)){
          // have to add the relationFinderId
          id = relationFinderIdCounter;
          cell.___relationFinderId___ = id;
          relationFinderIdCounter += 1;
        }
        else{
          // already have relationFinderId saved
          id = cell.___relationFinderId___;
        }
        rowIds.push(id);

        // now, it's nice that we're able to track these rows and all, but if the page gets updated by javascript
        // or some such thing, we might keep this id and think we've already scraped something even if we haven't
        // so use mutationobserver

        // todo: might be better to do this for relationNodes items (row-by-row), rather than on a cell-by-cell basis
        // that way if any of the cells change, we believe the whole row has been updated
        // of course, this still doesn't fix the case where the list has been ajax-updated, but one of the rows is the same
        // todo: handle that
         
        // create an observer instance
        var observer = new MutationObserver(function(mutations) {
          console.log("MutationObserver fired", cell);
          console.log(cell.___relationFinderId___);
          // get rid of the old id, now that it's essentially a different node
          delete cell.___relationFinderId___;
          // stop observing
          observer.disconnect();
          console.log(cell.___relationFinderId___);
        });
        // configuration of the observer:
        var config = { attributes: true, childList: true, characterData: true };
        // pass in the target node, as well as the observer options
        observer.observe(cell, config);
      });
      relationNodesIds.push(rowIds);
    });

    if (!(strMsg in currentRelationSeenNodes)) { currentRelationSeenNodes[strMsg] = []; }
    // if there's supposed to be a next button or more button, or scroll for more, we have to do some special processing
    if (msg.next_type === NextTypes.NEXTBUTTON || msg.next_type === NextTypes.MOREBUTTON || msg.next_type === NextTypes.SCROLLFORMORE){
      // retrieve the list of ids we've already scraped
      var alreadySeenRelationNodeIds = currentRelationSeenNodes[strMsg];
      // figure out if the new rows include nodes that were already scraped
      var newRows = [];
      var newRowsIds = [];
      for (var i = 0; i < relationNodesIds.length; i++){
        var row = relationNodesIds[i];
        // todo: should we be looking for whether some are new, or all?  requring all can fail with ajax-updated pages
        // ex: say we're scraping a bunch of papers from a single conference.  conference element will stay the same,
        // so conference node won't get updated and its id won't get wiped.
        // in this case, even requiring some to be new could be a problem if we're only scraping that single column
        // so todo: come up with a better solution
        var someNew = _.reduce(row, function(acc, cell){return (acc || alreadySeenRelationNodeIds.indexOf(cell) === -1);}, false);
        if (someNew){
          newRows.push(relationNodes[i]);
          newRowsIds.push(row);
        }
      }

      // ok, now that we know which rows are actually new, what do we want to do with that information?
      if (msg.next_type === NextTypes.NEXTBUTTON){
        // this is a next interaction, so we should never have overlap.  wait until everything is new
        if (relationNodes.length !== newRows.length){
      	  console.log("sending no new items yet because we found some repeated items and it's a next button.  is that bad?");
      	  console.log("alreadySeenRelationNodeIds", alreadySeenRelationNodeIds.length, alreadySeenRelationNodeIds);
      	  console.log("relationNodes", relationNodes.length, relationNodes);
      	  console.log("newRows", newRows.length, newRows);
          // looks like some of our rows weren't new, so next button hasn't happened yet

          WALconsole.log("newRows", newRows);
          return {type: RelationItemsOutputs.NONEWITEMSYET, relation: null};
        }
        // otherwise we can just carry on, since the relationNodes has the right set
      }
      else{
        // ok, we're in a more-style interaction, either morebutton or scrollformore
        // the newrows are the new rows, so let's use those!
        relationNodes = newRows;
        relationNodesIds = newRowsIds;
      }
    }

    var relationData = pub.relationNodesToMainpanelNodeRepresentation(relationNodes);
    var crd = currentRelationData[strMsg];
    if (crd && crd.length === relationData.length && _.isEqual(crd, relationData)){
      // this check should now be unnecessary.  todo: clean it up!
      // data still looks the same as it looked before.  no new items yet.
      console.log("No new items yet because the data is actualy equal");
      console.log(crd, relationData);
      return {type: RelationItemsOutputs.NONEWITEMSYET, relation: null};
    }
    // whee, we have some new stuff.  we can update the state
    nextInteractionSinceLastGetFreshRelationItems = false;
    // we only want the fresh ones!
    var newItems = relationData; // start by assuming that's everything
    if (crd && _.isEqual(crd, relationData.slice(0, crd.length))){
      // cool, this is a case of loading more into the same page, so we want to just grab the end
      // again, this should now be unnecessary because we already filter to only new rows.  todo: clean it up
      newItems = relationData.slice(crd.length, relationData.length);
    }
    currentRelationData[strMsg] = relationData;
    currentRelationSeenNodes[strMsg] = _.without(currentRelationSeenNodes[strMsg].concat(_.flatten(relationNodesIds)), null);
    WALconsole.log("actual new items", newItems);
    return {type: RelationItemsOutputs.NEWITEMS, relation: newItems};
  };


return pub;}());
