import { Utilities } from "../ringer-record-replay/common/utils";
import { HelenaConsole } from "../common/utils/helena_console";
import { ParameterizedXPath, StringParameterizeEvent, RecordedRingerEvent,
	ParameterizedTopURL } from "../ringer-record-replay/common/event";
import { Trace } from "../common/utils/trace";
import { Delta } from "../ringer-record-replay/content/snapshot";

export interface ParameterizedTraceConfig {
	// frameMapping: any;
	tabMapping: {
		[key: number]: number
	};
	targetWindowId?: number;
}

interface Property {
  property: string;
  value: string;
}

interface ParameterizedTab {
	original_value: number,
	value?: number
}

export class ParameterizedTrace {
	// private frames: object;
	private tabs: {
		[key: string]: ParameterizedTab
	};
	private trace: (RecordedRingerEvent | StringParameterizeEvent)[];

	constructor(trace: Trace) {
		// this.frames = {};
		this.tabs = {}
		this.trace = trace;
	}

	/**
	 * Get parameterized trace config.
	 */
	public getConfig() {
		// WALconsole.log("frames", frames);
		const config: ParameterizedTraceConfig = {
			// frameMapping: {},
			tabMapping: {}
		};
		/*for (const param in frames) {
			config.frameMapping[frames[param].original_value] = frames[param].value;
		}*/
		for (const param in this.tabs) {
			const tabValue = this.tabs[param].value;
			if (!tabValue) {
				throw new ReferenceError("tabValue should be set!");
			}
			config.tabMapping[this.tabs[param].original_value] = tabValue;
		}
		HelenaConsole.log("config", config);
		return config;
	};
	
	/**
	 * TODO
	 */
	public getStandardTrace() {
		HelenaConsole.log("about to clone trace ", this.trace);
		let clonedTrace = Utilities.clone(this.trace);
		HelenaConsole.log("successfully cloned trace");
		const prop_corrections: {
			[key: string]: {
				prop: string;
				value: string;
				orig_value: string;
			}
		} = {};
		for (let i = 0; i < clonedTrace.length; i++){
			const event = clonedTrace[i];
			if (event.type === "completed" || event.type === "webnavigation") {
				// correct url if it's a parameterized url
				const url = event.data.url;
				if (url.name) {
					HelenaConsole.log("Correcting url to ", url.value);
					event.data.url = url.value;
				}
			} else if (event.type === "dom") {
				// do any prop corrections we might need, as when we've recorded a value
				//   but want to enforce a diff
				if (event.meta.nodeSnapshot && event.meta.nodeSnapshot.prop) {
					const xpath = event.meta.nodeSnapshot.prop.xpath;
					for (const correction_xpath in prop_corrections){
						if (xpath === correction_xpath) {
							const d = prop_corrections[correction_xpath];
							deltaReplace(event.meta.deltas, d.prop, d.orig_value, d.value);		
						}
					}
				}
				// do explicit pbv prop corrections (for deltas that we need to cause)
				const deltas = event.meta.deltas;
				if (deltas) {
					for (let j = 0; j < deltas.length; j++) {
						const delta = deltas[j];
						const props = delta.changed.prop;
						for (const key in props){
							if (props[key] && props[key].value) {
								// phew, finally found it.  put in the placeholder
								HelenaConsole.log("Correcting prop to", props[key].value);
								event.meta.deltas[j].changed.prop[key] = props[key].value;
							}
						}
					}
				}
				// correct xpath if it's a parameterized xpath
				const xpath = event.target.xpath;
				if (xpath.name) {
					HelenaConsole.log("Correcting xpath to ", xpath.value);
					event.target.xpath = xpath.value;
					event.target.useXpathOnly = true;
				}
				// correct url if it's a parameterized url
				const url = event.frame.topURL;
				if (url.name) {
					HelenaConsole.log("Correcting url to ", url.value);
					event.frame.topURL = url.value;
				}
				// correct tab if it's a parameterized tab
				const tab = event.frame.tab;
				if (tab.name) {
					HelenaConsole.log("Correcting url to ", tab.value);
					event.frame.tab = tab.value;
				}
			} else if (event.type === "string_parameterize") {
				HelenaConsole.log("Correcting string to ", event.value);
				HelenaConsole.log(event);
				const new_event = event.text_input_event;
				new_event.data.data = event.value;
				deltaReplace(new_event.meta.deltas, "value", event.orig_value,
					event.value);
				prop_corrections[new_event.meta.nodeSnapshot.prop.xpath] = {
					prop: "value", 
					orig_value: event.orig_value, 
					value: event.value
				};
				clonedTrace = clonedTrace.slice(0, i)
					.concat([ new_event ])
					.concat(clonedTrace.slice(i+1, clonedTrace.length));
			}
			
		}
		return clonedTrace;
	}

