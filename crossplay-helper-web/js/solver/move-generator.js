/**
 * GADDAG-based move generator for Crossplay.
 * Port of crossplay_helper/solver/move_generator.py
 */

import { BOARD_SIZE, CENTER } from '../config.js';
import { SEPARATOR, EOW } from './gaddag.js';
import { scoreMove } from './scorer.js';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Find all legal moves and return them sorted by score descending.
 *
 * @param {import('./board.js').Board} board
 * @param {string[]} rack - array of tile letters (uppercase, '?' for blank)
 * @param {import('./gaddag.js').GADDAG} gaddag
 * @returns {Object[]} sorted moves
 */
export function generateMoves(board, rack, gaddag) {
  const moves = [];

  // Precompute cross-sets for all empty squares
  const crossSets = new Map();
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board.isOccupied(r, c)) continue;
      for (const direction of ['across', 'down']) {
        const cs = board.getCrossSet(r, c, direction, gaddag);
        crossSets.set(`${r},${c},${direction}`, cs);
      }
    }
  }

  const anchors = board.getAnchors();
  const isFirstMove = board.isBoardEmpty();

  for (const direction of ['across', 'down']) {
    for (const [anchorR, anchorC] of anchors) {
      generateFromAnchor(
        board, rack, gaddag, anchorR, anchorC,
        direction, crossSets, moves, isFirstMove
      );
    }
  }

  // Score and sort
  for (const move of moves) {
    move.score = scoreMove(move, board);
  }
  moves.sort((a, b) => b.score - a.score);

  // Deduplicate
  return deduplicateMoves(moves);
}

function generateFromAnchor(board, rack, gaddag, anchorR, anchorC, direction, crossSets, moves, isFirstMove) {
  const [dr, dc] = direction === 'across' ? [0, 1] : [1, 0];

  // Count how far left/up we can extend (empty squares only)
  let maxPrefix = 0;
  let r = anchorR - dr, c = anchorC - dc;
  while (board.inBounds(r, c) && board.isEmpty(r, c)) {
    maxPrefix++;
    r -= dr; c -= dc;
  }

  // Check for forced prefix (existing tiles before the anchor)
  const forcedPrefix = [];
  r = anchorR - dr; c = anchorC - dc;
  while (board.inBounds(r, c) && board.isOccupied(r, c)) {
    forcedPrefix.unshift(board.get(r, c).toUpperCase());
    r -= dr; c -= dc;
  }

  if (forcedPrefix.length > 0) {
    // Navigate the GADDAG with the reversed forced prefix
    let node = gaddag.root;
    for (let i = forcedPrefix.length - 1; i >= 0; i--) {
      node = node[forcedPrefix[i]];
      if (!node) return;
    }
    node = node[SEPARATOR];
    if (!node) return;
    extendRight(
      board, rack.slice(), gaddag, node,
      anchorR, anchorC, direction,
      forcedPrefix.slice(), [], crossSets, moves, isFirstMove,
      true
    );
  } else {
    generatePrefix(
      board, rack.slice(), gaddag, gaddag.root,
      anchorR, anchorC,
      direction, dr, dc,
      [], [], 0, maxPrefix, crossSets, moves, isFirstMove
    );
  }
}

function generatePrefix(
  board, rack, gaddag, node,
  anchorR, anchorC,
  direction, dr, dc,
  prefixLetters, tilesPlaced,
  depth, maxDepth, crossSets, moves, isFirstMove
) {
  // Try extending right from the anchor with current prefix
  const sepNode = node[SEPARATOR];
  if (sepNode !== undefined) {
    extendRight(
      board, rack.slice(), gaddag, sepNode,
      anchorR, anchorC, direction,
      prefixLetters.slice(), tilesPlaced.slice(),
      crossSets, moves, isFirstMove,
      false
    );
  }

  if (depth >= maxDepth) return;

  const [dr2, dc2] = direction === 'across' ? [0, 1] : [1, 0];
  const nextR = anchorR - dr2 * (depth + 1);
  const nextC = anchorC - dc2 * (depth + 1);

  if (!board.inBounds(nextR, nextC)) return;

  const cs = crossSets.get(`${nextR},${nextC},${direction}`);

  for (let i = 0; i < rack.length; i++) {
    const tile = rack[i];
    if (tile === '?') {
      for (const letter of ALPHABET) {
        if (cs !== null && cs !== undefined && !cs.has(letter)) continue;
        const child = node[letter];
        if (child === undefined) continue;
        const newRack = rack.slice(); newRack.splice(i, 1);
        generatePrefix(
          board, newRack, gaddag, child,
          anchorR, anchorC, direction, dr, dc,
          [letter, ...prefixLetters],
          [{ row: nextR, col: nextC, letter: letter.toLowerCase() }, ...tilesPlaced],
          depth + 1, maxDepth, crossSets, moves, isFirstMove
        );
      }
    } else {
      const letter = tile.toUpperCase();
      if (cs !== null && cs !== undefined && !cs.has(letter)) continue;
      const child = node[letter];
      if (child === undefined) continue;
      const newRack = rack.slice(); newRack.splice(i, 1);
      generatePrefix(
        board, newRack, gaddag, child,
        anchorR, anchorC, direction, dr, dc,
        [letter, ...prefixLetters],
        [{ row: nextR, col: nextC, letter }, ...tilesPlaced],
        depth + 1, maxDepth, crossSets, moves, isFirstMove
      );
    }
  }
}

