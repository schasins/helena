function setUp(){

  //messages received by this component
  //utilities.listenForMessage("content", "mainpanel", "selectorAndListData", processSelectorAndListData);
  //utilities.listenForMessage("content", "mainpanel", "nextButtonData", processNextButtonData);
  //utilities.listenForMessage("content", "mainpanel", "moreItems", moreItems);
  utilities.listenForMessage("content", "mainpanel", "scrapedData", RecorderUI.processScrapedData);
  
  //messages sent by this component
  //utilities.sendMessage("mainpanel", "content", "startProcessingList", "");
  //utilities.sendMessage("mainpanel", "content", "stopProcessingList", "");
  //utilities.sendMessage("mainpanel", "content", "startProcessingNextButton", "");
  //utilities.sendMessage("mainpanel", "content", "getMoreItems", data);
  //utilities.sendMessage("mainpanel", "content", "getNextPage", data);
  
  //handle user interactions with the mainpanel
  //$("button").button(); 
  $( "#tabs" ).tabs();
  RecorderUI.setUpRecordingUI();
}

$(setUp);


/**********************************************************************
 * Guide the user through making a demonstration recording
 **********************************************************************/

var RecorderUI = (function() {
  var pub = {};

  pub.setUpRecordingUI = function(){
    var div = $("#new_script_content");
    utilities.replaceContent(div, $("#about_to_record"));
    console.log(RecorderUI.startRecording);
    console.log(div.find(".start_recording"));
    div.find("#start_recording").click(RecorderUI.startRecording);
  }

  pub.startRecording = function(){
    console.log("start recording");
    var div = $("#new_script_content");
    utilities.replaceContent(div, $("#recording"));
    div.find("#stop_recording").click(RecorderUI.stopRecording);

    SimpleRecord.startRecording();
  }

  pub.stopRecording = function(){
    var trace = SimpleRecord.stopRecording();
    ReplayScript.setCurrentTrace(trace);
  }

  // during recording, when user scrapes, show the text so user gets feedback on what's happening
  var scraped = {};
  var xpaths = []; // want to show texts in the right order
  pub.processScrapedData = function(data){
    console.log(data.text);
    scraped[data.xpath] = data.text; // dictionary based on xpath since we can get multiple DOM events that scrape same data from same node
    xpaths.push(data.xpath);
    console.log(scraped);
    $div = $("#scraped_items_preview");
    $div.html("");
    for (var i = 0; i < xpaths.length; i++){
      $div.append($('<div class="first_row_elem">'+scraped[xpaths[i]]+'</div>'));
    }
  }

  return pub;
}());

/**********************************************************************
 * Wrangling the replay script once we have the raw trace
 **********************************************************************/

var ReplayScript = (function() {
  var pub = {};

  pub.trace = null;

  pub.setCurrentTrace = function(trace){
    pub.trace = processTrace(trace);
    console.log(pub.trace);
  }

  function processTrace(trace){
    trace = sanitizeTrace(pub.trace);
  }

  // strip out the stopped events
  function sanitizeTrace(trace){
    return _.filter(trace, function(obj){return obj.state !== "stopped";});
  }

  // from output trace, extract the items that were scraped
  pub.capturesFromTrace = function(trace){
    var scraped_nodes = {};
    for (var i = 0; i < trace.length; i++){
      var event = trace[i];
      if (event.type !== "dom"){continue;}
        var additional = event.additional;
        if (additional["scrape"]){
          var c = additional["scrape"];
          //only want one text per node, even though click on same node, for instance, has 3 events
          scraped_nodes[c.xpath] = c;
        }
      }
    var items = _.map(scraped_nodes, function(val,key){return val;});
    return items;
  }

  return pub;
}());