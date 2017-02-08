var OutputHandler = (function _OutputHandler() {
  var pub = {};

  pub.Dataset = function _Dataset(id){
  	this.id = id;

  	this.fullDatasetLength = 0;
  	this.currentDatasetSlice = {};
  	this.currentDatasetSliceLength = 0;
  	this.sentDatasetSlice = {};

  	var dataset = this;

  	this.requestNewDatasetId = function _requestNewDatasetId(){
      $.post('http://kaofang.cs.berkeley.edu:8080/newdatasetsid', {}, function(resp){dataset.handleDatasetId(resp);});
    };
    this.handleDatasetId = function _handleDatasetId(resp){
    	this.id = resp.id;
    };
    if (this.id === undefined){
    	// this is a dataset we're about to create, not one that we've already saved
  		this.requestNewDatasetId();
    }

    this.addRow = function _addRow(row){
    	for (var i = 0; i < row.length; i++){
    		var val = row[i];
    		var coords = [this.fullDatasetLength, i];
    		if (val in this.currentDatasetSlice){
    			this.currentDatasetSlice[val].push(coords);
    		}
    		else{
    			this.currentDatasetSlice[val] = [coords];
    		}
    	}
    	this.currentDatasetSliceLength += 1;
    	this.fullDatasetLength += 1;
      RecorderUI.updateRowsSoFar(this.fullDatasetLength);
    	if (this.currentDatasetSliceLength % 10 === 0){
    		this.sendDatasetSlice();
    	}
    };

    this.sendDatasetSlice = function _sendDatasetSlice(){
      if (this.currentDatasetSliceLength === 0){
        return; // no need to send/save rows if we have no rows
      }
    	this.sentDatasetSlice = this.currentDatasetSlice;
    	this.currentDatasetSlice = {};
      this.currentDatasetSliceLength = 0;
      var msg = {id: this.id, values: encodeURIComponent(JSON.stringify(this.sentDatasetSlice))};
      var sendHelper = function _sendHelper(message){
        $.post('http://kaofang.cs.berkeley.edu:8080/datasetslice', 
          message, 
          function(resp){/* todo: add better error handling eventually*/ return;}).fail(function(){
            setTimeout(function(){sendHelper(message);}, 2000); // if we failed, need to be sure to send the slice again...
          });
      };
      sendHelper(msg);
    };

    this.closeDataset = function _closeDataset(){
    	this.sendDatasetSlice();
    };

    this.downloadDataset = function _downloadDataset(){
    	window.location = 'http://kaofang.cs.berkeley.edu:8080/datasets/'+this.id;
    };
  };


  return pub;
}());