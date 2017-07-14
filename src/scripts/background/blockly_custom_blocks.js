'use strict'

Blockly.Blocks['scraping_for_each'] = {
  init: function() {
    this.jsonInit({
  "type": "scraping_for_each",
  "message0": "for each COLUMN_NAMES in %1 in %2 %3 do %4",
  "args0": [
    {
      "type": "field_dropdown",
      "name": "list",
      "options": [
        [
          "list1",
          "list1"
        ],
        [
          "list2",
          "list2"
        ],
        [
          "list3",
          "list3"
        ]
      ]
    },
    {
      "type": "field_dropdown",
      "name": "tab",
      "options": [
        [
          "tab1",
          "tab1"
        ],
        [
          "tab2",
          "tab2"
        ],
        [
          "tab3",
          "tab3"
        ]
      ]
    },
    {
      "type": "input_dummy"
    },
    {
      "type": "input_statement",
      "name": "statements"
    }
  ],
  "previousStatement": null,
  "nextStatement": null,
  "colour": 44,
  "tooltip": "",
  "helpUrl": ""
});
  }
};