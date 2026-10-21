// AURA service worker (generated from src/sw/sw.template.js at build time).
// Strategy: precache everything (incl. MediaPipe WASM/models) for offline use;
// cache-first for same-origin GET; new versions wait until the app (idle at
// the title screen) asks us to activate. See docs/decisions.md D10.
const VERSION = '__VERSION__';
const CACHE = `aura-${VERSION}`;
const PRECACHE = __PRECACHE__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      // Add one by one so a single failure is visible and progress is steady.
      for (const url of PRECACHE) {
        try {
          await cache.add(new Request(url, { cache: 'reload' }));
        } catch (e) {
          console.warn('[sw] precache failed', url, e);
        }
      }
    }),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('aura-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: url.pathname.endsWith('/') || url.pathname.endsWith('.html') }).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