function extendRight(
  board, rack, gaddag, node,
  row, col, direction,
  wordSoFar, tilesPlaced,
  crossSets, moves, isFirstMove,
  passedAnchor
) {
  const [dr, dc] = direction === 'across' ? [0, 1] : [1, 0];

  // Check for valid word
  const wordTrulyEnds = !(board.inBounds(row, col) && board.isOccupied(row, col));
  if (EOW in node && tilesPlaced.length > 0 && passedAnchor && wordTrulyEnds) {
    const word = wordSoFar.join('');
    if (word.length >= 2) {
      let valid = true;
      if (isFirstMove) {
        const wordLen = wordSoFar.length;
        const wordStartR = row - dr * wordLen;
        const wordStartC = col - dc * wordLen;
        let coversCenter = false;
        const [cr, cc] = CENTER;
        for (let i = 0; i < wordLen; i++) {
          if (wordStartR + dr * i === cr && wordStartC + dc * i === cc) {
            coversCenter = true;
            break;
          }
        }
        valid = coversCenter;
      }
      if (valid) {
        const wordLen = wordSoFar.length;
        const wordStartR = row - dr * wordLen;
        const wordStartC = col - dc * wordLen;
        moves.push({
          row: wordStartR,
          col: wordStartC,
          direction,
          word,
          tilesPlaced: tilesPlaced.slice(),
        });
      }
    }
  }

  if (!board.inBounds(row, col)) return;

  if (board.isOccupied(row, col)) {
    // Existing tile
    const existing = board.get(row, col).toUpperCase();
    const child = node[existing];
    if (child !== undefined) {
      wordSoFar.push(existing);
      extendRight(
        board, rack, gaddag, child,
        row + dr, col + dc, direction,
        wordSoFar, tilesPlaced,
        crossSets, moves, isFirstMove, true
      );
      wordSoFar.pop();
    }
  } else {
    // Empty square — try placing tiles
    const cs = crossSets.get(`${row},${col},${direction}`);

    for (let i = 0; i < rack.length; i++) {
      const tile = rack[i];
      if (tile === '?') {
        for (const letter of ALPHABET) {
          if (cs !== null && cs !== undefined && !cs.has(letter)) continue;
          const child = node[letter];
          if (child === undefined) continue;
          const newRack = rack.slice(); newRack.splice(i, 1);
          wordSoFar.push(letter);
          tilesPlaced.push({ row, col, letter: letter.toLowerCase() });
          extendRight(
            board, newRack, gaddag, child,
            row + dr, col + dc, direction,
            wordSoFar, tilesPlaced,
            crossSets, moves, isFirstMove, true
          );
          tilesPlaced.pop();
          wordSoFar.pop();
        }
      } else {
        const letter = tile.toUpperCase();
        if (cs !== null && cs !== undefined && !cs.has(letter)) continue;
        const child = node[letter];
        if (child === undefined) continue;
        const newRack = rack.slice(); newRack.splice(i, 1);
        wordSoFar.push(letter);
        tilesPlaced.push({ row, col, letter });
        extendRight(
          board, newRack, gaddag, child,
          row + dr, col + dc, direction,
          wordSoFar, tilesPlaced,
          crossSets, moves, isFirstMove, true
        );
        tilesPlaced.pop();
        wordSoFar.pop();
      }
    }
  }
}

function deduplicateMoves(moves) {
  const seen = new Set();
  const unique = [];
  for (const move of moves) {
    const placed = move.tilesPlaced
      .map(t => `${t.row}:${t.col}:${t.letter}`)
      .sort()
      .join('|');
    const key = `${move.row},${move.col},${move.direction},${move.word},${placed}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(move);
    }
  }
  return unique;
}
