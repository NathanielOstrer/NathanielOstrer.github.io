/**
 * Cell classification: tile vs empty/premium.
 * Port of crossplay_helper/ocr/cell_classifier.py
 *
 * Premium positions come from config.BOARD_LAYOUT — not image detection.
 * Only tile detection (blue + white content) is image-based.
 */

/* global cv */

import { BOARD_LAYOUT } from '../config.js';

// HSV range for the blue tile background
const TILE_HUE_LOW  = 100;
const TILE_HUE_HIGH = 130;
const TILE_SAT_LOW  = 80;
const TILE_SAT_HIGH = 255;
const TILE_VAL_LOW  = 80;
const TILE_VAL_HIGH = 255;

// Minimum fraction of cell area that must be blue to count as a tile
const BLUE_FRACTION_THRESHOLD = 0.15;

/**
 * Classify a single cell as 'tile' or 'premium' (or '.').
 *
 * @param {cv.Mat} img - full BGR image
 * @param {{ x:number, y:number, w:number, h:number }} box
 * @param {number} row
 * @param {number} col
 * @returns {string} 'tile' | premium type from BOARD_LAYOUT
 */
export function classifyCell(img, box) {
  // Extract cell ROI
  const pad = Math.round(Math.min(box.w, box.h) * 0.05);
  const rx = box.x + pad;
  const ry = box.y + pad;
  const rw = box.w - 2 * pad;
  const rh = box.h - 2 * pad;

  if (rw <= 0 || rh <= 0) return 'empty';

  const roi = img.roi(new cv.Rect(rx, ry, rw, rh));
  const hsv = new cv.Mat();
  try {
    cv.cvtColor(roi, hsv, cv.COLOR_BGR2HSV);
    const lower = new cv.Mat(hsv.rows, hsv.cols, hsv.type(),
      [TILE_HUE_LOW, TILE_SAT_LOW, TILE_VAL_LOW, 0]);
    const upper = new cv.Mat(hsv.rows, hsv.cols, hsv.type(),
      [TILE_HUE_HIGH, TILE_SAT_HIGH, TILE_VAL_HIGH, 255]);
    const mask = new cv.Mat();
    try {
      cv.inRange(hsv, lower, upper, mask);
      const bluePx = cv.countNonZero(mask);
      const totalPx = rw * rh;
      return (bluePx / totalPx) >= BLUE_FRACTION_THRESHOLD ? 'tile' : 'empty';
    } finally {
      lower.delete(); upper.delete(); mask.delete();
    }
  } finally {
    roi.delete(); hsv.delete();
  }
}

/**
 * Classify all 15x15 cells on the board.
 *
 * @param {cv.Mat} img
 * @param {Object[][]} cellBoxes - 15x15 grid of bounding boxes
 * @returns {string[][]} 15x15 grid of 'tile' | premium type
 */
export function classifyAllCells(img, cellBoxes) {
  return cellBoxes.map((row, r) =>
    row.map((box, c) => {
      const type = classifyCell(img, box);
      if (type === 'tile') return 'tile';
      return BOARD_LAYOUT[r][c]; // Return premium type for non-tile cells
    })
  );
}
