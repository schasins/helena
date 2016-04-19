/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set shiftwidth=2 tabstop=2 autoindent cindent expandtab: */

'use strict';

/*
 * The port object is just a wrapper around Chrome's port interface. This
 * class can probably be removed, but its ok for now.
 */

var Port = (function PortClosure() {
  function Port(id) {
    this.port = chrome.runtime.connect({name: id});
  }

  Port.prototype = {
    postMessage: function _postMessage(msg) {
      this.port.postMessage(msg);
    },
    addListener: function _addListener(listener) {
      this.port.onMessage.addListener(listener);
    }
  };

  return Port;
})();

