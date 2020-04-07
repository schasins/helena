import * as Blockly from "blockly";

import { HelenaConsole } from "../../common/utils/helena_console";
import { HelenaMainpanel } from "../helena_mainpanel";
import { HelenaProgram } from "../lang/program";

export class HelenaUIBase {
  private workspace?: Blockly.WorkspaceSvg;

  private toolboxId?: string;
  private blocklyAreaId?: string;
  private blocklyDivId?: string;
  private containerId?: string;
  private helenaProg: HelenaProgram | null;

  private maxWaitsForDivAppearance = 10;
  private currWaitsForDivAppearance = 0;
  
  constructor() {
    // TODO: cjbaik: cannot change this because it is imported. Is there a way
    //   to change it globally other than forking the entire Blockly library??
    // control blockly look and feel
    // Blockly.HSV_SATURATION = 0.7;
    // Blockly.HSV_VALUE = 0.97;
  }

  public setBlocklyDivIds(containerIdA: string, toolboxIdA: string,
    blocklyAreaIdA: string, blocklyDivIdA: string) {
    this.containerId = containerIdA;
    this.toolboxId = toolboxIdA;
    this.blocklyAreaId = blocklyAreaIdA;
    this.blocklyDivId = blocklyDivIdA;
  }

  public setBlocklyProgram(helenaProgObj: HelenaProgram | null) {
    this.helenaProg = helenaProgObj;
    this.blocklyReadjustFunc();
  }

  private retrieveBlocklyComponent(componentId?: string) {
    if (!componentId) {
      return null;
    }
    let containerDiv = $($("#" + this.containerId)[0]);
    let componentDiv = containerDiv.find("#" + componentId)[0];
    return componentDiv;
  }

  public updateBlocklyToolbox() {
    HelenaConsole.log("updateBlocklyToolbox");
    let toolboxDiv = this.retrieveBlocklyComponent(this.toolboxId);

    if (!toolboxDiv) {
      throw new ReferenceError("Could not get toolboxDiv.");
    }
    let $toolboxDiv = $(toolboxDiv);

    // before we can use the toolbox, we have to actually have all the relevant
    //   blocks
    window.helenaMainpanel.updateToolboxBlocks(this.helenaProg);
    
    $toolboxDiv.html("");
    for (const key in window.helenaMainpanel.blocklyLabels){
      let bls = window.helenaMainpanel.blocklyLabels[key];
      let $categoryDiv = $("<category name=" + key + ">");
      for (let i = 0; i < bls.length; i++){
        $categoryDiv.append($("<block type=\"" + bls[i] + "\"></block>"));
      }
      $toolboxDiv.append($categoryDiv);
    }
    
    if (this.workspace) {
      this.workspace.updateToolbox($toolboxDiv[0]);
    } else {
      HelenaConsole.warn("Tried to update toolbox before the workspace " +
        "was initialized (should be done with setUpBlocklyEditor).");
    }
  }

  private handleNewWorkspace() {
    // let's handle a little bit of blockly workspace stuff
    // specifically, we want to listen for any move events so that we can add new WAL statements to the loopy prog
    // when they're dragged in from the toolbox
    // todo: right now this only handles the case where a new block is dragged in from the toolbox
    // eventually should handle the case where existing blocks are being rearranged
    // and should keep in mind that the blocks mostly move in groupings, not just singly.  will have to test that

    // todo: reminder that the below (for now) still doesn't handle adding a new statement to the beginning of a program
    // because we focus on the block that moved rather than on the block towards which it moved...
    // todo: also, what will happen when someone moves out a big slice, then tries to move out a smaller slice and add
    // it to the already-taken-out slice?  it won't be in the root Helena program, so...we'll look for it and not find it
    // probably should have a list of other segments?  yeah, let's do that?

    const self = this;

    function onBlockMove(event: Event) {
      if (event.type === Blockly.Events.MOVE){
        // this might have changed our program.  let's go ahead and update it
        self.blocklyToHelena(self.helenaProg);
      }
      /* cjbaik: to the best of my knowledge, "newblocklyblockdraggedin"
               doens't exist in the codebase
      if (self.newBlocklyBlockDraggedIn && event.type === window.Blockly.Events.CREATE){
        let createdBlock = self.workspace.getBlockById(event.blockId);
        self.newBlocklyBlockDraggedIn(createdBlock);
      }*/
    }

    this.workspace?.addChangeListener(onBlockMove);
  }

