/* Classic worker script — not a module, so no imports here.
   Bump CACHE when any shell file changes; activate purges older caches. */
const CACHE = 'weekly-innings-v5';

/* './' rather than './index.html': Vercel's cleanUrls 308-redirects
   /index.html to /, addAll follows the redirect and stores a response with the
   redirected flag set, and the spec makes it a network error to respondWith a
   redirected response for a navigation. Cache-first means that would fire on
   every launch, not only offline. '/' does not redirect. */
const SHELL = [
  './',
  './styles.css',
  './app.js',
  './exams.js',
  './schedule.js',
  './storage.js',
  './sync.js',
  './progress.js',
];

/* Cached one at a time, because addAll is all-or-nothing and a single 404
   would fail the install and leave the worker unactivated forever. config.js
   is generated at build time and gitignored, so it is the realistic 404. */
const EXTRAS = [
  './config.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL)
        .then(() => Promise.allSettled(EXTRAS.map((u) => c.add(u)))))
      .then(() => self.skipWaiting())
  );
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
      hit || fetch(e.request).catch(() =>
        (e.request.mode === 'navigate' ? caches.match('./') : Response.error()))
    )
  );
});
