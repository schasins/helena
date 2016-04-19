/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set shiftwidth=2 tabstop=2 autoindent cindent expandtab: */

'use strict'

var getDeltas = null;
var filterDeltas = null;

(function() {
  
  var log = getLog('synthesis');
  
  /* Return the list of deltas, taking out any deltas that appear in 
   * @link{deltasToRemove}
   *
   * @param {array} delta
   * @param {array} deltasToRemove
   *
   * @returns {array} Deltas contained in @link{delta} but not
   *     @link{deltasToRemove}
   */
  filterDeltas = function _filterDeltas(deltas, deltasToRemove) {
    var finalDeltas = [];
  
    for (var i = 0, ii = deltas.length; i < ii; ++i) {
      var delta = deltas[i];
      var matched = false;
      for (var j = 0, jj = deltasToRemove.length; j < jj; ++j) {
        var deltaToRemove = deltasToRemove[j];
        /* check if every property changed by delta is also changed in the same
         * way by deltaToRemove */
        if (deltaEqual(delta, deltaToRemove)) {
          matched = true;
          continue;
        }
      }
  
      if (!matched)
        finalDeltas.push(delta);
    }
    return finalDeltas;
  }
  
  /* Check if @link{delta1} changes all the props that @link{delta2} changes or
   * both leave property unchanged. Only checks for property differences
   */
  function deltaEqual(delta1, delta2) {
    var type = 'Property is different.';
    if (delta1.type != type || delta2.type != type) {
      log.error('deltaEqual called on unknown delta type.', delta1, delta2);
      return false;
    }
  
    var prop1 = delta1.divergingProp;
    var prop2 = delta2.divergingProp;
  
    return prop1 == prop2 &&
           delta1.changed.prop[prop1] == delta2.changed.prop[prop2];
  }
  
  /* Find properties for which two objects have different values */
  function divergingProps(obj1props, obj2props) {
    if (!(obj1props && obj2props)) {
      throw 'divergingProps called with bad arguements';
    }
    var obj1props = _.omit(obj1props, params.compensation.omittedProps);
    var obj2props = _.omit(obj2props, params.compensation.omittedProps);
  
    var divergingProps = [];
    for (var prop in obj1props) {
      if (obj1props[prop] != obj2props[prop]) {
        divergingProps.push(prop);
      }
    }
    return divergingProps;
  }
  
  /* Calculates differences between two node snapshots
   *
   * @param {object} origNode A snapshot of the original node.
   * @param {object} changedNode A snapshot of the node after possible changes.
   *
   * @returns {array} A list of deltas, each delta indicating a property change.
   */
  getDeltas = function _getDeltas(origNode, changedNode) {
    if (!origNode && !changedNode)
      throw "both nodes doesn't actually exist";
  
    /* check if both nodes are DOM nodes and not just text nodes */
    if (origNode && changedNode &&
        origNode.type == 'DOM' && changedNode.type == 'DOM') {
  
      var deltas = [];
  
      /* we've tried to match a node that turns out not to be the same
       * we want to mark that this is a divergence, but there may be  more
       * relevant deltas among its children, so let's just add this divergence
       * and continue descending */
      if (!nodeEquals(origNode, changedNode)) {
        var props1 = origNode.prop || [];
        var props2 = changedNode.prop || [];
        var omittedProps = params.compensation.omittedProps;
  
        props1 = _.omit(props1, omittedProps);
        props2 = _.omit(props2, omittedProps);
  
        var diffProps = divergingProps(props1, props2);
        for (var i = 0, ii = diffProps.length; i < ii; ++i) {
          deltas.push({
            'type': 'Property is different.',
            'orig': origNode,
            'changed': changedNode,
            'divergingProp': diffProps[i]
          });
        }
      }
      return deltas;
    /* at least one node isn't a DOM node */
    } else {
      if (!origNode) {
        return [{
          'type': 'New node in changed DOM.',
          'orig': origNode,
          'changed': changedNode
        }];
      } else if (!changedNode) {
        return [{
          'type': 'Node missing in changed DOM.',
          'orig': origNode,
          'changed': changedNode
        }];
      } else if (origNode.type == 'DOM' || changedNode.type == 'DOM') {
        return [{
          'type': 'Node types differ.',
          'orig': origNode,
          'changed': changedNode
        }];
      /* Both nodes should be text nodes */
      } else if (origNode.type == 'text' && origNode.type == 'text') {
        if (nodeEquals(origNode, changedNode)) {
          return [];
        }
        /* sad, we descended all the way and the nodes aren't the same */
        return [{
          'type': 'Nodes not the same.',
          'orig': origNode,
          'changed': changedNode
        }];
      }
    }
  }
  
  /* checks if two nodes have the same properties, all properties must be the
     same */
  function nodeEquals(node1, node2) {
    if (node1 && node2) {
      if ('prop' in node1 && 'prop' in node2) {
        var omittedProps = params.compensation.omittedProps;
        var node1RelevantProps = _.omit(node1.prop, omittedProps);
        var node2RelevantProps = _.omit(node2.prop, omittedProps);
  
        return _.isEqual(node1RelevantProps, node2RelevantProps);
      } else if ('text' in node1 && 'text' in node2) {
        return node1.text == node2.text;
      }
    }
    return node1 == node2;
  }
})();