	/**
	 * TODO
	 * @param paramName 
	 * @param origValue 
	 */
	/*
	public parameterizeFrame(paramName: string, origValue) {
		HelenaConsole.log("parameterizing frame ", paramName, origValue);
		frames[paramName] = {
			original_value: origValue
		};
	};*/

	/**
	 * Property parameterization
	 * @param paramName
	 * @param origValue
	 */
	public parameterizeProperty(paramName: string, origValue: Property) {
		const propertyName = origValue.property;
		const propertyOriginalValue = origValue.value;
		for (const ev of this.trace) {
			if (ev.type !== "dom") { continue; }
			const deltas = ev.meta.deltas;
			if (deltas) {
				for (const delta of deltas) {
					if (delta.divergingProp === propertyName) {
						const props = delta.changed?.prop;
						if (props) {
							for (const key in props) {
								if (key === propertyName &&
									  props[key] === propertyOriginalValue) {
									// finally found it.  put in the placeholder
									HelenaConsole.log("putting a hole in for a prop", origValue);
									props[key] = {
										name: paramName,
										value: null,
										orig_value: propertyOriginalValue
									};
								}
							}
						}
					}
				}
			}
		}
	}
	
	/**
	 * Tab parameterization if we want to say which page to go to but leave fram
	 *   mapping to lower level r+r code
	 * @param paramName 
	 * @param origValue 
	 */
	public parameterizeTab(paramName: string, origValue: number) {
		HelenaConsole.log("parameterizing tab ", paramName, origValue);
		this.tabs[paramName] = {
			original_value: origValue
		};
	}

	/**
	 * TODO
	 * @param paramName 
	 * @param origString 
	 */
	public parameterizeTypedString(paramName: string, origString: string) {
		HelenaConsole.log("parameterizing string ", paramName, origString);
		let curr_node_xpath = null;
		let curr_string = "";
		let char_indexes = [];
		let started_char = false;

		// let's see if there's just a textinput event that adds the whole thing
		for (let i = 0; i < this.trace.length; i++) {
			const event = this.trace[i];
			if (event.type === "dom" &&
			    event.data.type === "textInput") {
				const typed = event.data.data;
				if (typed.toLowerCase() === origString.toLowerCase()) {
					// great, this is the one
					this.trace = replaceSliceWithParamEvent(this.trace, paramName,
						event, origString, i, i)
					return;
				}
			}
		}

		let i;
		for (i = 0; i < this.trace.length; i++){
			const event = this.trace[i];
			// ok to drop these from script, so ok to skip
			if (event.type !== "dom") { continue; }
		
			const event_data = event.data;
			if (!(["keydown", "keypress", "keyup", "input",	// not a key event
						 "textInput"].includes(event_data.type)) ||
					 
					 // event now targeting a different node (and not just bc it's the
					 //   first node we've seen)
				   (event.target.xpath !== curr_node_xpath &&
					    curr_node_xpath !== null)){
				// if the next thing isn't a key event or if we've switched nodes, we're
				//   done with the current string! (assuming we have a current string
				//   right now)
				if (curr_string.length > 0) {
					HelenaConsole.log("processString", curr_string);
					const currIndex = processString(paramName, origString, curr_string,
						char_indexes, i - 1);
					curr_string = "";
					char_indexes = [];
					if (currIndex !== null) {
						// have to update this, because processString might have shortened
						//   the trace
						i = currIndex;

						// have to continue so the if statement below doesn't fire until we
						//   do i++
						continue;
					}
				}
			}
			if (["keydown", "keypress", "keyup", "input",
					 "textInput"].includes(event_data.type)) {
				// ok, we're doing key stuff
				curr_node_xpath = event.target.xpath;
				if (event_data.type === "keydown" && !started_char) {
					// starting a new char
					char_indexes.push(i);
					started_char = true;
				} else if (event_data.type === "textInput") {
					curr_string += event_data.data;
				} else if (event_data.type === "keyup") {
					started_char = false;
				}
			}
		}
		// and let's check whatever we had at the end if it hadn't been checked yet
		if (curr_string.length > 0) {
			const currIndex = processString(paramName, origString, curr_string,
				char_indexes, this.trace.length - 1);
			if (currIndex !== null) {
				// have to update this, because processString might have shortened the
				//   trace
				i = currIndex;
			}
		}
	}

