// The service worker, so the game plays with no network, installed to the home screen or not. Only
// production builds have it: the `pwa` build plugin (tools/pwa.mjs) writes it out as sw.js with
// VERSION and SHELL filled in, and main.ts registers it.
//
// - The app shell (the page, its code and styles, the manifest and icons) is cached as it installs.
// - Everything else (art, sounds, voices, music) is cached the first time it's fetched and served from
//   the cache after that. The page also hands over what it fetched before this worker took over, so
//   one visit is enough to play offline.
// - The page itself comes from the network whenever there is one, so a new version shows up on the
//   next launch. Each version caches afresh and the old cache is dropped.
// - Music plays through <audio>, which asks for byte ranges: those are cut from the cached file.

const VERSION = '__VERSION__';
const SHELL = __SHELL__;
const CACHE = `fairy-wings-${VERSION}`;
/** Files here never vary by who asks, whatever a server's Vary header says (Vite's says Origin, which a module script sends). */
const MATCH = { ignoreVary: true };

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

// from the page: { type: 'cache', urls } for what it fetched before this worker took over
self.addEventListener('message', (event) => {
  if (event.data?.type === 'cache') event.waitUntil(keep(event.data.urls));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;
  if (request.mode === 'navigate') event.respondWith(page(request));
  else if (request.headers.has('range')) event.respondWith(range(event));
  else event.respondWith(cached(event));
});

/** The page: from the network when there is one (so updates arrive), else the copy kept last time. */
async function page(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put('./', response.clone());
    return response;
  } catch {
    return (await cache.match('./', MATCH)) ?? Response.error();
  }
}

/** Anything else: from the cache, or fetched and kept. */
async function cached(event) {
  const cache = await caches.open(CACHE), hit = await cache.match(event.request, MATCH);
  if (hit) return hit;
  const response = await fetch(event.request);
  if (response.status === 200) event.waitUntil(cache.put(event.request, response.clone()));
  return response;
}

/** Part of a file (how <audio> asks for music): cut from the kept copy; until there is one, from the network while the whole file is fetched to keep. */
async function range(event) {
  const request = event.request, cache = await caches.open(CACHE), hit = await cache.match(request.url, MATCH);
  if (!hit) {
    event.waitUntil(fetch(request.url).then((r) => (r.status === 200 ? cache.put(request.url, r) : undefined)).catch(() => {}));
    return fetch(request);
  }
  const body = await hit.arrayBuffer(), total = body.byteLength;
  const [, from = '', to = ''] = /bytes=(\d*)-(\d*)/.exec(request.headers.get('range') ?? '') ?? [];
  let start = from ? Number(from) : 0, end = to ? Math.min(Number(to), total - 1) : total - 1;
  if (!from && to) { start = Math.max(0, total - Number(to)); end = total - 1; } // the last n bytes
  if (start >= total || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${total}` } });
  return new Response(body.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': hit.headers.get('Content-Type') ?? 'application/octet-stream',
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
    },
  });
}

/** Keeps copies of `urls` (this site's only), skipping any already kept. */
async function keep(urls) {
  const cache = await caches.open(CACHE);
  await Promise.all(urls.map(async (url) => {
    if (new URL(url).origin !== location.origin || (await cache.match(url, MATCH))) return;
    try {
      const response = await fetch(url);
      if (response.status === 200) await cache.put(url, response);
    } catch { /* offline: it'll be kept the next time it's fetched */ }
  }));
}
