var ReplayTraceManipulation = (function() { var pub = {};

	pub.requireFeature = function(trace, targetXpath, feature){
		targetXpath = targetXpath.toUpperCase();
		for (var i = 0; i< trace.length; i++){
			if (trace[i].type !== "dom"){ continue;}
			var xpathStr = trace[i].target.xpath
			if (! xpathStr.toUpperCase){ continue;} // sometimes it's a parameterized node, not a normal node
			var xpath = xpathStr.toUpperCase();
			if (xpath === targetXpath){
				WALconsole.log("requiring stability of feature", feature, targetXpath);
				if (!trace[i].target.requiredFeatures){
					trace[i].target.requiredFeatures = [feature];
				}
				else{
					trace[i].target.requiredFeatures.push(feature);
				}
			}
		}
	};

return pub; }());