import { LoadStatement } from "./statements/browser/load";
import { ClickStatement } from "./statements/page_action/click";
import { PageActionStatement } from "./statements/page_action/page_action";
import { TypeStatement } from "./statements/page_action/type";

export type RingerStatement = (PageActionStatement | LoadStatement);
export type OutputPageVarStatement = (LoadStatement | ClickStatement |
  TypeStatement);