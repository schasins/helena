import * as Blockly from "blockly";
import { HelenaConsole } from "../../common/utils/helena_console";
import { HelenaLangObject } from "../lang/helena_lang";

export namespace HelenaBlocks {
  export function attachInputToOutput(left: Blockly.Block,
      right: Blockly.Block) {
    if (!left || !right) {
      HelenaConsole.warn("Woah, tried attachInputToOutput with", left,
        right);
      return;
    }
    const outputBlockConnection = right.outputConnection;
    const inputBlockConnection = left.inputList[0].connection;
    outputBlockConnection.connect(inputBlockConnection);
  }

  /**
   * For things like loops that have bodies, attach the nested blocks
   * @param wrapper 
   * @param firstBlock 
   */
  export function attachNestedBlocksToWrapper(
      wrapper: Blockly.Block | null,
      firstBlock: Blockly.Block | null) {
    if (!wrapper || !firstBlock) {
      HelenaConsole.warn("Woah, tried attachNestedBlocksToWrapper with",
        wrapper, firstBlock);
      return;
    }
    const parentConnection = wrapper.getInput('statements').connection;
    const childConnection = firstBlock.previousConnection;
    parentConnection.connect(childConnection);
  }

  export function attachToInput(left: Blockly.Block, right: Blockly.Block,
      name: string) {
    if (!left || !right || !name) {
      HelenaConsole.warn("Woah, tried attachToInput with", left,
        right, name);
      return;
    }
    const parentConnection = left.getInput(name).connection;
    const childConnection = right.outputConnection;
    parentConnection.connect(childConnection);
  }

  /**
   * Attach the current block to the previous block.
   * @param cur the current block
   * @param prev the previous block.
   */
  export function attachToPrevBlock(cur: Blockly.Block, prev: Blockly.Block) {
    if (cur && prev) {
      const prevBlockConnection = prev.nextConnection;
      const thisBlockConnection = cur.previousConnection;
      prevBlockConnection.connect(thisBlockConnection);
    } else {
      HelenaConsole.warn("Woah, tried to attach to a null prevBlock!");
    }
  }

  export function helenaSeqToBlocklySeq(stmts: HelenaLangObject[],
    workspace: Blockly.WorkspaceSvg) {
    // get the individual statements to produce their corresponding blockly
    //   blocks

    // the one we'll ultimately return, in case it needs to be attached to
    //   something outside
    let firstNonNull = null;

    let lastBlock = null;
    let lastStatement = null;

    let invisibleHead = [];

    // for (var i = 0; i < statementsLs.length; i++) {
    for (const stmt of stmts) {
      const newBlock = stmt.genBlocklyNode(lastBlock, workspace);
      // within each statement, there can be other program components that will
      //   need blockly representations but the individual statements are
      //   responsible for traversing those
      if (newBlock !== null) {
        // handle the fact that there could be null-producing nodes in the
        //   middle, and need to connect around those
        lastBlock = newBlock;
        lastStatement = stmt;
        lastStatement.invisibleHead = [];
        lastStatement.invisibleTail = [];
        // also, if this is our first non-null block it's the one we'll want to
        //   return
        if (!firstNonNull) {
          firstNonNull = newBlock;
          // oh, and let's go ahead and set that invisible head now
          stmt.invisibleHead = invisibleHead;
        }
      } else {
        // ok, a little bit of special stuff when we do have null nodes
        // we want to still save them, even though we'll be using the blockly
        //   code to generate future versions of the program so we'll need to
        //   associate these invibislbe statements with others and then the only
        //   thing we'll need to do is when we go the other direction
        //   (blockly->helena)
        // we'll have to do some special processing to put them back in the
        //   normal structure
        stmt.nullBlockly = true;

        // one special case.  if we don't have a non-null lastblock, we'll have
        //   to keep this for later
        // we prefer to make things tails of earlier statements, but we can make
        //   some heads if necessary
        if (!lastBlock || !lastStatement) {
          invisibleHead.push(stmt);
        } else {
          lastStatement.invisibleTail?.push(stmt);
        }
      }
    }

    if (!firstNonNull) {
      throw new ReferenceError("Did not find any non-null blocks.");
    }

    return firstNonNull;
    // todo: the whole invisible head, invisible tail thing isn't going to be
    //   any good if we have no visible statements in this segment.  So rare
    //   that spending time on it now is probably bad, but should be considered
    //   eventually
  }
}