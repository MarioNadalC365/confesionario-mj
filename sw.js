/* El Confesionario · Service Worker v4.5 */

const VERSION = 'v4.5-2026-04-21';
const APP_CACHE = `confesionario-app-${VERSION}`;
const RUNTIME_CACHE = `confesionario-runtime-${VERSION}`;

const APP_ASSETS = [
  './',
  './index.html',
  './app.js',
  './styles.css',
  './manifest.json',
  './icon192.png',
  './icon512.png',
  './appletouchicon.png',
];

const CDN_HOSTS = [
  'cdn.jsdelivr.net',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(APP_CACHE)
      .then((cache) => cache.addAll(APP_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== APP_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (req.headers.has('range')) return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(req));
    return;
  }
  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }
  event.respondWith(fetch(req).catch(() => caches.match(req)));
});

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) {
    fetch(req).then((res) => {
      if (res && res.ok) {
        const clone = res.clone();
        caches.open(APP_CACHE).then((c) => c.put(req, clone)).catch(() => {});
      }
    }).catch(() => {});
    return cached;
  }
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      const clone = res.clone();
      caches.open(APP_CACHE).then((c) => c.put(req, clone)).catch(() => {});
    }
    return res;
  } catch (err) {
    if (req.mode === 'navigate') {
      const fallback = await caches.match('./index.html');
      if (fallback) return fallback;
    }
    throw err;
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(req);
  const networkPromise = fetch(req).then((res) => {
    if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  }).catch(() => null);
  return cached || (await networkPromise) || new Response('', { status: 504 });
}
