/**
 * Board + rack detection from a screenshot using OpenCV.js.
 * Port of crossplay_helper/ocr/grid_detector.py
 *
 * IMPORTANT: Every cv.Mat must be explicitly .delete()'d.
 */

/* global cv */

const BOARD_SIZE = 15;

/**
 * Detect the 15x15 board region in the screenshot.
 * Uses projection profiles of saturated (colored) pixels — the white
 * app background is excluded.
 *
 * @param {cv.Mat} img - BGR image Mat
 * @returns {{ x:number, y:number, w:number, h:number }|null} board bounding box
 */
export function detectBoard(img) {
  const hsv = new cv.Mat();
  cv.cvtColor(img, hsv, cv.COLOR_BGR2HSV);

  // Mask saturated pixels (colored squares — premiums and tiles)
  const lower = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [0, 40, 40, 0]);
  const upper = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [180, 255, 255, 255]);
  const mask = new cv.Mat();
  cv.inRange(hsv, lower, upper, mask);

  // Horizontal projection (sum each row)
  const rowProfile = new Float32Array(img.rows);
  const colProfile = new Float32Array(img.cols);
  const data = mask.data;
  const cols = mask.cols;

  for (let r = 0; r < mask.rows; r++) {
    let sum = 0;
    for (let c = 0; c < cols; c++) {
      if (data[r * cols + c] > 0) sum++;
    }
    rowProfile[r] = sum;
  }
  for (let c = 0; c < cols; c++) {
    let sum = 0;
    for (let r = 0; r < mask.rows; r++) {
      if (data[r * cols + c] > 0) sum++;
    }
    colProfile[c] = sum;
  }

  hsv.delete(); lower.delete(); upper.delete(); mask.delete();

  const threshold = Math.max(...rowProfile) * 0.1;
  const rowThresh = Math.max(...colProfile) * 0.1;

  const activeRows = [];
  for (let i = 0; i < rowProfile.length; i++) {
    if (rowProfile[i] > threshold) activeRows.push(i);
  }
  const activeCols = [];
  for (let i = 0; i < colProfile.length; i++) {
    if (colProfile[i] > rowThresh) activeCols.push(i);
  }

  if (!activeRows.length || !activeCols.length) return null;

  return {
    x: activeCols[0],
    y: activeRows[0],
    w: activeCols[activeCols.length - 1] - activeCols[0] + 1,
    h: activeRows[activeRows.length - 1] - activeRows[0] + 1,
  };
}

/**
 * Detect the 7-tile rack below the board.
 *
 * @param {cv.Mat} img - BGR image Mat
 * @param {{ x:number, y:number, w:number, h:number }} boardBox
 * @returns {{ tiles: {x:number,y:number,w:number,h:number}[] }|null}
 */
export function detectRack(img, boardBox) {
  // Search region: 80% of board height below the board
  const searchY = boardBox.y + boardBox.h;
  const searchH = Math.round(boardBox.h * 0.8);
  if (searchY + searchH > img.rows) return null;

  const roi = img.roi(new cv.Rect(boardBox.x, searchY, boardBox.w, searchH));
  const hsv = new cv.Mat();
  cv.cvtColor(roi, hsv, cv.COLOR_BGR2HSV);

  // Blue tiles in the rack
  const lower = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [100, 80, 80, 0]);
  const upper = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [130, 255, 255, 255]);
  const mask = new cv.Mat();
  cv.inRange(hsv, lower, upper, mask);

  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

  const tiles = [];
  for (let i = 0; i < contours.size(); i++) {
    const rect = cv.boundingRect(contours.get(i));
    const area = rect.width * rect.height;
    if (area < 1000) continue; // Filter noise
    tiles.push({
      x: boardBox.x + rect.x,
      y: searchY + rect.y,
      w: rect.width,
      h: rect.height,
    });
  }

  hsv.delete(); lower.delete(); upper.delete(); mask.delete();
  contours.delete(); hierarchy.delete(); roi.delete();

  // Sort by x position
  tiles.sort((a, b) => a.x - b.x);

  return { tiles };
}

/**
 * Extract individual cell bounding boxes from the board region.
 *
 * @param {{ x:number, y:number, w:number, h:number }} boardBox
 * @returns {{ row:number, col:number, x:number, y:number, w:number, h:number }[][]} 15x15 grid
 */
export function getCellBoxes(boardBox) {
  const cellW = boardBox.w / BOARD_SIZE;
  const cellH = boardBox.h / BOARD_SIZE;
  const grid = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    const row = [];
    for (let c = 0; c < BOARD_SIZE; c++) {
      row.push({
        row: r,
        col: c,
        x: Math.round(boardBox.x + c * cellW),
        y: Math.round(boardBox.y + r * cellH),
        w: Math.round(cellW),
        h: Math.round(cellH),
      });
    }
    grid.push(row);
  }
  return grid;
}
