export namespace XPath {
  export interface XPathNode {
    nodeName: string;
    index: string;
    iterable: boolean;
  }

  export type XPathList = Array<XPathNode>;

  export class SuffixXPathList extends Array<XPathNode> {
    selectorIndex?: number;
    suffixRepresentation?: SuffixXPathList;
  }

  /**
   * Find the common ancestor of multiple elements.
   * @param elements elements
   */
  export function findCommonAncestor(elements: (HTMLElement | null)[]) {
    if (elements.length === 0) {
      throw new ReferenceError("Cannot get common ancestor of 0 nodes.");
    }

    // this doesn't handle null nodes, so filter those out first
    elements = elements.filter((el) => el && $(el).parents().length);
    let xPathLists = elements.map((node) =>
      toXPathNodeList(<string> fromNode(node)));
    let firstXPathList = xPathLists[0];
    let i: number;
    for (i = 0; i < firstXPathList.length; i++) {
      let all_match = xPathLists.every((curXPathList) =>
        curXPathList[i].nodeName === firstXPathList[i].nodeName &&
        curXPathList[i].index === firstXPathList[i].index &&
        curXPathList[i].iterable === firstXPathList[i].iterable);
      if (!all_match) {
        break;
      }
    }
    let last_matching = i - 1;
    let ancestor_xpath_list = firstXPathList.slice(0, last_matching + 1);
    let ancestor_nodes = getNodes(
      XPath.toString(ancestor_xpath_list));
    return <HTMLElement> ancestor_nodes[0];
  }

  /**
   * Check whether node has at least one descendant matching each suffix.
   * @param node node
   * @param suffixes list of suffixes
   */
  function matchesAllSuffixes(node: Node,
    suffixesList: (SuffixXPathList[] | undefined)[]){
    let elXPath = XPath.toXPathNodeList(<string> fromNode(node));
    //check whether this node has an entry for all desired suffixes
    for (const suffixes of suffixesList) {
      if (!suffixes) {
        continue;
      }
      for (const suffix of suffixes) {
        let suffixXPath = XPath.toString(elXPath.concat(suffix));
        let suffixNodes = getNodes(suffixXPath);
        if (suffixNodes.length === 0) {
          return false;
        }
      }
    }
    return true;
  }

  /**
   * Finds a sibling of a descendant of given element matching suffixes.
   * @param element element
   * @param suffixes list of {@link SuffixXPathList}s
   */
  export function findDescendantSiblingMatchingSuffixes(element: HTMLElement,
    suffixes: (SuffixXPathList[] | undefined)[]) {
    let elXPath = XPath.toXPathNodeList(<string> fromNode(element));
    
    // start at the end of the xpath, move back towards root
    for (let i = (elXPath.length - 1); i >= 0; i--) {
      let index = parseInt(elXPath[i].index);
      
      elXPath[i].index = (index + 1).toString(); // modify XPath, try next sibling
      let siblingNodes = getNodes(XPath.toString(elXPath));
      elXPath[i].index = index.toString();     // return index to original value
    
      if (siblingNodes.length > 0) {
        // [cjbaik: I presume it's not possible to have > 1 node here?]
        let siblingNode = siblingNodes[0];
        if (matchesAllSuffixes(siblingNode, suffixes)) {
          return <HTMLElement> siblingNode;
        }
      }
    }
    return null;
  }

  /**
   * Get the suffix of the descendant with respect to the ancestor.
   * @param ancestor ancestor node
   * @param descendant descendant node
   */
  export function suffixFromAncestor(ancestor: Node, descendant: Node):
    XPathNode[] {
    let ancestorList = XPath.toXPathNodeList(<string> fromNode(ancestor));
    let descList = XPath.toXPathNodeList(<string> fromNode(descendant));
    return descList.slice(ancestorList.length, descList.length);
  }

  /**
   * Convert a DOM node to an XPath expression representing the path from the
   *   document element.
   * @param node the DOM node
   */
  export function fromNode(node?: Node | null): string {
    // a special case for events that happen on document
    if (node === document){
      return "document";
    }

    if (node === null || node === undefined){
      return "";
    }

    let element = <HTMLElement> node;

    if (element.tagName.toLowerCase() === 'html') {
      return element.tagName;
    }

    // if there is no parent node then this element has been disconnected
    // from the root of the DOM tree
    if (!element.parentElement) {
      return '';
    }

    let ix = 0;
    let siblings = element.parentElement.children;
    for (let i = 0, ii = siblings.length; i < ii; i++) {
      let sibling = siblings[i];
      if (sibling === element) {
        return fromNode(element.parentElement) + '/' + element.tagName +
              '[' + (ix + 1) + ']';
      }
      if (sibling.nodeType === 1 && sibling.tagName === element.tagName) {
        ix++;
      }
    }
    throw new ReferenceError('Child node does not belong to its own parent!');
  }

  /**
   * Get DOM nodes matching the XPath expression on the current document.
   * @param xpath XPath expression
   */
  export function getNodes(xpath: string) {
    // a special case for events that happen on document
    if (xpath === "document") {
      return [document];
    }
    try {
      let lowerCaseXpath = xpath.toLowerCase();
      if (lowerCaseXpath.indexOf("/svg") > -1){
        // ok, have to mess around with the prefixes for the svg components
        let components = lowerCaseXpath.split("/");
        let foundSvg = false;
        for (let i = 0; i < components.length; i++){
          let c = components[i];
          if (c.startsWith("svg")){
            foundSvg = true;
          }
          if (foundSvg){
            components[i] = "svg:" + c;
          }
        }
        xpath = components.join("/");
      }
  
      let q = document.evaluate(xpath, document, (prefix: string) => { 
          if (prefix === 'svg') {
            return 'http://www.w3.org/2000/svg';
          }
          else {
            return null; // the default namespace
          }
        }, XPathResult.ANY_TYPE, null);
      let results = [];
  
      let next = q.iterateNext();
      while (next) {
        results.push(next);
        next = q.iterateNext();
      }
      return results;
    } catch (e) {
      console.error('xPath throws error when evaluated:', xpath);
    }
    return [];
  }

