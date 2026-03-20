/**
 * Service worker with three cache buckets:
 *   app-shell-v1     : HTML, CSS, JS (precached on install)
 *   static-assets-v1 : dictionary + letter templates (precached on install)
 *   opencv-v1        : opencv.js (cached on first OCR use, NOT precached)
 */

const APP_SHELL = 'app-shell-v4';
const STATIC    = 'static-assets-v1';
const OPENCV    = 'opencv-v1';

const APP_SHELL_FILES = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/js/config.js',
  '/js/solver/gaddag.js',
  '/js/solver/gaddag-worker.js',
  '/js/solver/board.js',
  '/js/solver/move-generator.js',
  '/js/solver/scorer.js',
  '/js/ocr/ocr-worker.js',
  '/js/ocr/grid-detector.js',
  '/js/ocr/cell-classifier.js',
  '/js/ocr/letter-reader.js',
  '/manifest.json',
];

const TEMPLATE_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const STATIC_FILES = [
  '/data/twl06.txt',
  ...TEMPLATE_LETTERS.map(l => `/templates/${l}.png`),
];

// ── Install: precache app shell + static assets ──────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(APP_SHELL).then(cache => cache.addAll(APP_SHELL_FILES)),
      caches.open(STATIC).then(cache => cache.addAll(STATIC_FILES).catch(() => {})),
    ]).then(() => self.skipWaiting())
  );
});

// ── Activate: remove old caches ──────────────────────────────────────────

self.addEventListener('activate', (event) => {
  const keep = new Set([APP_SHELL, STATIC, OPENCV]);
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => !keep.has(k)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── Fetch: cache-first strategy ──────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only handle same-origin GET requests
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  const path = url.pathname;

  // OpenCV.js: cache on first use
  if (path.includes('opencv.js')) {
    event.respondWith(cacheFirst(event.request, OPENCV));
    return;
  }

  // Static assets (dictionary, templates)
  if (path.startsWith('/data/') || path.startsWith('/templates/')) {
    event.respondWith(cacheFirst(event.request, STATIC));
    return;
  }

  // App shell (everything else)
  event.respondWith(cacheFirst(event.request, APP_SHELL));
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}
