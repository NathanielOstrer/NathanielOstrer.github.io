/**
 * GADDAG trie data structure for word lookup and move generation.
 * Port of crossplay_helper/solver/gaddag.py
 *
 * Nodes are plain objects where keys are characters (including ">" separator
 * and "#" end-of-word marker). The node IS its children map.
 *
 * For a word like CAT, we insert:
 *   C>AT, AC>T, TAC>
 */

export const SEPARATOR = ">";
export const EOW = "#";

export class GADDAG {
  constructor() {
    /** @type {Object} root node (plain object acting as children map) */
    this.root = Object.create(null);
  }

  /**
   * Add a word to the GADDAG.
   * For word w[0..n-1], insert rotations:
   *   w[i]..w[0] > w[i+1]..w[n-1] #   for i in 0..n-1
   */
  addWord(word) {
    word = word.toUpperCase();
    const n = word.length;
    for (let i = 0; i < n; i++) {
      let node = this.root;
      // Reversed prefix: w[i], w[i-1], ..., w[0]
      for (let j = i; j >= 0; j--) {
        const ch = word[j];
        if (!node[ch]) node[ch] = Object.create(null);
        node = node[ch];
      }
      // Separator
      if (!node[SEPARATOR]) node[SEPARATOR] = Object.create(null);
      node = node[SEPARATOR];
      // Suffix: w[i+1], ..., w[n-1]
      for (let j = i + 1; j < n; j++) {
        const ch = word[j];
        if (!node[ch]) node[ch] = Object.create(null);
        node = node[ch];
      }
      // End of word
      if (!node[EOW]) node[EOW] = Object.create(null);
    }
  }

  /**
   * Check if a word exists in the GADDAG.
   * Uses the first-letter path: w[0] > w[1]..w[n-1] #
   */
  isWord(word) {
    word = word.toUpperCase();
    if (!word) return false;
    let node = this.root;
    node = node[word[0]];
    if (!node) return false;
    node = node[SEPARATOR];
    if (!node) return false;
    for (let i = 1; i < word.length; i++) {
      node = node[word[i]];
      if (!node) return false;
    }
    return EOW in node;
  }

  /**
   * Build a GADDAG from a word list string (one word per line).
   */
  static fromWordList(text) {
    const gaddag = new GADDAG();
    const lines = text.split('\n');
    for (const line of lines) {
      const word = line.trim();
      if (word && /^[a-zA-Z]+$/.test(word)) {
        gaddag.addWord(word);
      }
    }
    return gaddag;
  }
}
