/**
 * UI controller for Crossplay Helper PWA.
 * Replaces Flask fetch() calls with Web Worker postMessage().
 */

import { BOARD_LAYOUT } from './config.js';

// ── Worker setup ────────────────────────────────────────────────────────────

let solverWorker = null;
let ocrWorker = null;
let ocrReady = false;
let solverReady = false;
let pendingCalls = new Map(); // id -> { resolve, reject }
let callId = 0;

function initSolverWorker() {
  solverWorker = new Worker('js/solver/gaddag-worker.js', { type: 'module' });
  solverWorker.onmessage = (e) => {
    const { type, id } = e.data;
    if (type === 'status') {
      setStatus(e.data.message);
      return;
    }
    if (type === 'ready') {
      solverReady = true;
      setStatus('Ready.');
      return;
    }
    if (type === 'error') {
      setStatus('Error: ' + e.data.message);
      return;
    }
    // Resolve pending call
    const pending = pendingCalls.get(id);
    if (pending) {
      pendingCalls.delete(id);
      if (e.data.error) pending.reject(new Error(e.data.error));
      else pending.resolve(e.data);
    }
  };
  solverWorker.onerror = (e) => setStatus('Worker error: ' + e.message);
  setStatus('Loading dictionary...');
  solverWorker.postMessage({ type: 'init' });
}

function workerCall(worker, message) {
  return new Promise((resolve, reject) => {
    const id = ++callId;
    pendingCalls.set(id, { resolve, reject });
    console.log('[app] posting to worker:', message.type, 'id:', id, 'hasImageData:', !!message.imageData);
    worker.postMessage({ ...message, id });
    console.log('[app] postMessage done');
  });
}


// ── Board state ─────────────────────────────────────────────────────────────

let boardState = Array.from({ length: 15 }, () => Array(15).fill(null));
let selectedCell = null;
let currentMoves = [];

// ── Board rendering ─────────────────────────────────────────────────────────

export function initBoard() {
  const boardEl = document.getElementById('board');
  boardEl.innerHTML = '';
  for (let r = 0; r < 15; r++) {
    for (let c = 0; c < 15; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.row = r;
      cell.dataset.col = c;
      cell.addEventListener('click', () => selectCell(r, c));
      cell.addEventListener('touchend', (e) => {
        e.preventDefault();
        selectCell(r, c);
      });
      updateCellEl(cell, r, c);
      boardEl.appendChild(cell);
    }
  }
}

function updateCellEl(cell, r, c) {
  const tile = boardState[r][c];
  // Preserve highlight/editing classes
  const wasHighlight = cell.classList.contains('highlight');
  const wasEditing = cell.classList.contains('editing');
  const wasLowConf = cell.classList.contains('low-confidence');

  cell.className = 'cell';
  if (tile) {
    cell.classList.add('placed');
    if (/^[a-z]$/.test(tile)) cell.classList.add('blank');
    cell.textContent = tile.toUpperCase();
  } else {
    const premium = BOARD_LAYOUT[r][c];
    const classMap = { '2L': 'dl', '3L': 'tl', '2W': 'dw', '3W': 'tw', '*': 'star' };
    cell.classList.add(classMap[premium] || 'empty');
    cell.textContent = premium === '*' ? '★' : (premium === '.' ? '' : premium);
  }

  if (wasHighlight) cell.classList.add('highlight');
  if (wasEditing) cell.classList.add('editing');
  if (wasLowConf) cell.classList.add('low-confidence');
}

function getCell(r, c) {
  return document.querySelector(`.cell[data-row="${r}"][data-col="${c}"]`);
}

export function selectCell(r, c) {
  document.querySelectorAll('.cell.editing').forEach(el => el.classList.remove('editing'));
  selectedCell = { r, c };
  const cell = getCell(r, c);
  if (cell) cell.classList.add('editing');
  showMobileKeyboard(true);
}

// ── Mobile keyboard ─────────────────────────────────────────────────────────

function buildMobileKeyboard() {
  const kb = document.getElementById('mobileKeyboard');
  if (!kb) return;

  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (const letter of ALPHABET) {
    const btn = document.createElement('button');
    btn.className = 'key-btn';
    btn.textContent = letter;
    btn.addEventListener('click', () => typeKey(letter));
    kb.appendChild(btn);
  }

  const blankBtn = document.createElement('button');
  blankBtn.className = 'key-btn blank-btn';
  blankBtn.textContent = 'blank';
  blankBtn.title = 'Type a letter then it will be treated as blank';
  blankBtn.addEventListener('click', () => {
    if (!selectedCell) return;
    const { r, c } = selectedCell;
    const current = boardState[r][c];
    if (current && /^[A-Z]$/.test(current)) {
      boardState[r][c] = current.toLowerCase();
      const cell = getCell(r, c);
      if (cell) updateCellEl(cell, r, c);
    }
  });
  kb.appendChild(blankBtn);

  const delBtn = document.createElement('button');
  delBtn.className = 'key-btn delete-btn';
  delBtn.textContent = '⌫ del';
  delBtn.addEventListener('click', () => {
    if (!selectedCell) return;
    const { r, c } = selectedCell;
    boardState[r][c] = null;
    const cell = getCell(r, c);
    if (cell) updateCellEl(cell, r, c);
  });
  kb.appendChild(delBtn);
}

