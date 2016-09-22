function ParameterizedTrace(trace){
	var trace = trace;
	var frames = {};
	var tabs = {};
	
	/* xpath parameterization */

	this.parameterizeXpath = function(parameter_name, original_value) {
		original_value = original_value.toUpperCase();
		for (var i = 0; i< trace.length; i++){
			if (trace[i].type !== "dom"){ continue;}
			if (trace[i].target.xpath.name){
				//this one has already been converted to an object, parameterized
				continue;
			}
			var xpath = trace[i].target.xpath.toUpperCase();
			if (xpath === original_value){
				console.log("putting a hole in for an xpath", original_value);
				trace[i].target.xpath = {"name": parameter_name, "value": null};
			}
		}
	};

	this.useXpath = function(parameter_name, value) {
		for (var i = 0; i< trace.length; i++){
			if (trace[i].type !== "dom"){ continue;}
			var xpath = trace[i].target.xpath;
			if (xpath.name === parameter_name){
				console.log("use xpath", value);
				trace[i].target.xpath = {"name": parameter_name, "value": value};
			}
		}
	};
	
	/* user-typed string parameterization */
	
	var first_event_type = "keydown";
	var last_event_type = "keyup";
	var data_carrier_type = "textInput";
	
	this.parameterizeTypedString = function(parameter_name, original_string){
		console.log("parameterizing string ",parameter_name, original_string);
		var curr_node_xpath = null;
		var curr_string = "";
		var char_indexes = [];
		var started_char = false;
		for (var i = 0; i< trace.length; i++){
			if (trace[i].type !== "dom"){ continue;} //ok to drop these from script, so ok to skip
			var event_data = trace[i].data;
			if (!(_.contains(["keydown", "keypress", "keyup", "input", "textInput"], event_data.type)) // not a key event
					|| 
					(trace[i].target.xpath !== curr_node_xpath && curr_node_xpath !== null)){ // event now targeting a different node (and not just bc it's the first node we've seen)
				// if the next thing isn't a key event or if we've switched nodes, we're done with the current string!
				console.log("processString", curr_string);
				processString(parameter_name, original_string, curr_string, char_indexes, i - 1);
				curr_string = "";
			}
			else{
				// ok, it's still the same node and still doing key stuff
				// so we're starting a new character
				curr_node_xpath = trace[i].target.xpath;
				if (event_data.type === first_event_type && !started_char){
					char_indexes.push(i);
					started_char = true;
				}
				else if (event_data.type === data_carrier_type){
					curr_string += event_data.data;
				}
				else if (event_data.type === last_event_type){
					started_char = false;
				}
			}
		}
		// and let's check whatever we had at the end if it hadn't been checked yet
		if (curr_string.length > 0){
			processString(parameter_name, original_string, curr_string, char_indexes, trace.length - 1);
		}
	};
	
	// figure out if the keyevents issued on the node associated with the event at last_key_index should be parameterized for original_string (a cell in a relation); put in holes if yes
	function processString(parameter_name, original_string, string, char_indexes, last_key_index){
		// the string we got as an argument was based on the keypresses, but recreating all the logic around that is a terrible pain
		// let's try using the value of the node
		// using value is nice because it allows us to figure out if the target string is present even if it was typed in some weird way,
		// with the user jumping all around, or doing deletion, whatever

		var lastDomEventIndex = null;
		var targetNode = null; // let's find the most recent dom event, working backwards from last_key_index
		for (var i = last_key_index; i >= 0; i--){
			if (trace[i].type === "dom"){
				lastDomEventIndex = i;
				targetNode = trace[lastDomEventIndex].target;
				break;
			}
		}

		if (!targetNode.snapshot || !targetNode.snapshot.value){
			return; // can currently only parameterize actions on nodes that have value attributes (so text input nodes); should potentially expand to others eventually; todo: why do some not have snapshot?
		}
		var typed_value = targetNode.snapshot.value; // obviously this approach is limited to nodes with value attributes, as is current top-level tool

		var original_string_initial_case = original_string;
		original_string = original_string.toLowerCase();

		typed_value_lower = typed_value.toLowerCase();

		var target_string_index = typed_value_lower.indexOf(original_string);
		if (target_string_index > -1){
			// oh cool, that substring appears in this node by the end of the typing.  let's try to find where we start and finish typing it
			// assumption is that we're typing from begining of string to end.  below won't work well if we're hopping all around 

			// what's the last place where we see everything that appears left of our target string, but none of the target string?
			var left = typed_value_lower.slice(0, target_string_index);
			var first_key_event_index = char_indexes[0];

			var start_target_typing_index = first_key_event_index;
			for (var i = first_key_event_index; i < last_key_index; i++){
				var event = trace[i];
				if (event.type === "dom" && event.data.type === last_event_type){
					// cool, we're on the last event in a particular key sequence.  does it have the whole left in the value yet?
					var lowerCurrString = event.target.snapshot.value.toLowerCase();
					if (lowerCurrString.indexOf(left + original_string[0])){
						// oops, gone too far!  we've started the target string
						break;
					}
					if (lowerCurrString.indexOf(left) > -1){
						start_target_typing_index = i + 1;
					}
				}
			}
			// what's the first place where we see the whole target string?
			var stop_target_typing_index = last_key_index; // we know it's there by the last key, so that's a safe bet
			for (var i = start_target_typing_index; i < last_key_index; i++){
				var event = trace[i];
				if (event.type === "dom" && event.data.type === last_event_type){
					// cool, we're on the last event in a particular key sequence.  does it have the whole left in the value yet?
					if (event.target.snapshot.value.toLowerCase().indexOf(original_string) > -1){
						stop_target_typing_index = i + 1;
						break;
					}
				}
			}

			// ok, so we type our target from start_target_typing_index to stop_target_typing_index
			for (var i = start_target_typing_index; i < stop_target_typing_index; i++){
				var event = trace[i];
				if (event.type === "dom" && event.data.type === "textInput"){
					text_input_event = event;
					break;
				}
			}
			if (text_input_event === null){
				console.log("uh oh, one of our assumptions broken. no textinput event.");
			}
			//now make our param event
			var param_event = {"type": "string_parameterize", 
			"parameter_name": parameter_name, 
			"text_input_event": text_input_event, 
			"orig_value": original_string_initial_case,
			"value": ""};
			// now remove the unnecessary events, replace with param event
			// todo: note that this is a bad bad approach!  learn from CoScripter!  replay all low-level events!  (also see verion in structured codebase)
			// but it's in here now becuase recreating each keypress is a pain that I want to put off until later, and this works for current apps
			trace = trace.slice(0,start_target_typing_index)
			.concat([param_event])
			.concat(trace.slice(stop_target_typing_index, trace.length));
			console.log("putting a hole in for a string", original_string_initial_case);
		}
	}
	
	this.useTypedString = function(parameter_name, string){
		for (var i=0; i< trace.length; i++){
			var event = trace[i];
			if (event.type === "string_parameterize" && event.parameter_name === parameter_name){
				console.log("use string", string);
				event.value = string;
			}
		}
	};
	
	
	/* tab parameterization if we want to say which page to go to but leave frame mapping to lower level r+r code */

	this.parameterizeTab = function(parameter_name, original_value) {
		console.log("parameterizing tab ",parameter_name, original_value);
		tabs[parameter_name] = {original_value: original_value};
	};

	this.useTab = function(parameter_name, value) {
		if(value === null){
			console.log("Freak out: tabs.");
		}
		if (!tabs[parameter_name]){
			console.log("warning, may be trying to give argument for something that hasn't been parameterized: !tabs[parameter_name]");
			console.log(parameter_name, value);
			console.log(this);
			return;
		}
		tabs[parameter_name].value = value;
	};

	/* frame parameterization */
	
	this.parameterizeFrame = function(parameter_name, original_value) {
		console.log("parameterizing frame ",parameter_name, original_value);
		frames[parameter_name] = {original_value: original_value};
	};

	this.useFrame = function(parameter_name, value) {
		if(value === null){
			console.log("Freak out.");
		}
		if (!frames[parameter_name]){
			console.log("warning, may be trying to give argument for something that hasn't been parameterized: !frames[parameter_name]");
			console.log(parameter_name, value);
			console.log(this);
			return;
		}
		frames[parameter_name].value = value;
	};

		/* url load parameterization */

		// todo: also change the completed event now that we allow that to cause loads if forceReplay is set

	this.parameterizeUrl = function(parameter_name, original_value) {

		// so that dom events (when they open new tabs) open correct tab
		// see record-replay/mainpanel_main for the func (getMatchingPort) where we actually open a new tab if we're trying to run an event that needs it, which explains why we do url parameterization the way we do
		original_value = original_value.toUpperCase();
		for (var i = 0; i< trace.length; i++){
			if (trace[i].type !== "dom"){ continue;}
			if (trace[i].frame.topURL.name){
				//this one has already been converted to an object, parameterized
				continue;
			}
			var url = trace[i].frame.topURL.toUpperCase();
			if (url === original_value){
				console.log("putting a hole in for a URL", original_value);
				trace[i].frame.topURL = {"name": parameter_name, "value": null};
			}
		}

		// so that 'completed' events open correct tab
		for (var i = 0; i< trace.length; i++){
			if (trace[i].type !== "completed"){ continue;}
			if (trace[i].data.url.name){
				//this one has already been converted to an object, parameterized
				continue;
			}
			var url = trace[i].data.url.toUpperCase();
			if (url === original_value){
				console.log("putting a hole in for a URL", original_value);
				trace[i].data.url = {"name": parameter_name, "value": null};
			}
		}
	};

	this.useUrl = function(parameter_name, value) {
		// dom events
		for (var i = 0; i< trace.length; i++){
			if (trace[i].type !== "dom"){ continue;}
			var url = trace[i].frame.topURL;
			if (url.name === parameter_name){
				console.log("use url", url);
				trace[i].frame.topURL = {"name": parameter_name, "value": value};
			}
		}
		// completed events
		for (var i = 0; i< trace.length; i++){
			if (trace[i].type !== "completed"){ continue;}
			var url = trace[i].data.url;
			if (url.name === parameter_name){
				console.log("use url", url);
				trace[i].data.url = {"name": parameter_name, "value": value};
			}
		}
	};
	
	//TODO tabs: create a parameterize on frame or tab.  not yet sure which
	//we'll be using it for cases where a demonstration does something on a list page
	//could be the first list page, in which case tab always the same, but could
	//also be a nested list page, in which case tab will change
	
	/* using current arguments, create a standard, replayable trace */
	
	function deltaReplace(deltas, prop_to_change, orig_value, replace_value){
		for (var j = 0; j<deltas.length; j++){
			var delta = deltas[j];
			delta.changed.prop[prop_to_change] = delta.changed.prop[prop_to_change].replace(orig_value, replace_value);
		}
	}
	
	this.getStandardTrace = function(){
		console.log("about to clone trace ", trace);
		var cloned_trace = clone(trace);
		console.log("successfully cloned trace");
		var prop_corrections = {};
		for (var i = 0; i< cloned_trace.length; i++){
			if (cloned_trace[i].type === "dom"){
				// do any prop corrections we might need, as when we've recorded a value but want to enforce a diff
				if (cloned_trace[i].meta.nodeSnapshot && cloned_trace[i].meta.nodeSnapshot.prop){
					var xpath = cloned_trace[i].meta.nodeSnapshot.prop.xpath;
					for (var correction_xpath in prop_corrections){
						if (xpath === correction_xpath){
							var d = prop_corrections[correction_xpath];
							deltaReplace(cloned_trace[i].meta.deltas, d.prop, d.orig_value, d.value);		
						}
					}
				}
				// correct xpath if it's a parameterized xpath
				var xpath = cloned_trace[i].target.xpath;
				if (xpath.name){
					console.log("Correcting xpath to ", xpath.value);
					cloned_trace[i].target.xpath = xpath.value;
					cloned_trace[i].target.useXpathOnly = true;
				}
				// correct url if it's a parameterized url
				var url = cloned_trace[i].frame.topURL;
				if (url.name){
					console.log("Correcting url to ", url.value);
					cloned_trace[i].frame.topURL = url.value;
				}
				// correct tab if it's a parameterized tab
				var tab = cloned_trace[i].frame.tab;
				if (tab.name){
					console.log("Correcting url to ", tab.value);
					cloned_trace[i].frame.tab = tab.value;
				}
			}
			else if (cloned_trace[i].type === "string_parameterize"){
				console.log("Correcting string to ", cloned_trace[i].value);
				console.log(cloned_trace[i]);
				var new_event = cloned_trace[i].text_input_event;
				new_event.data.data = cloned_trace[i].value;
				deltaReplace(new_event.meta.deltas, "value", cloned_trace[i].orig_value, cloned_trace[i].value);
				prop_corrections[new_event.meta.nodeSnapshot.prop.xpath] = 
				{prop: "value", 
				orig_value: cloned_trace[i].orig_value, 
				value: cloned_trace[i].value};
				cloned_trace = cloned_trace.slice(0,i)
				.concat([new_event])
				.concat(cloned_trace.slice(i+1,cloned_trace.length));
			}
			
		}
		return cloned_trace;
	};
	
	this.getConfig = function(){
		console.log("frames", frames);
		var config = {};
		config.frameMapping = {};
		for (var param in frames){
			config.frameMapping[frames[param].original_value] = frames[param].value;
		}
		config.tabMapping = {};
		for (var param in tabs){
			config.tabMapping[tabs[param].original_value] = tabs[param].value;
		}
		console.log("config", config);
		return config;
	};
}