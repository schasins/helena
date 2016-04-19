/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set shiftwidth=2 tabstop=2 autoindent cindent expandtab: */

'use strict';

/*
 * Logging utility. Allows logs to be disabled based upon name and level.
 * These values are set in common/params.js.
 */

var getLog = null;
var logRecord = [];

var LogLevel = {
  LOG: 1,
  INFO: 2,
  DEBUG: 3,
  WARN: 4,
  ERROR: 5
};

(function() {
  var level = params.logging.level;

  var Logger = (function LoggerClosure() {
    function Logger(tags) {
      var tagString = '';
      for (var i = 0, ii = tags.length; i < ii; ++i) {
        tagString += tags[i];
        if (i != tags.length - 1)
          tagString += ',';
      }
      this.tag = '[' +  tagString + ']';
    }

    Logger.prototype = {
      print: function(f, origArgs) {
        var args = [this.tag];
        for (var i = 0, ii = origArgs.length; i < ii; ++i) {
          args.push(origArgs[i]);
        }

        if (params.logging.saved)
          logRecord.push(args.toString());
        if (params.logging.print)
          console[f].apply(console, args);
      },
      log: function() {
        if (level <= LogLevel.LOG)
          this.print('log', arguments);
      },
      info: function() {
        if (level <= LogLevel.INFO)
          this.print('info', arguments);
      },
      debug: function() {
        if (level <= LogLevel.DEBUG)
          this.print('debug', arguments);
      },
      warn: function() {
        if (level <= LogLevel.WARN)
          this.print('warn', arguments);
      },
      error: function() {
        if (level <= LogLevel.ERROR)
          this.print('error', arguments);
      }
    };

    return Logger;
  })();

  var NoopLogger = (function NoopLoggerClosure() {
    function NoopLogger() {
    }

    NoopLogger.prototype = {
      log: function() {},
      info: function() {},
      debug: function() {},
      warn: function() {},
      error: function() {}
    };

    return NoopLogger;
  })();

  /* Check to see if the log is enabled. */
  getLog = function() {
    var names = arguments;
    if (names.length == 0)
      return logger;

    var enabledLogs = params.logging.enabled;
    if (enabledLogs == 'all')
      return new Logger(names);

    for (var i = 0, ii = names.length; i < ii; ++i) {
      var name = names[i];
      if (enabledLogs.indexOf(name) != -1)
        return new Logger(names);
    }

    return new NoopLogger();
  };
})();
