import * as _ from "underscore";

export namespace DOMCreation {
  export function replaceContent(div1: JQuery<HTMLElement>,
      div2: JQuery<HTMLElement>){
    const div2clone = div2.clone();
    div1.html(div2clone.html());
  }

  export function arrayOfTextsToTableRow(array: string[]) {
    const $tr = $("<tr></tr>");
    for (const item of array) {
      var $td = $("<td></td>");
      $td.html(_.escape(item).replace(/\n/g,"<br>"));
      $tr.append($td);
    }
    return $tr;
  }

  export function arrayOfArraysToTable(arrayOfArrays: string[][]) {
    const $table = $("<table></table>");
    for (const array of arrayOfArrays) {
      $table.append(arrayOfTextsToTableRow(array));
    }
    return $table;
  }

  export function toggleDisplay(node: JQuery<HTMLElement>) {
    console.log(node);
    if (node.css("display") === "none") {
      node.css("display", "inline");
    } else {
      node.css("display", "none");
    }
  }
}