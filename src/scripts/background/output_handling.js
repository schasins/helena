var OutputHandler = (function _OutputHandler() {
  var pub = {};

  pub.Dataset = function _Dataset(id){
  	this.id = id;

  	this.fullDatasetLength = 0;
  	this.currentDatasetNodes = [];
    this.currentDatasetPositionLists = [];
  	this.currentDatasetSliceLength = 0;

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

    // how we'll grab out the components in the server
    // nodes = JSON.parse(URI.decode(params[:nodes]))
    // positionLists = JSON.parse(params[:position_lists])

    this.addRow = function _addRow(row){
    	for (var i = 0; i < row.length; i++){
    		var cell_dict = row[i];
        var node_index = null;

        // let's just find if we've already seen this node before or not, so we can figure out what info to update
        // todo: is this fast enough.  we used to do a dict from text value to positionsList, but now we want to save more info
        // important to avoid eating up too much memory since it's easy for user to be grabbing items that have a ton of text...

        for (var j = 0; j < this.currentDatasetNodes.length; j++){
          var candidate_dict = this.currentDatasetNodes[j];
          if (_.isEqual(candidate_dict, cell_dict)){
            node_index = j;
            break;
          }
        }
        if (node_index === null){
          // ok, we haven't seen this node before
          this.currentDatasetNodes.push(cell_dict);
          this.currentDatasetPositionLists.push([]);
          node_index = this.currentDatasetNodes.length - 1;
        }

        // ok, now the node is stored in this.currentDatasetNodes
        // let's store the current coords in the corresponding index for this.currentDatasetPositionLists
    		var coords = [this.fullDatasetLength, i];
        this.currentDatasetPositionLists[node_index].push(coords);
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
      var msg = {id: this.id, position_lists: JSON.stringify(this.currentDatasetPositionLists), nodes: encodeURIComponent(JSON.stringify(this.currentDatasetNodes))};
    	this.currentDatasetNodes = [];
      this.currentDatasetPositionLists = [];
      this.currentDatasetSliceLength = 0;
      var currentWait = 5000;
      var sendHelper = function _sendHelper(message){
        $.post('http://kaofang.cs.berkeley.edu:8080/datasetslice', 
          message, 
          function(resp){/* todo: add better error handling eventually*/ return;}).fail(function(){
            setTimeout(function(){sendHelper(message);}, currentWait); // if we failed, need to be sure to send the slice again...
            currentWait = currentWait * 2; // doing a little bit of backoff, but should probably do this in a cleaner way
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

    this.getId = function _getId(){
      return this.id;
    };
  };


  return pub;
}());