  public blocklyReadjustFunc() {
    let blocklyArea = this.retrieveBlocklyComponent(this.blocklyAreaId);
    let blocklyDiv = this.retrieveBlocklyComponent(this.blocklyDivId);
    if (!blocklyArea || !blocklyDiv) {
      return;
    }
    // compute the absolute coordinates and dimensions of blocklyArea.
    let element = blocklyArea;
    let x = 0;
    let y = 0;
    do {
      x += element.offsetLeft;
      y += element.offsetTop;
      element = <HTMLElement> element.offsetParent;
    } while (element);
  
    // Position blocklyDiv over blocklyArea.
    blocklyDiv.style.left = x + 'px';
    blocklyDiv.style.top = y + 'px';
    blocklyDiv.style.width = blocklyArea.offsetWidth + 'px';
    blocklyDiv.style.height = blocklyArea.offsetHeight + 'px';
  };

  public setUpBlocklyEditor(updateToolbox = true) {
    HelenaConsole.log("handleBlocklyEditorResizing");
    let toolboxDiv = this.retrieveBlocklyComponent(this.toolboxId);
    let blocklyArea = this.retrieveBlocklyComponent(this.blocklyAreaId);
    let blocklyDiv = this.retrieveBlocklyComponent(this.blocklyDivId);
    if (!blocklyArea || !blocklyDiv){
      HelenaConsole.warn("Tried to set up the blockly editor display, but the blockly area or div not present now.");
      console.log(blocklyArea, blocklyDiv);
      if (this.currWaitsForDivAppearance < this.maxWaitsForDivAppearance) {
        setTimeout(this.setUpBlocklyEditor, 100);
        this.currWaitsForDivAppearance += 1;
      }
      return;
    }

    this.workspace = Blockly.inject(blocklyDiv, {
      toolbox: toolboxDiv? toolboxDiv : undefined
    });
    console.log("Updated workspace to:", this.workspace);
    this.handleNewWorkspace();

    const self = this;
    window.addEventListener('resize', () => self.blocklyReadjustFunc(), false);
    this.blocklyReadjustFunc();
    // the blockly thing hovers over a node, so it's important that we call its update function whenever that node may have moved
    let observer = new MutationObserver((mutations, observer) =>
      self.blocklyReadjustFunc()
    );
    // Register the element root you want to look for changes
    observer.observe(document, {
      subtree: true,
      attributes: true
    });

    Blockly.svgResize(this.workspace);

    if (updateToolbox) {
      this.updateBlocklyToolbox();
    }
  }

  public displayBlockly(program: HelenaProgram) {
    this.updateBlocklyToolbox();
    if (program && this.workspace) {
      program.displayBlockly(this.workspace);
    } else {
      HelenaConsole.warn("Called displayBlockly, but no program to " +
        "display yet.  Should be set with setBlocklyProgram.");
    }
  }

  /* cjbaik: seems not to be used
  private quickSizeEstimate(ls) {
    let acc = 0;
    acc += ls.length;
    for (let i = 0; i < ls.length; i++){
      if (ls[i].bodyStatements){
        acc += this.quickSizeEstimate(ls[i].bodyStatements);
      }
    }
    return acc;
  }*/

  public blocklyToHelena(program: HelenaProgram | null) {
    if (!this.workspace) {
      throw new ReferenceError("Workspace is not set.");
    }

    let roots = this.workspace.getTopBlocks(false);

    if (!program) {
      throw new ReferenceError("Program is not provided.");
    }
    let statementLs = program.currentStatementLs();
    for (const r of roots) {
      if (r === statementLs[0].block){
        // found the program root
        let helenaStatements = HelenaMainpanel.getHelenaFromBlocklyRoot(r);
        program.bodyStatements = helenaStatements;
      }
    }
  }
}

