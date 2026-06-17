const CACHE = 'clearstream-v12';
const MEDIA_CACHE = 'clearstream-media-v4';
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon.svg',
  '/css/styles.css',
  '/js/config.js',
  '/js/api.js',
  '/js/cache.js',
  '/js/persist.js',
  '/js/queue.js',
  '/js/player.js',
  '/js/shield.js',
  '/js/install.js',
  '/js/app.js',
];

const MEDIA_CACHE_LIMIT = 40;

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE && k !== MEDIA_CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

async function trimMediaCache(cache) {
  const keys = await cache.keys();
  if (keys.length <= MEDIA_CACHE_LIMIT) return;
  const excess = keys.length - MEDIA_CACHE_LIMIT;
  for (let i = 0; i < excess; i += 1) {
    await cache.delete(keys[i]);
  }
}

async function cacheMediaResponse(request, response) {
  const cache = await caches.open(MEDIA_CACHE);
  await cache.put(request, response);
  await trimMediaCache(cache);
}

async function serveCachedMedia(request, cached) {
  const range = request.headers.get('Range');
  if (!range) return cached;

  const blob = await cached.blob();
  const size = blob.size;
  const parts = range.replace(/bytes=/, '').split('-');
  const start = parseInt(parts[0], 10);
  const end = parts[1] ? parseInt(parts[1], 10) : size - 1;

  if (Number.isNaN(start) || start >= size || end >= size || start > end) {
    return new Response(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${size}` },
    });
  }

  const slice = blob.slice(start, end + 1);
  const headers = new Headers(cached.headers);
  headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  headers.set('Content-Length', String(end - start + 1));
  headers.set('Accept-Ranges', 'bytes');

  return new Response(slice, { status: 206, headers });
}

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname === '/api/media') {
    e.respondWith((async () => {
      const cache = await caches.open(MEDIA_CACHE);
      const cacheKey = new Request(url.pathname + url.search);
      const cached = await cache.match(cacheKey);

      if (cached) {
        return serveCachedMedia(e.request, cached);
      }

      const res = await fetch(e.request);
      if (res.ok && !e.request.headers.get('Range')) {
        await cacheMediaResponse(cacheKey, res.clone());
      }
      return res;
    })());
    return;
  }

  if (url.pathname.startsWith('/api/')) return;

  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;

      return fetch(e.request)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => new Response('Offline', { status: 503, statusText: 'Offline' }));
    })
  );
});
