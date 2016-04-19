/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set shiftwidth=2 tabstop=2 autoindent cindent expandtab: */

'use strict';

/* Wrapper around the Chrome port abstraction */
var Port = (function PortClosure() {
  function Port(port) {
    this.port = port;
  }

  Port.prototype = {
    postMessage: function _postMessage(msg) {
      this.port.postMessage(msg);
    },
    addMessageListener: function _addMessageListener(listener) {
      this.port.onMessage.addListener(listener);
    },
    addDisconnectListener: function _addDisconnectListener(listener) {
      this.port.onDisconnect.addListener(listener);
    },
    get name() {
      return this.port.name;
    }
  };

  return Port;
})();

