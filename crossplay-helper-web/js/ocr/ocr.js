/**
 * OCR pipeline — runs on the main thread after opencv.js is loaded via <script>.
 * cv is a Promise (from @techstark/opencv-js) that resolves to the OpenCV module.
 */

import { BOARD_LAYOUT } from '../config.js';

const BOARD_SIZE = 15;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const CONFIDENCE_THRESHOLD = 0.6;
const TEMPLATE_SIZE = 32;

// ── OpenCV readiness ──────────────────────────────────────────────────────

let _cv = null;

async function getCV() {
  if (_cv) return _cv;
  // @techstark/opencv-js sets window.cv as a Promise<module>
  _cv = (typeof cv.then === 'function') ? await cv : cv;
  return _cv;
}

// ── Grid detection ────────────────────────────────────────────────────────

function detectBoard(cv, img) {
  const hsv = new cv.Mat();
  cv.cvtColor(img, hsv, cv.COLOR_BGR2HSV);

  const lower = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [0, 40, 40, 0]);
  const upper = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [180, 255, 255, 255]);
  const mask = new cv.Mat();
  cv.inRange(hsv, lower, upper, mask);

  const data = mask.data, cols = mask.cols;
  const rowProfile = new Float32Array(img.rows);
  const colProfile = new Float32Array(img.cols);

  for (let r = 0; r < mask.rows; r++) {
    let s = 0;
    for (let c = 0; c < cols; c++) if (data[r * cols + c] > 0) s++;
    rowProfile[r] = s;
  }
  for (let c = 0; c < cols; c++) {
    let s = 0;
    for (let r = 0; r < mask.rows; r++) if (data[r * cols + c] > 0) s++;
    colProfile[c] = s;
  }

  hsv.delete(); lower.delete(); upper.delete(); mask.delete();

  const rowThresh = Math.max(...rowProfile) * 0.1;
  const colThresh = Math.max(...colProfile) * 0.1;
  const activeRows = [...rowProfile].map((v, i) => v > rowThresh ? i : -1).filter(i => i >= 0);
  const activeCols = [...colProfile].map((v, i) => v > colThresh ? i : -1).filter(i => i >= 0);

  if (!activeRows.length || !activeCols.length) return null;
  return {
    x: activeCols[0], y: activeRows[0],
    w: activeCols.at(-1) - activeCols[0] + 1,
    h: activeRows.at(-1) - activeRows[0] + 1,
  };
}

function detectRack(cv, img, boardBox) {
  const searchY = boardBox.y + boardBox.h;
  const searchH = Math.round(boardBox.h * 0.8);
  if (searchY + searchH > img.rows) return null;

  const roi = img.roi(new cv.Rect(boardBox.x, searchY, boardBox.w, searchH));
  const hsv = new cv.Mat();
  cv.cvtColor(roi, hsv, cv.COLOR_BGR2HSV);
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
    if (rect.width * rect.height < 1000) continue;
    tiles.push({ x: boardBox.x + rect.x, y: searchY + rect.y, w: rect.width, h: rect.height });
  }
  hsv.delete(); lower.delete(); upper.delete(); mask.delete();
  contours.delete(); hierarchy.delete(); roi.delete();
  return { tiles: tiles.sort((a, b) => a.x - b.x) };
}

function getCellBoxes(boardBox) {
  const cellW = boardBox.w / BOARD_SIZE, cellH = boardBox.h / BOARD_SIZE;
  return Array.from({ length: BOARD_SIZE }, (_, r) =>
    Array.from({ length: BOARD_SIZE }, (_, c) => ({
      row: r, col: c,
      x: Math.round(boardBox.x + c * cellW), y: Math.round(boardBox.y + r * cellH),
      w: Math.round(cellW), h: Math.round(cellH),
    }))
  );
}

// ── Cell classification ───────────────────────────────────────────────────

function classifyCell(cv, img, box) {
  const pad = Math.round(Math.min(box.w, box.h) * 0.05);
  const rw = box.w - 2 * pad, rh = box.h - 2 * pad;
  if (rw <= 0 || rh <= 0) return 'empty';

  const roi = img.roi(new cv.Rect(box.x + pad, box.y + pad, rw, rh));
  const hsv = new cv.Mat();
  cv.cvtColor(roi, hsv, cv.COLOR_BGR2HSV);
  const lower = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [100, 80, 80, 0]);
  const upper = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [130, 255, 255, 255]);
  const mask = new cv.Mat();
  cv.inRange(hsv, lower, upper, mask);
  const bluePx = cv.countNonZero(mask);
  lower.delete(); upper.delete(); mask.delete(); hsv.delete(); roi.delete();
  return (bluePx / (rw * rh)) >= 0.15 ? 'tile' : 'empty';
}

// ── Letter recognition ────────────────────────────────────────────────────

