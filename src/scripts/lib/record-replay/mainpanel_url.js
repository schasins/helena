/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set shiftwidth=2 tabstop=2 autoindent cindent expandtab: */

'use strict';

var matchUrls;

(function() {
  var log = getLog('url');

  /* Decide whether two urls are the 'same'
   * @param {number} similarity Threshold between 0 and 1 (most similar) which
   *     needs to be met.
   * @returns {boolean} True if two urls match
   */
  matchUrls = function _matchUrls(origUrl, matchedUrl, similarity) {
    if (!similarity)
      similarity = params.replay.urlSimilarity;

    var commonUrl = lcs(origUrl, matchedUrl);
    var commonRatio = commonUrl.length /
                      Math.max(origUrl.length, matchedUrl.length);
    if (commonRatio > similarity)
      return true;

    var origAnchor = $('<a>', { href: origUrl })[0];
    var matchedAnchor = $('<a>', { href: matchedUrl })[0];

    return origAnchor.hostname == matchedAnchor.hostname &&
        origAnchor.pathname == matchedAnchor.pathname;
  };
  
  /* Longest common subexpression */
  function lcs(x, y) {
    var s, i, j, m, n,
      lcs = [], row = [], c = [],
      left, diag, latch;
    //make sure shorter string is the column string
    if (m < n) {s = x;x = y;y = s;}
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
      switch (c[i][j]) {
        default: j--;
          lcs.unshift(x[i]);
        case (i && c[i - 1][j]): i--;
          continue;
        case (j && c[i][j - 1]): j--;
      }
    }
    return lcs.join('');
  }

})();
