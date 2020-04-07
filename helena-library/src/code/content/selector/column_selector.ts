import { XPath } from "../utils/xpath";
import SuffixXPathList = XPath.SuffixXPathList;
import { ColumnSelectorMessage } from "../../common/messages";
import { MiscUtilities } from "../../common/misc_utilities";
import { IColumnSelector } from "./interfaces";

/**
  * A selector describing how to extract a column of a relation with respect to
  *   some kind of common ancestor describing a row.
  */
export namespace ColumnSelector {
  export function fromMessage(msgCols: ColumnSelectorMessage[]) {
    let result: IColumnSelector[] = [];

    for (const msgCol of msgCols) {
      if (MiscUtilities.depthOf(msgCol.suffix) < 3) {
        result.push({
          xpath: msgCol.xpath,
          suffix: [<SuffixXPathList> msgCol.suffix],
          name: msgCol.name,
          id: msgCol.id,
          index: msgCol.index? parseInt(msgCol.index) : undefined
        });
      } else {
        result.push({
          xpath: msgCol.xpath,
          suffix: <SuffixXPathList[]> msgCol.suffix,
          name: msgCol.name,
          id: msgCol.id,
          index: msgCol.index? parseInt(msgCol.index) : undefined
        });
      }
    }
    return result;
  }
  
  /**
   * Gets array of {@link IColumnSelector} of each descendant element
   *   given the ancestor element.
   * @param ancestor ancestor element
   * @param descendants descendant elements
   */
  export function compute(ancestor: HTMLElement,
    descendants: (HTMLElement | null)[]) {
    let columns: IColumnSelector[] = [];
    for (const descendant of descendants) {
      if (!descendant) {
        throw new ReferenceError('TODO: This descendant is null. Handle it?');
      }
      let xpath = <string> XPath.fromNode(descendant);
      let suffix = XPath.suffixFromAncestor(ancestor, descendant);
      columns.push({
        xpath: xpath,
        suffix: [suffix],
        id: null
      });
    }
    return columns;
  }
}