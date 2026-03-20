/**
 * Web Worker: builds GADDAG, caches in IndexedDB, handles solve requests.
 * Phase 2 of the PWA port.
 */

// Worker uses importScripts for non-module compatibility, but we use ES modules
// by declaring type="module" in the worker spawn. We import using relative paths.

import { GADDAG } from './gaddag.js';
import { Board } from './board.js';
import { generateMoves } from './move-generator.js';

const DB_NAME = 'crossplay-helper';
const DB_VERSION = 1;
const STORE_NAME = 'gaddag';
const GADDAG_KEY = 'twl06';

let gaddag = null;

// ── IndexedDB helpers ──────────────────────────────────────────────────────

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadFromDB(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(GADDAG_KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function saveToDB(db, data) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const req = tx.objectStore(STORE_NAME).put(data, GADDAG_KEY);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ── GADDAG serialization ──────────────────────────────────────────────────
// We can't structured-clone plain objects with prototype null cleanly across
// all browsers, so we convert the trie to a regular nested object for storage.

function trieToJSON(node) {
  const out = {};
  for (const k of Object.keys(node)) {
    out[k] = trieToJSON(node[k]);
  }
  return out;
}

function trieFromJSON(obj) {
  const node = Object.create(null);
  for (const k of Object.keys(obj)) {
    node[k] = trieFromJSON(obj[k]);
  }
  return node;
}

// ── Initialization ────────────────────────────────────────────────────────

async function init() {
  postMessage({ type: 'status', message: 'Opening cache...' });

  let db;
  try {
    db = await openDB();
  } catch (e) {
    // IndexedDB unavailable (e.g. private browsing on some browsers) — skip cache
    db = null;
  }

  // Try to load from IndexedDB
  if (db) {
    try {
      const cached = await loadFromDB(db);
      if (cached) {
        postMessage({ type: 'status', message: 'Loading GADDAG from cache...' });
        gaddag = new GADDAG();
        gaddag.root = trieFromJSON(cached);
        postMessage({ type: 'ready' });
        return;
      }
    } catch (e) {
      // Cache miss or error — fall through to build
    }
  }

  // Build from word list
  postMessage({ type: 'status', message: 'Fetching dictionary...' });
  let text;
  try {
    const resp = await fetch('../../data/twl06.txt');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    text = await resp.text();
  } catch (e) {
    postMessage({ type: 'error', message: `Failed to fetch dictionary: ${e.message}` });
    return;
  }

  postMessage({ type: 'status', message: 'Building GADDAG (this takes a few seconds)...' });
  gaddag = GADDAG.fromWordList(text);

  // Cache in IndexedDB
  if (db) {
    try {
      postMessage({ type: 'status', message: 'Saving to cache...' });
      await saveToDB(db, trieToJSON(gaddag.root));
    } catch (e) {
      // Cache write failed — non-fatal
    }
  }

  postMessage({ type: 'ready' });
}

// ── Message handler ───────────────────────────────────────────────────────

self.onmessage = async (e) => {
  const { type, id } = e.data;

  if (type === 'init') {
    await init();
    return;
  }

  if (type === 'solve') {
    if (!gaddag) {
      postMessage({ type: 'solve-result', id, error: 'GADDAG not ready' });
      return;
    }
    const { rack, tiles, top = 20 } = e.data;
    try {
      const board = Board.fromUITiles(tiles);
      const rackArr = rack.toUpperCase().split('').filter(c => /[A-Z?]/.test(c));
      const start = Date.now();
      const moves = generateMoves(board, rackArr, gaddag);
      const elapsed = ((Date.now() - start) / 1000).toFixed(2);
      postMessage({
        type: 'solve-result',
        id,
        moves: moves.slice(0, top),
        totalFound: moves.length,
        elapsed,
      });
    } catch (err) {
      postMessage({ type: 'solve-result', id, error: err.message });
    }
    return;
  }

  if (type === 'check-word') {
    if (!gaddag) {
      postMessage({ type: 'check-word-result', id, error: 'GADDAG not ready' });
      return;
    }
    const { word } = e.data;
    postMessage({ type: 'check-word-result', id, valid: gaddag.isWord(word) });
    return;
  }
};