function showMobileKeyboard(show) {
  const kb = document.getElementById('mobileKeyboard');
  if (!kb) return;
  if (show) kb.classList.add('visible');
  else kb.classList.remove('visible');
}

function typeKey(letter) {
  if (!selectedCell) return;
  const { r, c } = selectedCell;
  boardState[r][c] = letter.toUpperCase();
  const cell = getCell(r, c);
  if (cell) updateCellEl(cell, r, c);
  // Advance selection
  if (c < 14) selectCell(r, c + 1);
  else if (r < 14) selectCell(r + 1, 0);
}

// ── Hardware keyboard ───────────────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  if (!selectedCell) return;
  const { r, c } = selectedCell;
  if (e.key === 'Backspace' || e.key === 'Delete') {
    boardState[r][c] = null;
    const cell = getCell(r, c);
    if (cell) updateCellEl(cell, r, c);
  } else if (/^[a-zA-Z]$/.test(e.key)) {
    boardState[r][c] = e.key.toUpperCase();
    const cell = getCell(r, c);
    if (cell) updateCellEl(cell, r, c);
    if (c < 14) selectCell(r, c + 1);
    else if (r < 14) selectCell(r + 1, 0);
  } else if (e.key === 'ArrowRight' && c < 14) { selectCell(r, c + 1); }
  else if (e.key === 'ArrowLeft'  && c > 0)  { selectCell(r, c - 1); }
  else if (e.key === 'ArrowDown'  && r < 14) { selectCell(r + 1, c); }
  else if (e.key === 'ArrowUp'    && r > 0)  { selectCell(r - 1, c); }
  else if (e.key === 'Escape') {
    document.querySelectorAll('.cell.editing').forEach(el => el.classList.remove('editing'));
    selectedCell = null;
    showMobileKeyboard(false);
  }
});

// ── Actions ─────────────────────────────────────────────────────────────────

export function clearBoard() {
  boardState = Array.from({ length: 15 }, () => Array(15).fill(null));
  selectedCell = null;
  currentMoves = [];
  initBoard();
  document.getElementById('results').innerHTML = '';
  setStatus('');
  showMobileKeyboard(false);
}

export async function solve() {
  if (!solverReady) {
    setStatus('Still loading dictionary, please wait...');
    return;
  }
  const rackInput = document.getElementById('rack').value.trim().toUpperCase();
  if (!rackInput) {
    setStatus('Enter your rack tiles first.');
    return;
  }
  setStatus('Solving...');
  document.querySelectorAll('.cell.highlight').forEach(el => el.classList.remove('highlight'));

  try {
    const result = await workerCall(solverWorker, {
      type: 'solve',
      rack: rackInput,
      tiles: boardState,
      top: 20,
    });
    setStatus(`Found ${result.totalFound} moves in ${result.elapsed}s`);
    currentMoves = result.moves || [];
    renderResults(currentMoves);
  } catch (err) {
    setStatus('Error: ' + err.message);
  }
}

async function checkWord(word) {
  if (!solverReady || !word) return;
  try {
    const result = await workerCall(solverWorker, { type: 'check-word', word });
    setStatus(`"${word.toUpperCase()}" is ${result.valid ? 'valid ✓' : 'not a valid word ✗'}`);
  } catch (err) {
    setStatus('Error: ' + err.message);
  }
}

// ── Results rendering ────────────────────────────────────────────────────────

function renderResults(moves) {
  const container = document.getElementById('results');
  if (!moves.length) {
    container.innerHTML = '<p style="color:var(--muted);margin-top:8px">No valid moves found.</p>';
    return;
  }
  let html = '<h2>Top Moves</h2>';
  moves.forEach((m, i) => {
    html += `<div class="result-row" data-idx="${i}">
      <span class="result-rank">${i + 1}</span>
      <span class="result-word">${m.word}</span>
      <span class="result-pos">(${m.row},${m.col}) ${m.direction}</span>
      <span class="result-score">${m.score}</span>
    </div>`;
  });
  container.innerHTML = html;

  container.querySelectorAll('.result-row').forEach(row => {
    row.addEventListener('click', () => highlightMove(parseInt(row.dataset.idx)));
  });
}

