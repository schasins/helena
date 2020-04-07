import { XPath } from "../content/utils/xpath";

export namespace MainpanelNode {
  export interface Interface {
    text?: string;
    textContent?: string;
    link?: string;
    xpath?: string;
    value?: string;
    frame?: number;
    source_url?: string;
    top_frame_source_url?: string;
    date?: number;
    linkScraping?: boolean;
    scraped_attribute?: string;
  }

  /**
   * Get a {@link MainpanelNode.Interface} from a DOM node.
   * @param node DOM node
   */
  export function fromDOMNode(node: Node | null): Interface {
    const frameId = window.ringerContent.frameId;
    if (node === null) {
	    return {
	    	text: "", 
	    	textContent: "",
	    	link: "", 
	    	xpath: "", 
	    	value: "",
	    	frame: frameId? frameId : undefined, 
			  source_url: window.location.href,
	    	top_frame_source_url: window.helenaContent.tabTopUrl,
	    	date: (new Date()).getTime()
	    };
	  }
	  return {
      text: getNodeText(node),

      // it's ok if this is null or whatever.
      //   we won't show this to the user.
      //   just need it for aligning with ringer-scraped nodes
      textContent: node.textContent? node.textContent : undefined,
      
	  	link: getNodeLink(node), 
	  	xpath: XPath.fromNode(node), 
	  	value: 'value' in node? node['value'] : undefined,
	  	frame: frameId? frameId : undefined,
    	source_url: window.location.href,
    	top_frame_source_url: window.helenaContent.tabTopUrl,
		  date: (new Date()).getTime()
	  };
  }

  function getNodeTextHelper(node: Node) {
    if (node.nodeValue && (node.nodeType === Node.TEXT_NODE ||
          node.nodeType === Node.CDATA_SECTION_NODE)) {
      return node.nodeValue.trim();
		} else if (node.nodeType === 1) {
      // If node is an element (1)
      let el = <Element> node;
		  let text = "";

			// Traverse children unless this is a script or style element
			if (!el.tagName.match(/^(script|style)$/i)) {
        let children = [].slice.call(el.childNodes);
        for (const child of children) {
          let newText = getNodeTextHelper(child);
          if (newText) {
            text += newText + "\n";
          }
				}
			}

      // If img, input[type=image], or area element, return its alt text
			if (el.tagName.toLowerCase() == 'img' ||
					el.tagName.toLowerCase() == 'area' ||
          (el.tagName.toLowerCase() == 'input'
             && el.getAttribute('type')?.toLowerCase() == 'image')) {
				text += el.getAttribute('alt') || "";
			}

			if (el.tagName.toLowerCase() == 'img') {
        let imageEl = <HTMLImageElement> el;
				text += " image(" + imageEl.src + ")";
      }
      
			let compStyle = window.getComputedStyle(el, null);
      if (compStyle.backgroundImage &&
          compStyle.backgroundImage.includes("url")) {
				text += " image" + compStyle.backgroundImage; // "image url(the_url)"
			}

			let title = el.getAttribute('title');
			if (title) {
				text += " " + title;
			}
	
			text = text.trim();
			return text; // debugging checks
		}

		return null; // debugging check
  }

  /**
   * Given a DOM node, get the relevant text for Helena purposes.
   * @param node the node
   * @param recurse whether we should recurse or not
   */
  export function getNodeText(node: Node, recurse = true): string {
    let text = getNodeTextHelper(node);
    // should empty text also be null?
	  if (!text) {
      // for the case where we get null text because it's an input with a value,
      //   should scrape the value
	  	if ('value' in node) {
        let inputEl = <HTMLInputElement> node;
	  		text = inputEl.value;
	  	} else {
	  		if (recurse && node.parentNode) {
          // desperate times call for desperate measures;
          //   if we're about to return null, try returning the parent instead
	  			return getNodeText(node.parentNode, false);
        }
        throw new ReferenceError(`Could not find text for ${node}`);
	    }
	  }
	  text = text.trim();
	  return text;
  }

  /**
   * Get the link referred to by the node, if any.
   * @param node the node
   */
  function getNodeLink(node: Node) {
	  if ('href' in node) {
	    return node['href'];
	  }
    
    if (node.parentNode) {
      let parent = <Node> node.parentNode;
      if ('href' in parent) {
        return parent['href'];
      }
    }
    return "";
  }

  /**
   * Converts {@link HTMLElement}s in a relation into {@link MainpanelNode}s.
   * @param relation the relation of elements
   */
  export function convertRelation(relation: (HTMLElement | null)[][]) {
    return relation.map((row) =>
      row.map((cell) => fromDOMNode(cell))
    );
  }
}