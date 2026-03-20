/**
 * Classic Web Worker for OCR.
 * Starts loading OpenCV.js immediately on creation (eager, background).
 * All OCR code is inlined — no ES module imports needed.
 */

var BOARD_SIZE = 15;
var ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
var CONFIDENCE_THRESHOLD = 0.6;
var TEMPLATE_SIZE = 32;

var BOARD_LAYOUT = [
  ["3L",".",".","3W",".",".",".",  "2L",".",".",".","3W",".",".","3L"],
  [".","2W",".",".",".",".","3L", ".","3L",".",".",".",".","2W","."],
  [".",".",".",".","2L",".",".",".",".",".",  "2L",".",".",".","."],
  ["3W",".",".",  "2L",".",".",".",  "2W",".",".",".",  "2L",".",".",  "3W"],
  [".",".","2L",".",".",  "3L",".",".",".",  "3L",".",".","2L",".","."],
  [".",".",".",".","3L",".",".","2L",".",".","3L",".",".",".","."],
  [".","3L",".",".",".",".",".",".",".",".",".",".",".","3L","."],
  ["2L",".",".","2W",".","2L",".","*",".","2L",".","2W",".",".","2L"],
  [".","3L",".",".",".",".",".",".",".",".",".",".",".","3L","."],
  [".",".",".",".","3L",".",".","2L",".",".","3L",".",".",".","."],
  [".",".","2L",".",".",  "3L",".",".",".",  "3L",".",".","2L",".","."],
  ["3W",".",".",  "2L",".",".",".",  "2W",".",".",".",  "2L",".",".",  "3W"],
  [".",".",".",".","2L",".",".",".",".",".",  "2L",".",".",".","."],
  [".","2W",".",".",".",".","3L", ".","3L",".",".",".",".","2W","."],
  ["3L",".",".","3W",".",".",".",  "2L",".",".",".","3W",".",".","3L"]
];

// ── OpenCV loading (starts immediately) ──────────────────────────────────
// IMPORTANT: Do NOT wrap cvVal.then() inside new Promise() — the Emscripten
// thenable interacts badly with Promise resolution and kills message handling.

var cvReady = false;

postMessage({ type: 'ocr-status', message: 'Compiling WebAssembly (one-time, ~15s)...' });
try {
  importScripts('../../lib/opencv.js');
} catch (e) {
  postMessage({ type: 'ocr-error', message: 'importScripts failed: ' + e.message });
}

var cvVal = self.cv;
if (cvVal && cvVal.Mat) {
  cvReady = true;
  postMessage({ type: 'ocr-ready' });
} else if (cvVal && typeof cvVal.then === 'function') {
  var elapsed = 0;
  var ticker = setInterval(function() {
    elapsed += 1;
    postMessage({ type: 'ocr-status', message: 'Compiling WebAssembly... ' + elapsed + 's (first load only)' });
  }, 1000);

  cvVal.then(function(openCv) {
    clearInterval(ticker);
    self.cv = openCv;
    cvReady = true;
    postMessage({ type: 'ocr-ready' });
  });
} else if (!cvVal) {
  postMessage({ type: 'ocr-error', message: 'cv not defined after importScripts' });
} else {
  postMessage({ type: 'ocr-error', message: 'Unrecognized cv export: ' + typeof cvVal });
}

// Helper: wait for OpenCV to be ready
function waitForCV() {
  if (cvReady) return Promise.resolve();
  return new Promise(function(resolve) {
    var check = setInterval(function() {
      if (cvReady) { clearInterval(check); resolve(); }
    }, 100);
  });
}

// ── Grid detection ────────────────────────────────────────────────────────

