/* Classic worker script — not a module, so no imports here.
   Bump CACHE when any shell file changes; activate purges older caches. */
const CACHE = 'weekly-innings-v2';

const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './config.js',
  './exams.js',
  './storage.js',
  './sync.js',
  './progress.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  /* Supabase is never cached: a stale tick is worse than no tick. */
  if (url.hostname.endsWith('.supabase.co')) return;

  /* Fonts are cross-origin and immutable — cache them on first use so the
     installed app renders correctly with no network at all. */
  if (url.hostname.endsWith('gstatic.com') || url.hostname.endsWith('googleapis.com')) {
    e.respondWith(
      caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      }).catch(() => hit))
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  e.respondWith(
    caches.match(e.request).then((hit) =>
      hit || fetch(e.request).catch(() => caches.match('./index.html'))
    )
  );
});
