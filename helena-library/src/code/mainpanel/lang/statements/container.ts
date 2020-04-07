import { HelenaLangObject } from "../helena_lang";

/**
 * A Helena language object that contains a body of statements.
 */
export class StatementContainer extends HelenaLangObject {
  public bodyStatements: HelenaLangObject[];

  public removeChild(stmt: HelenaLangObject) {
    this.bodyStatements = this.bodyStatements?.filter(
      (bodyStmt) => bodyStmt !== stmt
    );
  }

  public removeChildren(stmts: HelenaLangObject[]) {
    this.bodyStatements = this.bodyStatements?.filter(
      (bodyStmt) => !stmts.includes(bodyStmt)
    );
  }
  
  public appendChild(stmt: HelenaLangObject) {
    this.bodyStatements.push(stmt);
    this.updateChildStatements(this.bodyStatements);
  }

  public insertChild(stmt: HelenaLangObject, index: number) {
    this.bodyStatements.splice(index, 0, stmt);
    this.updateChildStatements(this.bodyStatements);
  }

  public updateChildStatements(stmts: HelenaLangObject[]) {
    this.bodyStatements = stmts;
    for (const bodyStmt of this.bodyStatements) {
      bodyStmt.parent = this;
    }
  }
}