  /**
   * Returns the first {@link HTMLElement} corresponding to each supplied XPath
   *   expression.
   * @param xpaths XPath expressions
   */
  export function getFirstElementOfEach(xpaths: string[]) {
    if (!xpaths || xpaths.length === 0){
      console.warn("No xpaths supplied.");
      return [];
    }
    let elements = [];
    for (const xpath of xpaths) {
      let element = XPath.getNodes(xpath)[0];
      if (!element) {
        // todo: this may not be the right thing to do!
        // for now we're assuming that if we can't find a node at this xpath,
        //   it's because we jumbled in the nodes from a different page into the
        //   relation for this page (becuase no updat to url or something); but
        //   it may just mean that this page changed super super quickly, since
        //   the recording
        continue;
      }
      elements.push(<HTMLElement> element);
    }
    return elements;
  }

  /**
   * Convert an XPath expression string to a list of {@link XPathNode}s.
   * @param xpath XPath expression
   */
  export function toXPathNodeList(xpath: string) {
    let xpathList: XPathNode[] = [];
    if (!xpath) {
      return xpathList;
    }
    for (let i = 0; i < xpath.length; i++) {
      let char = xpath[i];
      if (char === "[") {
        let start = i;
        let end = start + 1;
        while (xpath[end] !== "]") {
          end += 1;
        }
        let prefix = xpath.slice(0, start); //don't include brackets
        let slashIndex = prefix.lastIndexOf("/");
        let nodeName = prefix.slice(slashIndex + 1, prefix.length);
        let index = xpath.slice(start + 1, end);
        xpathList.push({
          nodeName: nodeName, 
          index: index,
          iterable: false
        });
      }
    }
    return xpathList;
  }

  /**
   * Check if `toCheck` is matchable by the {@link XPathList} `withIterables`
   *   which contains iterables/wildcards.
   * @param withIterables the list with iterables (i.e. generalized version)
   * @param toCheck the specific xpath to check
   * @returns true if matches, false otherwise
   */
  export function matches(withIterables: XPathList, toCheck: XPathList) {
    if (withIterables.length !== toCheck.length){
      return false;
    }
    for (let i = 0; i < withIterables.length; i++){
      let targetNode = withIterables[i];
      let node = toCheck[i];
      if (targetNode.nodeName !== node.nodeName){
        return false;
      }
      if (targetNode.iterable === false && targetNode.index !== node.index){
        return false;
      }
    }
    return true;
  }

  /**
   * Merge multiple {@link XPathList}s with overlapping sections using the
   *   `iterable` key in the XPathNode. This is equivalent to a wildcard
   *   in a XPath expression.
   * @param withIterables the list with iterables (i.e. merged version)
   * @param toMerge the xpath to merge in
   * @returns true if successful, false if cannot be merged
   */
  export function merge(withIterables: XPathList, toMerge: XPathList) {
    if (withIterables.length !== toMerge.length) {
      return false;
    }
    let indicesToMarkIterable = [];
    for (let i = 0; i < withIterables.length; i++) {
      let targetNode = withIterables[i];
      let node = toMerge[i];
      if (targetNode.nodeName !== node.nodeName) {
        return false;
      }
      if (targetNode.iterable === false && targetNode.index !== node.index) {
        indicesToMarkIterable.push(i);
      }
    }
    for (const index of indicesToMarkIterable) {
      withIterables[index].iterable = true;
    }
    return true;
  }

  /**
   * "Shrink" a list of {@link XPathList}s by merging them into the smallest
   *   possible set.
   * @param listOfXPathLists list of {@link XPathList}s
   */
  export function condenseList(listOfXPathLists: XPathList[]) {
    if (listOfXPathLists.length < 2){
      return listOfXPathLists;
    }
    let finalListOfXPathLists = [];
    finalListOfXPathLists.push(listOfXPathLists[0]);
    for (let i = 1; i < listOfXPathLists.length; i++) {
      let newXPathList = listOfXPathLists[i];
      let success = false;
      for (let j = 0; j < finalListOfXPathLists.length; j++) {
        let candidate = finalListOfXPathLists[j];
        success = merge(candidate, newXPathList);
        //in case of success, candidate_match will now contain the
        //updated, merged xpath
        if (success) {
          break;
        }
      }
      if (!success) {
        //since couldn't match the new xpath with existing xpaths, add it
        finalListOfXPathLists.push(newXPathList);
      }
    }
    return finalListOfXPathLists;
  }

  /**
   * Return the string representation of the {@link XPathList}.
   * @param xPathList the XPath list
   */
  export function toString(xPathList: XPathList) {
    let str = "";
    for (const node of xPathList){
      str += node.nodeName;
      if (node.iterable) {
        str += "[*]/";
      } else {
        str += "[" + node.index + "]/";
      }
    }
    //add the HTML back to the beginning, remove the trailing slash
    return "HTML/"+str.slice(0,str.length-1);
  }
}