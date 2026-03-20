/**
 * Cross-validation script: runs the JS solver on a known board+rack,
 * prints top 20 moves so they can be compared with Python output.
 *
 * Usage: node validate.js [rack] [board_json]
 *   e.g. node validate.js WYCERIN
 *        node validate.js AEINRST ../crossplay-helper/tests/sample_board.json
 */

import { readFileSync } from 'fs';
import { GADDAG } from './js/solver/gaddag.js';
import { Board } from './js/solver/board.js';
import { generateMoves } from './js/solver/move-generator.js';

const rack = process.argv[2] || 'WYCERIN';
const boardFile = process.argv[3] || null;

console.log(`\nCrossplay Helper JS Solver\nRack: ${rack}\n`);

// Build GADDAG
console.time('GADDAG build');
const dictText = readFileSync('./data/twl06.txt', 'utf8');
const gaddag = GADDAG.fromWordList(dictText);
console.timeEnd('GADDAG build');

// Build board
let board;
if (boardFile) {
  const data = JSON.parse(readFileSync(boardFile, 'utf8'));
  board = Board.fromUITiles(data.tiles);
  console.log(`Board loaded from ${boardFile}`);
} else {
  board = new Board();
  console.log('Using empty board');
}

// Generate moves
const rackArr = rack.toUpperCase().split('').filter(c => /[A-Z?]/.test(c));
console.time('generateMoves');
const moves = generateMoves(board, rackArr, gaddag);
console.timeEnd('generateMoves');

console.log(`\nTotal moves found: ${moves.length}`);
console.log('\nTop 20 moves:');
console.log('─'.repeat(50));
moves.slice(0, 20).forEach((m, i) => {
  const blanks = m.tilesPlaced.filter(t => /[a-z]/.test(t.letter)).map(t => t.letter.toUpperCase()).join('');
  const blankNote = blanks ? ` (blanks: ${blanks})` : '';
  console.log(`${String(i+1).padStart(2)}. ${m.word.padEnd(15)} ${m.direction.padEnd(6)} (${m.row},${m.col})  ${String(m.score).padStart(4)} pts${blankNote}`);
});
