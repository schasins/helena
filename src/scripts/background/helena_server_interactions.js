'use strict'

/**********************************************************************
 * Server interaction helper functions
 **********************************************************************/

var HelenaServerInteractions = (function () {
  var pub = {};

  pub.loadSavedPrograms = function _loadSavedPrograms(handler){
    WALconsole.log("loading programs");
    $.get('http://kaofang.cs.berkeley.edu:8080/programs/', {}, function(response){
      handler(response);
    });
  };

  pub.loadSavedDataset = function _loadSavedDataset(datasetId, handler){
    WALconsole.log("loading dataset: ", datasetId);
    $.get('http://kaofang.cs.berkeley.edu:8080/programfordataset/'+datasetId, {}, function(response){
      var progId = response.program_id;
      handler(progId);
    });
  };

  pub.loadSavedProgram = function _loadSavedProgram(progId, handler){
    WALconsole.log("loading program: ", progId);
    $.get('http://kaofang.cs.berkeley.edu:8080/programs/'+progId, {}, function(response){
      WALconsole.log("received program: ", response);
      handler(response);
    });
  };

  return pub;
}());