function detectBoard(img) {
  var h = img.rows, w = img.cols;

  // Use grayscale < 250 to detect non-white pixels (board cells are off-white
  // ~237-241; app background is pure white 255). This matches Python logic.
  var gray = new cv.Mat();
  cv.cvtColor(img, gray, cv.COLOR_BGR2GRAY);
  var notWhite = new cv.Mat();
  // Threshold: pixels < 250 are "not white"
  cv.threshold(gray, notWhite, 250, 255, cv.THRESH_BINARY_INV);
  gray.delete();

  var data = notWhite.data, cols = notWhite.cols;
  var rowProfile = new Float32Array(h);
  for (var r = 0; r < h; r++) {
    var s = 0;
    for (var c = 0; c < cols; c++) if (data[r * cols + c] > 0) s++;
    rowProfile[r] = s;
  }
  notWhite.delete();

  // Threshold: row must have > 30% of image width as non-white
  var rowThresh = w * 0.3;
  var activeRows = [];
  for (var i = 0; i < h; i++) if (rowProfile[i] > rowThresh) activeRows.push(i);
  if (!activeRows.length) return null;

  // Find the longest contiguous run of active rows (gaps > 50px split segments)
  var y1 = activeRows[0], y2 = activeRows[activeRows.length - 1];
  if (activeRows.length > 1) {
    var bestLen = 0, segStart = activeRows[0];
    for (var k = 1; k <= activeRows.length; k++) {
      var gap = k < activeRows.length ? activeRows[k] - activeRows[k-1] : 9999;
      if (gap > 50 || k === activeRows.length) {
        var segEnd = activeRows[k-1];
        if (segEnd - segStart > bestLen) {
          bestLen = segEnd - segStart;
          y1 = segStart; y2 = segEnd;
        }
        if (k < activeRows.length) segStart = activeRows[k];
      }
    }
  }

  // Column profile within the detected row range
  var notWhite2 = new cv.Mat();
  var gray2 = new cv.Mat();
  cv.cvtColor(img, gray2, cv.COLOR_BGR2GRAY);
  cv.threshold(gray2, notWhite2, 250, 255, cv.THRESH_BINARY_INV);
  gray2.delete();
  var data2 = notWhite2.data;
  var colThresh = (y2 - y1) * 0.3;
  var activeCols = [];
  for (var j = 0; j < w; j++) {
    var sc = 0;
    for (var ri = y1; ri <= y2; ri++) if (data2[ri * w + j] > 0) sc++;
    if (sc > colThresh) activeCols.push(j);
  }
  notWhite2.delete();

  if (!activeCols.length) return null;
  var x1 = activeCols[0], x2 = activeCols[activeCols.length - 1];

  // Make square (board is 15×15)
  var bw = x2 - x1, bh = y2 - y1;
  var side;
  if (Math.abs(bw - bh) / Math.min(bw, bh) < 0.1) {
    side = Math.max(bw, bh);
    if (bw < side) x1 = Math.round((x1 + x2) / 2) - Math.floor(side / 2);
    if (bh < side) y1 = Math.round((y1 + y2) / 2) - Math.floor(side / 2);
  } else {
    side = Math.min(bw, bh);
  }

  x1 = Math.max(0, x1);
  y1 = Math.max(0, y1);
  side = Math.min(side, w - x1, h - y1);

  return { x: x1, y: y1, w: side, h: side };
}

function detectRack(img, boardBox) {
  var searchY = boardBox.y + boardBox.h;
  var searchH = Math.round(boardBox.h * 0.8);
  // Clamp search area to image bounds
  if (searchY >= img.rows) return null;
  if (searchY + searchH > img.rows) searchH = img.rows - searchY;
  if (searchH < 20) return null;
  var roi = img.roi(new cv.Rect(boardBox.x, searchY, boardBox.w, searchH));
  var hsv = new cv.Mat();
  cv.cvtColor(roi, hsv, cv.COLOR_BGR2HSV);
  var lower = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [100, 80, 80, 0]);
  var upper = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [130, 255, 255, 255]);
  var mask = new cv.Mat();
  cv.inRange(hsv, lower, upper, mask);
  var contours = new cv.MatVector(), hierarchy = new cv.Mat();
  cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  var tiles = [];
  for (var i = 0; i < contours.size(); i++) {
    var rect = cv.boundingRect(contours.get(i));
    if (rect.width * rect.height < 1000) continue;
    tiles.push({ x: boardBox.x + rect.x, y: searchY + rect.y, w: rect.width, h: rect.height });
  }
  hsv.delete(); lower.delete(); upper.delete(); mask.delete();
  contours.delete(); hierarchy.delete(); roi.delete();
  tiles.sort(function(a,b){ return a.x-b.x; });
  return { tiles: tiles };
}

function getCellBoxes(boardBox) {
  var cw = boardBox.w / BOARD_SIZE, ch = boardBox.h / BOARD_SIZE;
  var grid = [];
  for (var r = 0; r < BOARD_SIZE; r++) {
    var row = [];
    for (var c = 0; c < BOARD_SIZE; c++) {
      row.push({ row:r, col:c,
        x: Math.round(boardBox.x + c*cw), y: Math.round(boardBox.y + r*ch),
        w: Math.round(cw), h: Math.round(ch) });
    }
    grid.push(row);
  }
  return grid;
}

// ── Cell classification ───────────────────────────────────────────────────

