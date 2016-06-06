/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set shiftwidth=2 tabstop=2 autoindent cindent expandtab: */

'use strict';

/* Convert a node to a xpath expression representing the path from the
 * document element */
function nodeToXPath(element) {
  if (element === null){
    return null;
  }
  if (element.tagName.toLowerCase() === 'html')
    return element.tagName;

  // if there is no parent node then this element has been disconnected
  // from the root of the DOM tree
  if (!element.parentNode)
    return '';

  var ix = 0;
  var siblings = element.parentNode.childNodes;
  for (var i = 0, ii = siblings.length; i < ii; i++) {
    var sibling = siblings[i];
    if (sibling === element)
      return nodeToXPath(element.parentNode) + '/' + element.tagName +
             '[' + (ix + 1) + ']';
    if (sibling.nodeType === 1 && sibling.tagName === element.tagName)
      ix++;
  }
}

/* Convert a xpath expression to a set of matching nodes */
function xPathToNodes(xpath) {
  try {
    var q = document.evaluate(xpath, document, null, XPathResult.ANY_TYPE,
                              null);
    var results = [];

    var next = q.iterateNext();
    while (next) {
      results.push(next);
      next = q.iterateNext();
    }
    return results;
  } catch (e) {
    getLog('misc').error('xPath throws error when evaluated:', xpath);
  }
  return [];
}

/* Convert a xpath expression representing the path from root to a node */
function simpleXPathToNode(xpath) {
  // error was thrown, attempt to just walk down the dom tree
  var currentNode = document.documentElement;
  var paths = xpath.split('/');
  // assume first path is "HTML"
  paths: for (var i = 1, ii = paths.length; i < ii; ++i) {
    var children = currentNode.children;
    var path = paths[i];
    var splits = path.split(/\[|\]/);

    var tag = splits[0];
    if (splits.length > 1) {
      var index = parseInt(splits[1]);
    } else {
      var index = 1;
    }

    var seen = 0;
    children: for (var j = 0, jj = children.length; j < jj; ++j) {
      var c = children[j];
      if (c.tagName == tag) {
        seen++;
        if (seen == index) {
          currentNode = c;
          continue paths;
        }
      }
    }
    getLog('misc').error('xpath child cannot be found', xpath);
    return null;
  }
  return [currentNode];
}

/* Convert xpath to a single node */
function xPathToNode(xpath) {
  var nodes = xPathToNodes(xpath);
  //if we don't successfully find nodes, let's alert
  if (nodes.length != 1)
    getLog('misc').error("xpath doesn't return strictly one node", xpath);

  if (nodes.length >= 1)
    return nodes[0];
  else
    return null;
}

function isElement(obj) {
  try {
    //Using W3 DOM2 (works for FF, Opera and Chrom)
    return obj instanceof HTMLElement;
  }
  catch (e) {
    //Browsers not supporting W3 DOM2 don't have HTMLElement and
    //an exception is thrown and we end up here. Testing some
    //properties that all elements have. (works on IE7)
    return (typeof obj === 'object') &&
      (obj.nodeType === 1) && (typeof obj.style === 'object') &&
      (typeof obj.ownerDocument === 'object');
  }
}
