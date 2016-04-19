/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set shiftwidth=2 tabstop=2 autoindent cindent expandtab: */

'use strict'

/*
 * Common code that is shared between content scripts and the background page
 */

var RecordState = {
  STOPPED: 'stopped',
  RECORDING: 'recording',
  REPLAYING: 'replaying' /* the recorder is recording replayed actions */
};

var ReplayState = {
  STOPPED: 'stopped',
  REPLAYING: 'replaying', /* replaying the next command */
  ACK: 'ack', /* waiting for an ack from the content script */
};

var Ack = {
  SUCCESS: 'success',
  PARTIAL: 'partial', /* only some of the commands replayed were successful */
};

function clone(obj) {
	return JSON.parse(JSON.stringify(obj));
}