function classifyCell(img, box) {
  var pad = Math.round(Math.min(box.w, box.h) * 0.05);
  var rw = box.w - 2*pad, rh = box.h - 2*pad;
  if (rw <= 0 || rh <= 0) return 'empty';
  var roi = img.roi(new cv.Rect(box.x+pad, box.y+pad, rw, rh));
  var hsv = new cv.Mat();
  cv.cvtColor(roi, hsv, cv.COLOR_BGR2HSV);
  var lower = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [100, 80, 80, 0]);
  var upper = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [130, 255, 255, 255]);
  var mask = new cv.Mat();
  cv.inRange(hsv, lower, upper, mask);
  var bluePx = cv.countNonZero(mask);
  lower.delete(); upper.delete(); mask.delete(); hsv.delete(); roi.delete();
  return (bluePx / (rw * rh)) >= 0.15 ? 'tile' : 'empty';
}

// ── Letter recognition ────────────────────────────────────────────────────

function isolateLetter(cellBgr) {
  // Match Python _isolate_letter: HSV white mask → contour filtering → centered resize
  var h = cellBgr.rows, w = cellBgr.cols;
  var cellArea = h * w;

  // Convert to HSV and extract white pixels (the letter on blue tile)
  var hsv = new cv.Mat();
  cv.cvtColor(cellBgr, hsv, cv.COLOR_BGR2HSV);
  var lower = new cv.Mat(h, w, hsv.type(), [0, 0, 170, 0]);
  var upper = new cv.Mat(h, w, hsv.type(), [179, 80, 255, 255]);
  var whiteMask = new cv.Mat();
  cv.inRange(hsv, lower, upper, whiteMask);
  hsv.delete(); lower.delete(); upper.delete();

  // Morphological opening to clean noise
  var kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(2, 2));
  var cleaned = new cv.Mat();
  cv.morphologyEx(whiteMask, cleaned, cv.MORPH_OPEN, kernel);
  kernel.delete(); whiteMask.delete();

  // Erase thin border to disconnect from adjacent tile bleed
  var border = Math.max(2, Math.round(Math.min(h, w) * 0.04));
  var zero = new cv.Scalar(0);
  if (border > 0) {
    var topR = cleaned.roi(new cv.Rect(0, 0, w, border));
    topR.setTo(zero); topR.delete();
    var botR = cleaned.roi(new cv.Rect(0, h - border, w, border));
    botR.setTo(zero); botR.delete();
    var leftR = cleaned.roi(new cv.Rect(0, 0, border, h));
    leftR.setTo(zero); leftR.delete();
    var rightR = cleaned.roi(new cv.Rect(w - border, 0, border, h));
    rightR.setTo(zero); rightR.delete();
  }

  // Find contours
  var contours = new cv.MatVector();
  var hierarchy = new cv.Mat();
  cv.findContours(cleaned, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  hierarchy.delete();

  if (contours.size() === 0) { contours.delete(); cleaned.delete(); return null; }

  // Find largest contour
  var largestIdx = 0, largestArea = 0;
  for (var i = 0; i < contours.size(); i++) {
    var a = cv.contourArea(contours.get(i));
    if (a > largestArea) { largestArea = a; largestIdx = i; }
  }

  if (largestArea < cellArea * 0.01) { contours.delete(); cleaned.delete(); return null; }

  var lRect = cv.boundingRect(contours.get(largestIdx));

  // Filter contours: keep letter parts, reject superscript/noise
  var keepContours = [];
  for (var j = 0; j < contours.size(); j++) {
    var area = cv.contourArea(contours.get(j));
    var br = cv.boundingRect(contours.get(j));
    var cx = br.x + br.width / 2, cy = br.y + br.height / 2;

    // Skip noise
    if (area < cellArea * 0.005) continue;

    // Always keep largest
    if (area >= largestArea * 0.9) { keepContours.push(j); continue; }

    // Reject superscript in top-right corner
    if (cx > w * 0.55 && cy < h * 0.45 && area < largestArea * 0.5) continue;

    // Reject corner bleed
    if (cy < h * 0.3 && (cx < w * 0.3 || cx > w * 0.7) && area < largestArea * 0.3) continue;

    // Reject thin wide strips (edge bleed)
    if (br.width > lRect.width * 2.0 && br.height < lRect.height * 0.5 && area < largestArea * 0.3) continue;

    // Keep if horizontally overlaps with largest (letter parts like dot of i, crossbar of t)
    var xOverlap = Math.max(0, Math.min(br.x + br.width, lRect.x + lRect.width) - Math.max(br.x, lRect.x));
    if (xOverlap > 0 && area >= largestArea * 0.02) keepContours.push(j);
  }

  if (keepContours.length === 0) { contours.delete(); cleaned.delete(); return null; }

  // Merge bounding boxes of kept contours
  var minX = w, minY = h, maxX = 0, maxY = 0;
  for (var k = 0; k < keepContours.length; k++) {
    var r = cv.boundingRect(contours.get(keepContours[k]));
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  contours.delete();

  // Add padding
  var lw = maxX - minX, lh = maxY - minY;
  var pad = Math.max(2, Math.round(Math.min(lw, lh) * 0.1));
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  lw = Math.min(w - minX, lw + 2 * pad);
  lh = Math.min(h - minY, lh + 2 * pad);

  if (lw <= 0 || lh <= 0) { cleaned.delete(); return null; }

  var letterROI = cleaned.roi(new cv.Rect(minX, minY, lw, lh));

  // Resize maintaining aspect ratio with 0.8 scale margin, center on canvas
  var target = TEMPLATE_SIZE;
  var scale = Math.min(target / lw, target / lh) * 0.8;
  var newW = Math.round(lw * scale), newH = Math.round(lh * scale);
  if (newW < 1 || newH < 1) { letterROI.delete(); cleaned.delete(); return null; }

  var resizedLetter = new cv.Mat();
  cv.resize(letterROI, resizedLetter, new cv.Size(newW, newH));
  letterROI.delete(); cleaned.delete();

  // Center on blank canvas
  var canvas = cv.Mat.zeros(target, target, cv.CV_8UC1);
  var ox = Math.floor((target - newW) / 2);
  var oy = Math.floor((target - newH) / 2);
  var destROI = canvas.roi(new cv.Rect(ox, oy, newW, newH));
  resizedLetter.copyTo(destROI);
  destROI.delete(); resizedLetter.delete();

  return canvas;
}

function matchLetter(isolated, templates) {
  var bestLetter = '?', bestScore = -Infinity;
  for (var letter in templates) {
    var result = new cv.Mat();
    try {
      cv.matchTemplate(isolated, templates[letter], result, cv.TM_CCOEFF_NORMED);
      var mm = cv.minMaxLoc(result);
      if (mm.maxVal > bestScore) { bestScore = mm.maxVal; bestLetter = letter; }
    } finally { result.delete(); }
  }
  return { letter: bestLetter, confidence: bestScore };
}

function loadTemplates(templateDir) {
  var templates = {};
  var promises = ALPHABET.split('').map(function(letter) {
    return fetch(templateDir + '/' + letter + '.png')
      .then(function(r) { return r.ok ? r.blob() : null; })
      .then(function(blob) { return blob ? createImageBitmap(blob) : null; })
      .then(function(bitmap) {
        if (!bitmap) return;
        var canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        canvas.getContext('2d').drawImage(bitmap, 0, 0);
        var imgData = canvas.getContext('2d').getImageData(0, 0, bitmap.width, bitmap.height);
        var rgba = cv.matFromImageData(imgData);
        var gray = new cv.Mat();
        cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
        rgba.delete();
        if (gray.rows !== TEMPLATE_SIZE || gray.cols !== TEMPLATE_SIZE) {
          var out = new cv.Mat();
          cv.resize(gray, out, new cv.Size(TEMPLATE_SIZE, TEMPLATE_SIZE));
          gray.delete(); templates[letter] = out;
        } else { templates[letter] = gray; }
      }).catch(function() {});
  });
  return Promise.all(promises).then(function() { return templates; });
}

function readTile(img, box, templates, targetSize) {
  var roi = img.roi(new cv.Rect(box.x, box.y, box.w, box.h));
  var src = roi;
  if (targetSize) {
    src = new cv.Mat();
    cv.resize(roi, src, new cv.Size(targetSize, targetSize));
    roi.delete();
  }
  try {
    var isolated = isolateLetter(src);
    if (!isolated) return { letter: '?', confidence: 0 };
    try { return matchLetter(isolated, templates); }
    finally { isolated.delete(); }
  } finally { src.delete(); }
}

// ── Pipeline ──────────────────────────────────────────────────────────────

async function parseScreenshot(imageData) {
  postMessage({ type: 'ocr-status', message: 'Decoding image...' });
  var blob = new Blob([imageData]);
  var bitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch (e) {
    throw new Error('createImageBitmap failed: ' + e.message + '. Try PNG/JPG format.');
  }
  postMessage({ type: 'ocr-status', message: 'Image decoded: ' + bitmap.width + 'x' + bitmap.height + 'px' });

  var canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  var imgData = canvas.getContext('2d').getImageData(0, 0, bitmap.width, bitmap.height);

  var src;
  try {
    src = cv.matFromImageData(imgData);
  } catch (e) {
    throw new Error('cv.matFromImageData failed: ' + e.message);
  }

  // Convert RGBA → BGR (two-step: RGBA→BGRA→BGR strips alpha safely)
  var bgr = new cv.Mat();
  try {
    try {
      cv.cvtColor(src, bgr, cv.COLOR_RGBA2BGR);
    } catch (e) {
      // Fallback: RGBA→BGRA then drop alpha channel
      var bgra = new cv.Mat();
      try {
        cv.cvtColor(src, bgra, cv.COLOR_RGBA2BGRA);
        cv.cvtColor(bgra, bgr, cv.COLOR_BGRA2BGR);
      } finally {
        bgra.delete();
      }
    }

    postMessage({ type: 'ocr-status', message: 'Detecting board...' });
    var boardBox;
    try {
      boardBox = detectBoard(bgr);
    } catch (e) {
      throw new Error('Board detection crashed: ' + e.message);
    }
    if (!boardBox) throw new Error('Board not found — is this a Crossplay screenshot?');
    postMessage({ type: 'ocr-status', message: 'Board: (' + boardBox.x + ',' + boardBox.y + ') ' + boardBox.w + 'x' + boardBox.h });

    var cellBoxes = getCellBoxes(boardBox);
    var cellSize = Math.round(boardBox.w / 15);

    postMessage({ type: 'ocr-status', message: 'Loading letter templates...' });
    var templates;
    try {
      templates = await loadTemplates('../../templates');
    } catch (e) {
      throw new Error('Template load failed: ' + e.message);
    }
    var tmplCount = Object.keys(templates).length;
    if (tmplCount === 0) throw new Error('No templates loaded — server may be missing /templates/*.png');
    postMessage({ type: 'ocr-status', message: tmplCount + ' templates loaded, classifying cells...' });

    var tiles = Array.from({ length: 15 }, function() { return Array(15).fill(null); });
    var lowConfidenceCells = [], confidences = [];
    var tileCount = 0;

    for (var r = 0; r < 15; r++) {
      for (var c = 0; c < 15; c++) {
        try {
          if (classifyCell(bgr, cellBoxes[r][c]) !== 'tile') continue;
          var res = readTile(bgr, cellBoxes[r][c], templates);
          tiles[r][c] = res.letter;
          tileCount++;
          confidences.push(res.confidence);
          if (res.confidence < CONFIDENCE_THRESHOLD)
            lowConfidenceCells.push({ row: r, col: c, confidence: res.confidence });
        } catch (e) {
          // skip bad cell silently
        }
      }
    }

    postMessage({ type: 'ocr-status', message: tileCount + ' board tiles found, reading rack...' });
    var rack = [];
    try {
      var rackResult = detectRack(bgr, boardBox);
      if (rackResult) {
        for (var t = 0; t < rackResult.tiles.length; t++) {
          var tr = readTile(bgr, rackResult.tiles[t], templates, cellSize);
          rack.push(tr.letter);
          confidences.push(tr.confidence);
        }
      }
    } catch (e) {
      // rack detection failed — non-fatal
    }

    for (var letter in templates) { try { templates[letter].delete(); } catch(e){} }

    var avgConf = confidences.length
      ? confidences.reduce(function(a,b){return a+b;},0) / confidences.length : 0;

    return { tiles: tiles, rack: rack, confidence: avgConf, lowConfidenceCells: lowConfidenceCells };
  } finally {
    try { src.delete(); } catch(e){}
    try { bgr.delete(); } catch(e){}
  }
}

// ── Message handler ───────────────────────────────────────────────────────
// Use addEventListener instead of self.onmessage — Emscripten (OpenCV.js)
// can overwrite self.onmessage during WASM compilation.

self.addEventListener('message', async function(e) {
  var msg = e.data;
  postMessage({ type: 'ocr-status', message: 'Worker received: ' + msg.type });
  if (msg.type !== 'parse') return;

  try {
    postMessage({ type: 'ocr-status', message: 'Starting parse, bytes: ' + (msg.imageData ? msg.imageData.byteLength : 0) });
    await waitForCV(); // waits if still compiling, returns immediately if done
    var result = await parseScreenshot(msg.imageData);
    postMessage({ type: 'parse-result', id: msg.id,
      tiles: result.tiles, rack: result.rack,
      confidence: result.confidence, lowConfidenceCells: result.lowConfidenceCells });
  } catch (err) {
    postMessage({ type: 'parse-result', id: msg.id, error: err.message });
  }
});