export function highlightMove(idx) {
  const move = currentMoves[idx];
  if (!move) return;

  // Reset board to clean state
  initBoard();

  document.querySelectorAll('.result-row.selected').forEach(el => el.classList.remove('selected'));
  const row = document.querySelector(`.result-row[data-idx="${idx}"]`);
  if (row) row.classList.add('selected');

  move.tilesPlaced.forEach(t => {
    const cell = getCell(t.row, t.col);
    if (cell) {
      cell.textContent = t.letter.toUpperCase();
      cell.className = 'cell placed highlight';
    }
  });
}

// ── Screenshot upload ────────────────────────────────────────────────────────

function setUploadStatus(msg) {
  document.getElementById('uploadStatus').textContent = msg;
}

async function uploadScreenshot(file) {
  if (!ocrReady) {
    setUploadStatus('OpenCV still loading — please wait...');
    return;
  }
  setUploadStatus('Parsing screenshot...');
  console.log('[app] uploadScreenshot called, file:', file.name, file.size);
  const arrayBuffer = await file.arrayBuffer();
  console.log('[app] arrayBuffer size:', arrayBuffer.byteLength);
  try {
    const data = await workerCall(ocrWorker, { type: 'parse', imageData: arrayBuffer });

    boardState = data.tiles.map(row => row.map(cell => cell || null));
    initBoard();

    if (data.rack && data.rack.length > 0) {
      const rackStr = data.rack.filter(l => l !== '?').join('');
      document.getElementById('rack').value = rackStr;
    }

    if (data.lowConfidenceCells) {
      data.lowConfidenceCells.forEach(lc => {
        const cell = getCell(lc.row, lc.col);
        if (cell) cell.classList.add('low-confidence');
      });
    }

    const pct = Math.round(data.confidence * 100);
    const lowCount = data.lowConfidenceCells ? data.lowConfidenceCells.length : 0;
    let msg = `Parsed (${pct}% confidence)`;
    if (lowCount > 0) msg += ` — ${lowCount} cell${lowCount > 1 ? 's' : ''} need review (orange)`;
    setUploadStatus(msg);

    if (document.getElementById('rack').value.trim()) solve();
  } catch (err) {
    setUploadStatus('Error: ' + err.message);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function setStatus(msg) {
  document.getElementById('status').textContent = msg;
}

function setUploadDisabled(disabled) {
  const area = document.getElementById('uploadArea');
  if (disabled) {
    area.style.opacity = '0.45';
    area.style.pointerEvents = 'none';
    area.style.cursor = 'not-allowed';
  } else {
    area.style.opacity = '';
    area.style.pointerEvents = '';
    area.style.cursor = '';
  }
}

// ── Bootstrap ────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initBoard();
  buildMobileKeyboard();
  initSolverWorker();

  // Start OCR worker immediately — OpenCV compiles in background while user sets up board
  ocrWorker = new Worker('js/ocr/ocr-worker.js');
  setUploadStatus('Loading OpenCV (compiling WebAssembly)...');
  setUploadDisabled(true);
  ocrWorker.onerror = (e) => {
    setUploadStatus('Worker crash: ' + (e.message || 'unknown error'));
  };
  ocrWorker.onmessage = (e) => {
    const { type } = e.data;
    if (type === 'ocr-status') {
      setUploadStatus(e.data.message);
    } else if (type === 'ocr-ready') {
      ocrReady = true;
      setUploadStatus('Ready — drop or paste a screenshot');
      setUploadDisabled(false);
    } else if (type === 'ocr-error') {
      setUploadStatus('OpenCV error: ' + e.data.message);
    } else {
      // parse-result
      const pending = pendingCalls.get(e.data.id);
      if (pending) {
        pendingCalls.delete(e.data.id);
        if (e.data.error) pending.reject(new Error(e.data.error));
        else pending.resolve(e.data);
      }
    }
  };

  // Wire up buttons
  document.getElementById('btnSolve').addEventListener('click', solve);
  document.getElementById('btnClear').addEventListener('click', clearBoard);

  const checkWordInput = document.getElementById('checkWordInput');
  if (checkWordInput) {
    document.getElementById('btnCheckWord').addEventListener('click', () => {
      checkWord(checkWordInput.value.trim());
    });
    checkWordInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') checkWord(checkWordInput.value.trim());
    });
  }

  // Upload area
  const uploadArea = document.getElementById('uploadArea');
  const fileInput = document.getElementById('fileInput');

  uploadArea.addEventListener('click', () => fileInput.click());
  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('dragover');
  });
  uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) uploadScreenshot(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      uploadScreenshot(fileInput.files[0]);
      fileInput.value = '';
    }
  });
  document.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        uploadScreenshot(item.getAsFile());
        return;
      }
    }
  });

  // Register service worker (skip on localhost to avoid dev caching issues)
  if ('serviceWorker' in navigator && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
});