	/**
	 * URL load parameterization
	 *   TODO: also change the completed event now that we allow that to cause
	 *   loads if forceReplay is set
	 * @param paramName 
	 * @param origValue 
	 */
	public parameterizeUrl(paramName: string, origValue: string) {
		// so that dom events (when they open new tabs) open correct tab
		// see record-replay/mainpanel_main for the func (getMatchingPort) where we
		//   actually open a new tab if we're trying to run an event that needs it,
		//   which explains why we do url parameterization the way we do
		origValue = origValue.toUpperCase();
		for (const event of this.trace) {
			if (event.type !== "dom"){ continue; }
			if (typeof event.frame.topURL !== 'string') {
				//this one has already been converted to an object, parameterized
				continue;
			}
			const url = event.frame.topURL.toUpperCase();
			if (url === origValue) {
				HelenaConsole.log("putting a hole in for a URL", origValue);
				event.frame.topURL = {
					"name": paramName,
					"value": null
				};
			}
		}

		// so that 'completed' events open correct tab
		for (const event of this.trace) {
			if (event.type !== "completed" && event.type !== "webnavigation") {
					continue;
			}
			if (event.data.url.name){
				//this one has already been converted to an object, parameterized
				continue;
			}
			var url = event.data.url.toUpperCase();
			if (url === origValue){
				HelenaConsole.log("putting a hole in for a URL", origValue);
				event.data.url = {"name": paramName, "value": null};
			}
		}
	};


	/**
	 * Parameterize XPath
	 * @param paramName 
	 * @param origValue 
	 */
	public parameterizeXpath(paramName: string, origValue: string) {
		origValue = origValue.toUpperCase();
		for (const ev of this.trace) {
			if (ev.type !== "dom") { continue; }
			let xpath = null;
			if (typeof ev.target.xpath === 'string') {
				HelenaConsole.log(ev.target.xpath);
				xpath = ev.target.xpath.toUpperCase();
			} else {
				// this one has already been converted to an object, parameterized
				// ok! this used to say we were going to continue, since we've already
				//   parameterized.  now we allow us to re-parameterize
				// so this is now out of sync with the way the other parameterize
				//   functions work.  todo: fix the others to match!
				// note: added the original_value field, since need that now
				xpath = ev.target.xpath.orig_value;
			}

			if (xpath === origValue) {
				HelenaConsole.log("putting a hole in for an xpath", origValue);
				ev.target.xpath = {
					name: paramName,
					value: null,
					orig_value: origValue
				};
			}
		}
	}

 /**
  * TODO
  * @param parameter_name 
  * @param value 
  */
	/*public useFrame(parameter_name, value) {
		if(value === null){
			WALconsole.log("Freak out.");
		}
		if (!frames[parameter_name]){
			WALconsole.log("warning, may be trying to give argument for something that hasn't been parameterized: !frames[parameter_name]");
			WALconsole.log(parameter_name, value);
			WALconsole.log(this);
			return;
		}
		frames[parameter_name].value = value;
	}*/

	/**
	 * TODO
	 * @param paramName 
	 * @param value 
	 */
	public useProperty(paramName: string, value: Property) {
		const propertyName = value.property;
		const propertyValue = value.value;
		for (const ev of this.trace) {
			if (ev.type !== "dom") { continue; }
			const deltas = ev.meta.deltas;
			if (deltas) {
				// for (var j = 0; j < deltas.length; j++) {
				for (const delta of deltas) {
					if (delta.divergingProp === propertyName) {
						const props = delta.changed?.prop;
						if (props) {
							for (const key in props) {
								if (key === propertyName &&
									  props[key].name === paramName) {
									// phew, finally found it.
									HelenaConsole.log("use prop", value);
									props[key].value = propertyValue;
								}
							}
						}
					}
				}
			}
		}
	}

