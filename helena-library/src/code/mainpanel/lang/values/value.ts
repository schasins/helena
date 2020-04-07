import { HelenaLangObject } from "../helena_lang";

import { MainpanelNode } from "../../../common/mainpanel_node";

export class Value extends HelenaLangObject {
  public currentVal: MainpanelNode.Interface | boolean | string | number | null;

  public getCurrentVal() {
    return this.currentVal;
  }
}