function isolateLetter(cv, gray) {
  const binary = new cv.Mat();
  cv.threshold(gray, binary, 180, 255, cv.THRESH_BINARY);

  const maskH = Math.round(binary.rows * 0.25);
  const maskW = Math.round(binary.cols * 0.35);
  if (maskH > 0 && maskW > 0) {
    const r = binary.roi(new cv.Rect(binary.cols - maskW, 0, maskW, maskH));
    r.setTo(new cv.Scalar(0)); r.delete();
  }
  const bh = Math.round(binary.rows * 0.08), bw = Math.round(binary.cols * 0.08);
  if (bh > 0 && bw > 0) {
    for (const rect of [
      new cv.Rect(0, 0, binary.cols, bh),
      new cv.Rect(0, binary.rows - bh, binary.cols, bh),
      new cv.Rect(0, 0, bw, binary.rows),
      new cv.Rect(binary.cols - bw, 0, bw, binary.rows),
    ]) { const r = binary.roi(rect); r.setTo(new cv.Scalar(0)); r.delete(); }
  }

  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(2, 2));
  const opened = new cv.Mat();
  cv.morphologyEx(binary, opened, cv.MORPH_OPEN, kernel);
  kernel.delete(); binary.delete();

  const resized = new cv.Mat();
  cv.resize(opened, resized, new cv.Size(TEMPLATE_SIZE, TEMPLATE_SIZE));
  opened.delete();
  return resized;
}

function matchLetter(cv, isolated, templates) {
  let bestLetter = '?', bestScore = -Infinity;
  for (const [letter, tmpl] of templates) {
    const result = new cv.Mat();
    try {
      cv.matchTemplate(isolated, tmpl, result, cv.TM_CCOEFF_NORMED);
      const { maxVal } = cv.minMaxLoc(result);
      if (maxVal > bestScore) { bestScore = maxVal; bestLetter = letter; }
    } finally { result.delete(); }
  }
  return { letter: bestLetter, confidence: bestScore };
}

async function loadTemplates(cv, templateDir) {
  const templates = new Map();
  await Promise.all(ALPHABET.split('').map(async letter => {
    try {
      const resp = await fetch(`${templateDir}/${letter}.png`);
      if (!resp.ok) return;
      const blob = await resp.blob();
      const bitmap = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      canvas.getContext('2d').drawImage(bitmap, 0, 0);
      const imgData = canvas.getContext('2d').getImageData(0, 0, bitmap.width, bitmap.height);
      const rgba = cv.matFromImageData(imgData);
      const gray = new cv.Mat();
      cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
      rgba.delete();
      if (gray.rows !== TEMPLATE_SIZE || gray.cols !== TEMPLATE_SIZE) {
        const r = new cv.Mat();
        cv.resize(gray, r, new cv.Size(TEMPLATE_SIZE, TEMPLATE_SIZE));
        gray.delete();
        templates.set(letter, r);
      } else {
        templates.set(letter, gray);
      }
    } catch { /* skip missing template */ }
  }));
  return templates;
}

function readTile(cv, img, box, templates, targetSize = null) {
  const roi = img.roi(new cv.Rect(box.x, box.y, box.w, box.h));
  const src = targetSize ? (() => { const r = new cv.Mat(); cv.resize(roi, r, new cv.Size(targetSize, targetSize)); roi.delete(); return r; })() : roi;
  const gray = new cv.Mat();
  try {
    cv.cvtColor(src, gray, cv.COLOR_BGR2GRAY);
    const isolated = isolateLetter(cv, gray);
    try { return matchLetter(cv, isolated, templates); }
    finally { isolated.delete(); }
  } finally { src.delete(); gray.delete(); }
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Parse a screenshot File/Blob and return board tiles + rack.
 * @param {File|Blob} file
 * @param {(msg:string)=>void} onStatus
 */
export async function parseScreenshot(file, onStatus = () => {}) {
  onStatus('Initializing OpenCV...');
  const cv = await getCV();

  onStatus('Decoding image...');
  const bitmap = await createImageBitmap(file);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  const imgData = canvas.getContext('2d').getImageData(0, 0, bitmap.width, bitmap.height);
  const src = cv.matFromImageData(imgData);
  const bgr = new cv.Mat();
  try {
    cv.cvtColor(src, bgr, cv.COLOR_RGBA2BGR);

    onStatus('Detecting board...');
    const boardBox = detectBoard(cv, bgr);
    if (!boardBox) throw new Error('Could not detect board in screenshot');

    const cellBoxes = getCellBoxes(boardBox);
    const cellSize = Math.round(boardBox.w / 15);

    onStatus('Loading letter templates...');
    const templates = await loadTemplates(cv, 'templates');

    onStatus('Reading board...');
    const tiles = Array.from({ length: 15 }, () => Array(15).fill(null));
    const lowConfidenceCells = [];
    const confidences = [];

    for (let r = 0; r < 15; r++) {
      for (let c = 0; c < 15; c++) {
        if (classifyCell(cv, bgr, cellBoxes[r][c]) !== 'tile') continue;
        const { letter, confidence } = readTile(cv, bgr, cellBoxes[r][c], templates);
        tiles[r][c] = letter;
        confidences.push(confidence);
        if (confidence < CONFIDENCE_THRESHOLD) lowConfidenceCells.push({ row: r, col: c, confidence });
      }
    }

    onStatus('Reading rack...');
    const rack = [];
    const rackResult = detectRack(cv, bgr, boardBox);
    if (rackResult) {
      for (const tileBox of rackResult.tiles) {
        const { letter, confidence } = readTile(cv, bgr, tileBox, templates, cellSize);
        rack.push(letter);
        confidences.push(confidence);
      }
    }

    for (const [, tmpl] of templates) tmpl.delete();

    const confidence = confidences.length
      ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0;

    return { tiles, rack, confidence, lowConfidenceCells };
  } finally {
    src.delete();
    bgr.delete();
  }
}
