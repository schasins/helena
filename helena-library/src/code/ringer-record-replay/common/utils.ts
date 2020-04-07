import { RingerParams } from "./params";

export interface Indexable {
  [key: string]: any;
}

export namespace Utilities {
  /**
   * Clone an object.
   * @param obj 
   */
  export function clone(obj: object) {
    return JSON.parse(JSON.stringify(obj));
  }

  /**
   * Get the longest common sub-expression of two URLs.
   * @param x 
   * @param y 
   */
  function lcs(x: string, y: string) {
    let s, i, j, m, n,
      lcs = [], row = [], c = [],
      left, diag, latch;
    //make sure shorter string is the column string
    if (x.length < y.length) {s = x;x = y;y = s;}
    m = x.length;
    n = y.length;
    //build the c-table
    for (j = 0; j < n; row[j++] = 0);
    for (i = 0; i < m; i++) {
      c[i] = row = row.slice();
      for (diag = 0, j = 0; j < n; j++, diag = latch) {
        latch = row[j];
        if (x[i] == y[j]) {row[j] = diag + 1;}
        else {
          left = row[j - 1] || 0;
          if (left > row[j]) {row[j] = left;}
        }
      }
    }
    i--, j--;
    //row[j] now contains the length of the lcs
    //recover the lcs from the table
    while (i > -1 && j > -1) {
      if (i && c[i - 1][j]) {
        i--;
        continue;
      } else if (j && c[i][j - 1]) {
        j--;
      } else {
        j--;
        lcs.unshift(x[i]);
      }
    }
    return lcs.join('');
  }

  /**
   * Get the Levenshtein distance of two strings.
   * @param a 
   * @param b 
   */
  export function levenshteinDistance(a: string, b: string) {
    if (a.length === 0) return b.length; 
    if (b.length === 0) return a.length; 

    const matrix = [];

    // increment along the first column of each row
    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }

    // increment each column in the first row
    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }

    // Fill in the rest of the matrix
    for(let i = 1; i <= b.length; i++) {
      for(let j = 1; j <= a.length; j++) {
        if (b.charAt(i-1) === a.charAt(j-1)) {
          matrix[i][j] = matrix[i-1][j-1];
        } else {
          matrix[i][j] = Math.min(matrix[i-1][j-1] + 1, // substitution
                                  Math.min(matrix[i][j-1] + 1, // insertion
                                           matrix[i-1][j] + 1)); // deletion
        }
      }
    }

    return matrix[b.length][a.length];
  }

  /**
   * Decide whether two urls are the same.
   * @param similarity Threshold between 0 and 1 (most similar) which needs to
   *   be met.
   * @returns true if two urls match
   */
  export function matchUrls(origUrl: string, matchedUrl: string,
      similarity: number) {
    if (!similarity) {
      similarity = RingerParams.params.replay.urlSimilarity;
    }

    const commonUrl = lcs(origUrl, matchedUrl);
    const commonRatio = commonUrl.length /
                        Math.max(origUrl.length, matchedUrl.length);

    if (commonRatio > similarity) {
      return true;
    }

    const origURLObj = new URL(origUrl);
    const matchedURLObj = new URL(matchedUrl);

    return origURLObj.hostname === matchedURLObj.hostname &&
      origURLObj.pathname === matchedURLObj.pathname;
  }

  export function truncateDictionaryStrings(dict: Indexable,
     stringLengthLimit: number, keysToSkip: string[]) {
    for (const key in dict){
      const val = dict[key];
      if (!keysToSkip.includes(key) && typeof val === 'string' &&
          val.length > stringLengthLimit){
        dict[key] = val.slice(0, stringLengthLimit);
      }
    }
  }
}