	/**
	 * TODO
	 * @param paramName 
	 * @param value 
	 */
	public useTab(paramName: string, value: number) {
		if (value === null) {
			HelenaConsole.log("Freak out: tabs.");
		}
		if (!this.tabs[paramName]) {
			HelenaConsole.log("warning, may be trying to give argument for " +
				"something that hasn't been parameterized: !tabs[parameter_name]");
			HelenaConsole.log(paramName, value);
			HelenaConsole.log(this);
			return;
		}
		this.tabs[paramName].value = value;
	}


	/**
	 * 
	 * @param paramName 
	 * @param str 
	 */
	public useTypedString(paramName: string, str: string){
		for (const event of this.trace) {
			if (event.type === "string_parameterize") {
				const strParamEv = <StringParameterizeEvent> event;
			  if (strParamEv.parameter_name === paramName) {
					HelenaConsole.log("use string", str);
					strParamEv.value = str;
				}
			}
		}
	}

	/**
	 * TODO
	 * @param paramName 
	 * @param value 
	 */
	public useUrl(paramName: string, value: string) {
		// dom events
		// for (var i = 0; i< trace.length; i++){
		for (const event of this.trace) {
			if (event.type !== "dom"){ continue; }
			const url = <ParameterizedTopURL> event.frame.topURL;
			if (url.name === paramName) {
				HelenaConsole.log("use url", url);
				event.frame.topURL = {
					name: paramName,
					value: value
				};
			}
		}
		// completed events
		for (const event of this.trace) {
			if (event.type !== "completed" && event.type !== "webnavigation") {
				continue;
			}
			const url = event.data.url;
			if (url.name === paramName){
				HelenaConsole.log("use url", url);
				event.data.url = {
					name: paramName,
					value: value
				};
			}
		}
	}

	/**
	 * TODO
	 * @param paramName 
	 * @param value 
	 */
	public useXpath(paramName: string, value: any) {
		for (const ev of this.trace) {
			if (ev.type !== "dom") { continue; }
			const xpath = <ParameterizedXPath> ev.target.xpath;
			if (xpath.name === paramName) {
				HelenaConsole.log("use xpath", value);
				ev.target.xpath = {
					name: paramName,
					value: value,
					orig_value: xpath.orig_value
				};
			}
		}
	}
}

/**
 * TODO
 * @param trace 
 * @param paramName 
 * @param textInputEvent 
 * @param origStringInitialCase 
 * @param startTargetTypingIndex 
 * @param stopTargetTypingIndex 
 */
function replaceSliceWithParamEvent(
		trace: (RecordedRingerEvent | StringParameterizeEvent)[], paramName: string,
		textInputEvent: RecordedRingerEvent, origStringInitialCase: string,
		startTargetTypingIndex: number, stopTargetTypingIndex: number) {
	// now make our param event
	const param_event: StringParameterizeEvent = {
		type: "string_parameterize", 
		parameter_name: paramName, 
		text_input_event: textInputEvent, 
		orig_value: origStringInitialCase,
		value: ""
	};
	// now remove the unnecessary events, replace with param event
	// todo: note that this is a bad bad approach!  learn from CoScripter!
	//   replay all low-level events!  (also see verion in structured codebase)
	// but it's in here now becuase recreating each keypress is a pain that I want
	//   to put off until later, and this works for current apps
	trace = trace.slice(0, startTargetTypingIndex)
							 .concat([ param_event ])
							 .concat(trace.slice(stopTargetTypingIndex, trace.length));
	HelenaConsole.log("putting a hole in for a string", origStringInitialCase);
	return trace;
}


/**
 * Figure out if the keyevents issued on the node associated with the event at
 *   last_key_index should be parameterized for original_string (a cell in a
 *   relation); put in holes if yes.
 * @param paramName 
 * @param origStr 
 * @param str 
 * @param charIndexes 
 * @param lastKeyIndex 
 */
