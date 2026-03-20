/**
 * Board state representation for Crossplay.
 * Port of crossplay_helper/solver/board.py
 */

import { BOARD_LAYOUT, BOARD_SIZE, CENTER } from '../config.js';

export class Board {
  /**
   * @param {(string|null)[][]} tiles - 15x15 array. null=empty, uppercase=tile, lowercase=blank-as-letter
   * @param {Set<string>} usedPremiums - Set of "r,c" strings for used premium squares
   */
  constructor(tiles = null, usedPremiums = null) {
    if (tiles) {
      this.tiles = tiles;
    } else {
      this.tiles = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
    }
    if (usedPremiums) {
      this.usedPremiums = usedPremiums;
    } else {
      this.usedPremiums = new Set();
      // Mark premiums as used for any pre-placed tiles
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          if (this.tiles[r][c] !== null) {
            this.usedPremiums.add(`${r},${c}`);
          }
        }
      }
    }
  }

  get(row, col) {
    if (row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE) {
      return this.tiles[row][col];
    }
    return null;
  }

  isEmpty(row, col) {
    return this.get(row, col) === null;
  }

  isOccupied(row, col) {
    return this.get(row, col) !== null;
  }

  inBounds(row, col) {
    return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
  }

  isBoardEmpty() {
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (this.tiles[r][c] !== null) return false;
      }
    }
    return true;
  }

  premiumAt(row, col) {
    if (this.usedPremiums.has(`${row},${col}`)) return '.';
    return BOARD_LAYOUT[row][col];
  }

  getAnchors() {
    if (this.isBoardEmpty()) return [CENTER];
    const anchors = [];
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (this.tiles[r][c] !== null) continue;
        let isAnchor = false;
        for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
          const nr = r + dr, nc = c + dc;
          if (this.inBounds(nr, nc) && this.tiles[nr][nc] !== null) {
            isAnchor = true;
            break;
          }
        }
        if (isAnchor) anchors.push([r, c]);
      }
    }
    return anchors;
  }

  /**
   * Get valid letters for a cross-word at (row, col) given play direction.
   * Returns null if no cross constraint, or a Set<string> of valid letters.
   */
  getCrossSet(row, col, direction, gaddag) {
    let dr, dc;
    if (direction === 'across') {
      dr = 1; dc = 0; // check vertically
    } else {
      dr = 0; dc = 1; // check horizontally
    }

    // Tiles above/left in perpendicular direction
    const prefix = [];
    let r = row - dr, c = col - dc;
    while (this.inBounds(r, c) && this.tiles[r][c] !== null) {
      prefix.unshift(this.tiles[r][c].toUpperCase());
      r -= dr; c -= dc;
    }

    // Tiles below/right
    const suffix = [];
    r = row + dr; c = col + dc;
    while (this.inBounds(r, c) && this.tiles[r][c] !== null) {
      suffix.push(this.tiles[r][c].toUpperCase());
      r += dr; c += dc;
    }

    if (prefix.length === 0 && suffix.length === 0) return null;

    const valid = new Set();
    for (let code = 65; code <= 90; code++) {
      const letter = String.fromCharCode(code);
      const word = prefix.join('') + letter + suffix.join('');
      if (gaddag.isWord(word)) valid.add(letter);
    }
    return valid;
  }

  placeTile(row, col, letter) {
    this.tiles[row][col] = letter;
    this.usedPremiums.add(`${row},${col}`);
  }

  removeTile(row, col) {
    this.tiles[row][col] = null;
  }

  copy() {
    const newTiles = this.tiles.map(row => row.slice());
    return new Board(newTiles, new Set(this.usedPremiums));
  }

  /**
   * Create a Board from the flat 15x15 tiles array used by the UI.
   * null/undefined = empty, string = tile letter.
   */
  static fromUITiles(uiTiles) {
    const tiles = Array.from({ length: BOARD_SIZE }, (_, r) =>
      Array.from({ length: BOARD_SIZE }, (_, c) => {
        const v = uiTiles[r] && uiTiles[r][c];
        return v || null;
      })
    );
    return new Board(tiles);
  }
}
