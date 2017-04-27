var ReplayTraceManipulation = (function() { var pub = {};

	pub.requireFeatures = function(trace, targetXpath, features){
		targetXpath = targetXpath.toUpperCase();
		for (var i = 0; i< trace.length; i++){
			if (trace[i].type !== "dom"){ continue;}
			var xpathStr = trace[i].target.xpath
			if (! xpathStr.toUpperCase){ continue;} // sometimes it's a parameterized node, not a normal node
			var xpath = xpathStr.toUpperCase();
			if (xpath === targetXpath){
				WALconsole.log("requiring stability of features", features, targetXpath);
				trace[i].target.requiredFeatures = features;
			}
		}
	};

return pub; }());