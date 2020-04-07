import { XPath } from "../utils/xpath";
import SuffixXPathList = XPath.SuffixXPathList;

/**
 * Types of next or more buttons.
 */
export enum NextButtonTypes {
  NONE = 1,
  NEXTBUTTON,
  MOREBUTTON,
  SCROLLFORMORE
}

export interface INextButtonSelector {
  id: string;
  class: string;
  src: string | null;
  frame_id?: number;
  tag: string;
  text: string | null;
  xpath: string;
}

export interface IColumnSelector {
  xpath?: string;
  suffix?: SuffixXPathList[]; // not single suffix, but a list of candidates
  name?: string;
  id?: number | null;
  index?: number;
  scraped?: boolean;

  firstRowXpath?: string;
  firstRowText?: string;
  firstRowValue?: string;
}