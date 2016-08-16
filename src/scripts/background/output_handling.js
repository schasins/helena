var OutputHandler = (function() {
  var pub = {};

  pub.Dataset = function(id){
  	this.id = id;

  	this.fullDatasetLength = 0;
  	this.currentDatasetSlice = {};
  	this.currentDatasetSliceLength = 0;
  	this.sentDatasetSlice = {};

  	var dataset = this;

  	this.requestNewDatasetId = function(){
      $.post('http://kaofang.cs.berkeley.edu:8080/newdatasetsid', {}, function(resp){dataset.handleDatasetId(resp);});
    };
    this.handleDatasetId = function(resp){
    	this.id = resp.id;
    };
    if (this.id === undefined){
    	// this is a dataset we're about to create, not one that we've already saved
  		this.requestNewDatasetId();
    }

    this.addRow = function(row){
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
    	if (this.currentDatasetSliceLength % 10 === 0){
    		this.sendDatasetSlice();
    	}
    };

    this.sendDatasetSlice = function(){
    	this.sentDatasetSlice = this.currentDatasetSlice;
    	this.currentDatasetSlice = {};
      $.post('http://visual-pbd-scraping-server.herokuapp.com/datasetslice', {id: this.id, values: this.sentDatasetSlice}, function(resp){/* todo: add better error handling eventually*/ return;});
    };

    this.closeDataset = function(){
    	this.sendDatasetSlice();
    };

    this.downloadDataset = function(){
    	window.location = 'http://visual-pbd-scraping-server.herokuapp.com/datasets/'+this.id;
    };
  };


  return pub;
}());