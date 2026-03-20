/**
 * Score calculation for Crossplay moves.
 * Port of crossplay_helper/solver/scorer.py
 */

import { BINGO_BONUS, LETTER_MULTIPLIER, RACK_SIZE, TILE_VALUES, WORD_MULTIPLIER } from '../config.js';

/**
 * @typedef {Object} Move
 * @property {number} row
 * @property {number} col
 * @property {string} direction - "across" or "down"
 * @property {string} word - full word formed (including existing tiles)
 * @property {{row:number,col:number,letter:string}[]} tilesPlaced
 * @property {number} [score]
 */

/**
 * Calculate total score for a move.
 *
 * @param {Move} move
 * @param {import('./board.js').Board} board
 * @returns {number}
 */
export function scoreMove(move, board) {
  const placedSet = new Set(move.tilesPlaced.map(t => `${t.row},${t.col}`));
  const blankSet = new Set();
  for (const t of move.tilesPlaced) {
    // Blank tiles are represented as lowercase letters
    if (t.letter !== t.letter.toUpperCase() || t.letter === t.letter.toLowerCase() && t.letter !== t.letter.toUpperCase()) {
      blankSet.add(`${t.row},${t.col}`);
    }
  }
  // Recompute blank positions: lowercase and it IS a letter (a-z)
  blankSet.clear();
  for (const t of move.tilesPlaced) {
    if (/^[a-z]$/.test(t.letter)) {
      blankSet.add(`${t.row},${t.col}`);
    }
  }

  let total = 0;
  const [dr, dc] = move.direction === 'across' ? [0, 1] : [1, 0];

  // Score main word
  let mainWordScore = 0;
  let mainWordMultiplier = 1;
  let r = move.row, c = move.col;
  for (const ch of move.word) {
    const key = `${r},${c}`;
    const isBlank = blankSet.has(key);
    let letterVal = isBlank ? 0 : (TILE_VALUES[ch.toUpperCase()] || 0);
    const premium = board.premiumAt(r, c);

    if (placedSet.has(key)) {
      letterVal *= LETTER_MULTIPLIER[premium] || 1;
      mainWordMultiplier *= WORD_MULTIPLIER[premium] || 1;
    }
    mainWordScore += letterVal;
    r += dr; c += dc;
  }
  total += mainWordScore * mainWordMultiplier;

  // Score cross-words
  const [crossDr, crossDc] = move.direction === 'across' ? [1, 0] : [0, 1];

  for (const placed of move.tilesPlaced) {
    const { row: pr, col: pc, letter: placedLetter } = placed;

    // Find start of cross-word
    let startR = pr, startC = pc;
    while (true) {
      const nr = startR - crossDr, nc = startC - crossDc;
      if (!board.inBounds(nr, nc)) break;
      const existing = board.get(nr, nc);
      if (existing === null && !placedSet.has(`${nr},${nc}`)) break;
      startR = nr; startC = nc;
    }

    // Collect cross-word tiles
    const crossWord = [];
    let cr = startR, cc = startC;
    while (board.inBounds(cr, cc)) {
      let tile = board.get(cr, cc);
      if (tile === null && placedSet.has(`${cr},${cc}`)) {
        // Find the placed tile at this position
        const pt = move.tilesPlaced.find(t => t.row === cr && t.col === cc);
        tile = pt ? pt.letter : null;
      } else if (tile === null) {
        break;
      }
      crossWord.push({ r: cr, c: cc, ch: tile });
      cr += crossDr; cc += crossDc;
    }

    if (crossWord.length <= 1) continue;

    let crossScore = 0;
    let crossMultiplier = 1;
    for (const { r: cr2, c: cc2, ch } of crossWord) {
      const key = `${cr2},${cc2}`;
      const isBlank = blankSet.has(key);
      let letterVal = isBlank ? 0 : (TILE_VALUES[ch.toUpperCase()] || 0);
      const premium = board.premiumAt(cr2, cc2);

      if (placedSet.has(key)) {
        letterVal *= LETTER_MULTIPLIER[premium] || 1;
        crossMultiplier *= WORD_MULTIPLIER[premium] || 1;
      }
      crossScore += letterVal;
    }
    total += crossScore * crossMultiplier;
  }

  // Bingo/sweep bonus
  if (move.tilesPlaced.length >= RACK_SIZE) {
    total += BINGO_BONUS;
  }

  return total;
}
