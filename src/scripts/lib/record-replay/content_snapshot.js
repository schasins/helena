/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set shiftwidth=2 tabstop=2 autoindent cindent expandtab: */

'use strict';

/*
 * Takes a snapshot of a DOM node, by saving its properties and children.
 * These can be very expensive operations, so use sparingly.
 */

var snapshot = null;
var snapshotNode = null;
var snapshotBranch = null;

(function() {
  /* Don't snapshot certain DOM nodes */
  var ignoreTags = {'script': true, 'style': true};

  /* Creates a snapshot of node properties. Only string, number, and boolean
   * properties are copied.
   *
   * @param node The DOM node whose values should be copied.
   * @param props An array of  properties which should be copied. Alternatively
   *     'all' can be specified which will copy all properties of the node.
   *
   * @returns {object} Mapping from property name to value.
   */
  function getProperties(node, props) {
    if (props == 'all') {
      props = [];
      for (var prop in node)
        props.push(prop);
    } else if (!props) {
      props = [];
    }

    var mapping = {};
    for (var i = 0, ii = props.length; i < ii; ++i) {
      var prop = props[i];
      try {
        var firstChar = prop.charCodeAt(0);
        if (firstChar >= 65 && firstChar <= 90) {
          continue;
        }
        var val = node[prop];
        var type = typeof val;
        if (type == 'string' || type == 'number' || type == 'boolean') {
          mapping[prop] = val;
        }
      } catch (e) {
        // do nothing
      }
    }
    return mapping;
  }

  /* Serializes a DOM node by saving properties of the node
   *
   * @param node The DOM node to snapshot.
   * @param xpath The xpath of @link{node}.
   * @param {boolean} childTags Whether the tags of @link{node}'s children
   *     should also be snapshotted.
   * @param props The node's properties which should be saved.
   * 
   * @returns {object} Return's an object representing the \link{node}. The
   *     object contains the following fields: type, prop{object}, and
   *     possibly children{array}.
   */
  function _snapshotNode(node, xpath, childTags, props) {
    xpath = xpath.toLowerCase();

    var nodeName = node.nodeName.toLowerCase();
    var returnVal = {type: 'DOM'};

    // possible failure due to cross-domain browser restrictions
    if (nodeName == 'iframe')
      returnVal.prop = {};
    else
      returnVal.prop = getProperties(node, props);

    returnVal.prop['nodeName'] = nodeName;
    returnVal.prop['xpath'] = xpath;

    if (childTags) {
      var childNodes = node.children;
      var children = [];
      returnVal.children = children;
      var childrenTags = {};

      for (var i = 0, ii = childNodes.length; i < ii; ++i) {
        var child = childNodes.item(i);
        var nodeType = child.nodeType;

        /* let's track the number of tags of this kind we've seen in the
         * children so far, to build the xpath */
        var childNodeName = child.nodeName.toLowerCase();
        if (!(childNodeName in childrenTags))
          childrenTags[childNodeName] = 1;
        else
          childrenTags[childNodeName] += 1;

        if (nodeType === 1) { /* nodeType is "Element" (1) */
          if (!(childNodeName in ignoreTags)) {
            var newPath = xpath + '/' + childNodeName + '[' +
                          childrenTags[childNodeName] + ']';
            var child = _snapshotNode(child, newPath, false, []);
            children.push(child);
          }
        }
      }
    }
    return returnVal;
  }

  /* Create an array of snapshots from the node until the its highest parent
   * is reached.
   *
   * @returns {array} List of node snapshots, starting the highest ancestor.
   */
  function _snapshotBranch(node) {
    var path = [];
    var props = ['className', 'id'];
    while (node != null) {
      path.push(_snapshotNode(node, nodeToXPath(node), true, props));
      node = node.parentElement;
    }
    return path.reverse();
  }

  /* Create a tree of snapshots representing the subtree rooted at @link{node}
   *
   * @returns {object} Return's an object representing the \link{node}. The
   *     object contains the following fields: type, prop{object}, and
   *     children{array}. The children field contains recursive snapshots
   *     of the node's children.
   */
  function _snapshotSubtree(node, xpath) {
    var nodeName = node.nodeName.toLowerCase();
    var returnVal = _snapshotNode(node, xpath, false, 'all');

    var childNodes = node.childNodes;
    var children = [];
    returnVal.children = children;

    var childrenTags = {};
    for (var i = 0, ii = childNodes.length; i < ii; ++i) {
      var child = childNodes.item(i);
      var nodeType = child.nodeType;

      /* let's track the number of tags of this kind we've seen in the
       * children so far, to build the xpath */
      var childNodeName = child.nodeName.toLowerCase();
      if (!(childNodeName in childrenTags))
        childrenTags[childNodeName] = 1;
      else
        childrenTags[childNodeName] += 1;

      if (nodeType === 3) { // nodeType is "Text" (3)
        var value = child.nodeValue.trim();
        if (value)
          children.push({text: value, type: 'text'});
      } else if (nodeType === 1) { // nodeType is "Element" (1)
        if (!(childNodeName in ignoreTags) &&
            !child.classList.contains('replayStatus')) {

          var newPath = xpath + '/' + childNodeName + '[' +
                        childrenTags[childNodeName] + ']';
          var child = _snapshotSubtree(child, newPath);
          children.push(child);
        }
      }
    }

    return returnVal;
  }

  snapshot = function() {
    var body = document.body;
    var nodeName = body.nodeName.toLowerCase();
    if (nodeName == 'body') {
      var objTree = _snapshotSubtree(body, 'html/body[1]');
      return objTree;
    }
  }

  snapshotNode = function(node) {
    if (!node)
      return null;

    var objTree = _snapshotNode(node, nodeToXPath(node), false, 'all');
    return objTree;
  };

  snapshotBranch = _snapshotBranch;

})();