function processString(paramName: string, origStr: string, str: string,
		charIndexes: number[], lastKeyIndex: number) {
	// the string we got as an argument was based on the keypresses, but
	//   recreating all the logic around that is a terrible pain
	// let's try using the value of the node
	// using value is nice because it allows us to figure out if the target string
	//   is present even if it was typed in some weird way,
	// with the user jumping all around, or doing deletion, whatever

	let lastDomEventIndex = null;
	let targetNode = null;
	// let's find the most recent dom event, working backwards from last_key_index
	for (let i = lastKeyIndex; i >= 0; i--){
		if (this.trace[i].type === "dom") {
			lastDomEventIndex = i;
			targetNode = this.trace[lastDomEventIndex].target;
			break;
		}
	}

	if (!targetNode.snapshot || !targetNode.snapshot.value) {
		// can currently only parameterize actions on nodes that have value
		//   attributes (so text input nodes); should potentially expand to others
		//   eventually; todo: why do some not have snapshot?
		return null;
	}

	// obviously this approach is limited to nodes with value attributes, as is
	//   current top-level tool
	const typed_value = targetNode.snapshot.value;

	const original_string_initial_case = origStr;
	origStr = origStr.toLowerCase();

	const typed_value_lower = typed_value.toLowerCase();

	const target_string_index = typed_value_lower.indexOf(origStr);
	if (target_string_index > -1) {
		// oh cool, that substring appears in this node by the end of the typing.
		//   let's try to find where we start and finish typing it
		// assumption is that we're typing from begining of string to end.
		//   below won't work well if we're hopping all around 

		// what's the last place where we see everything that appears left of our
		//   target string, but none of the target string?
		const left = typed_value_lower.slice(0, target_string_index);
		HelenaConsole.log("left", left);
		const first_key_event_index = charIndexes[0];

		let start_target_typing_index = first_key_event_index;
		for (let i = first_key_event_index; i < lastKeyIndex; i++) {
			const event = this.trace[i];
			if (event.type === "dom" && event.data.type === "keyup" &&
			    event.target.snapshot.value) {
				// cool, we're on the last event in a particular key sequence. does it
				//   have the whole left in the value yet?
				const lowerCurrString = event.target.snapshot.value.toLowerCase();
				if (lowerCurrString.includes(left + origStr[0])) {
					// oops, gone too far!  we've started the target string
					break;
				}
				if (lowerCurrString.includes(left)){
					start_target_typing_index = i + 1;
				}
			}
		}
		HelenaConsole.log("start_typing_index", start_target_typing_index);
		// what's the first place where we see the whole target string?
		// we know it's there by the last key, so that's a safe bet
		let stop_target_typing_index = lastKeyIndex;
		for (let i = start_target_typing_index; i < lastKeyIndex; i++) {
			const event = this.trace[i];
			if (event.type === "dom" && event.data.type === "keyup" &&
			    event.target.snapshot.value){
				// cool, we're on the last event in a particular key sequence. does it
				//   have the whole left in the value yet?
				if (event.target.snapshot.value.toLowerCase().includes(origStr)) {
					stop_target_typing_index = i + 1;
					break;
				}
			}
		}
		HelenaConsole.log("stop_target_typing_index", stop_target_typing_index);

		let text_input_event = null;
		// ok, so we type our target from start_target_typing_index to
		//   stop_target_typing_index
		for (let i = stop_target_typing_index; i > start_target_typing_index; i--) {
			const event = this.trace[i];
			if (event.type === "dom" && event.data.type === "textInput") {
				text_input_event = event;
				break;
			}
		}
		if (text_input_event === null) {
			HelenaConsole.log("one of our assumptions broken. no textinput event.");
		}
		this.trace = replaceSliceWithParamEvent(this.trace, paramName,
			text_input_event, original_string_initial_case, start_target_typing_index,
			stop_target_typing_index);
		return start_target_typing_index + 1;
	}

	return null;
}

/**
 * Using current arguments, create a standard, replayable trace
 * @param deltas 
 * @param propToChange 
 * @param origValue 
 * @param replaceValue 
 */
function deltaReplace(deltas: Delta[], propToChange: string, origValue: string,
		replaceValue: string){
	for (const delta of deltas) {
		if (delta.changed?.prop) {
			delta.changed.prop[propToChange] =
				delta.changed.prop[propToChange].replace(origValue, replaceValue);
		}
	}
}