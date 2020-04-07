import { Logs } from "../common/logs";

export namespace DOMUtils {
  /**
   * Convert a DOM node to a xpath expression representing the path from the
   * document element.
   * @param node
   */
  export function nodeToXPath(node: Node): string {
    // a special case for events that happen on document
    if (node === document) {
      return "document";
    }

    const el = <Element> node;
    if (el.tagName.toLowerCase() === 'html')
      return el.tagName;

    // if there is no parent node then this element has been disconnected
    // from the root of the DOM tree
    if (!el.parentNode) {
      return '';
    }

    let ix = 0;
    const siblings = el.parentNode.childNodes;
    for (let i = 0; i < siblings.length; i++) {
      const sibling = siblings[i];
      if (sibling === el) {
        return `${nodeToXPath(el.parentNode)}/${el.tagName}[${ix + 1}]`;
      }
      if (sibling.nodeType === Node.ELEMENT_NODE &&
          (<Element> sibling).tagName === el.tagName) {
        ix++;
      }
    }
    throw new ReferenceError("Could not convert to XPath.");
  }

  /**
   * Convert a xpath expression to a set of matching nodes.
   * @param xpath
   */
  export function xPathToNodes(xpath: string): Node[] {
    // a special case for events that happen on document
    if (xpath === "document") {
      return [document];
    }

    try {
      var lowerCaseXpath = xpath.toLowerCase();
      if (lowerCaseXpath.includes("/svg")) {
        // ok, have to mess around with the prefixes for the svg components
        const components = lowerCaseXpath.split("/");
        let foundSvg = false;
        for (let i = 0; i < components.length; i++) {
          const c = components[i];
          if (c.startsWith("svg")) {
            foundSvg = true;
          }
          if (foundSvg) {
            components[i] = "svg:" + c;
          }
        }
        xpath = components.join("/");
      }

      const q = document.evaluate(xpath, document, (prefix) => { 
        if (prefix === 'svg') {
          return 'http://www.w3.org/2000/svg';
        }
        else {
          return null;  // the default namespace
        }
      }, XPathResult.ANY_TYPE, null);
      
      const results = [];

      let next = q.iterateNext();
      while (next) {
        results.push(next);
        next = q.iterateNext();
      }
      return results;
    } catch (e) {
      Logs.getLog('misc').error('xPath throws error when evaluated:', xpath);
    }
    return [];
  }

  /**
   * Convert a xpath expression representing the path from root to a node.
   * @param xpath
   */
  export function simpleXPathToNode(xpath: string) {
    // error was thrown, attempt to just walk down the dom tree
    let currentNode = <Element> document.documentElement;
    const paths = xpath.split('/');
  
    // assume first path is "HTML"
    paths: for (let i = 1; i < paths.length; ++i) {
      const children = currentNode.children;
      const path = paths[i];
      const splits = path.split(/\[|\]/);

      const tag = splits[0];
      let index = 1;
      if (splits.length > 1) {
        index = parseInt(splits[1]);
      }

      let seen = 0;
      children: for (var j = 0; j < children.length; ++j) {
        const c = children[j];
        if (c.tagName === tag) {
          seen++;
          if (seen === index) {
            currentNode = c;
            continue paths;
          }
        }
      }
      Logs.getLog('misc').error('xpath child cannot be found', xpath);
      return null;
    }
    return [currentNode];
  }

  /* Convert xpath to a single node */
  /*
  export function xPathToNode(xpath) {
    var nodes = xPathToNodes(xpath);
    //if we don't successfully find nodes, let's alert
    if (nodes.length != 1)
      Logs.getLog('misc').error("xpath doesn't return strictly one node", xpath);

    if (nodes.length >= 1)
      return nodes[0];
    else
      return null;
  }

  export function isElement(obj) {
    try {
      //Using W3 DOM2 (works for FF, Opera and Chrom)
      return obj instanceof HTMLElement;
    }
    catch (e) {
      //Browsers not supporting W3 DOM2 don't have HTMLElement and
      //an exception is thrown and we end up here. Testing some
      //properties that all elements have. (works on IE7)
      return (typeof obj === 'object') &&
        (obj.nodeType === 1) && (typeof obj.style === 'object') &&
        (typeof obj.ownerDocument === 'object');
    }
  }*/
}