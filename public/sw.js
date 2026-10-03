// LinguaLab service worker: app shell + course packs work offline.
// - navigation (index.html): network first, fall back to cache
// - same-origin assets and /content/*.json: cache first (filenames carry a version query)
// - native word audio from Wikimedia (CORS-enabled): cached on first play, so reviewed words work offline
//   (Tatoeba sentence audio has no CORS headers, so it is streamed, not cached)
const SHELL = 'lingualab-shell-v1';
const DATA = 'lingualab-data-v1';
const AUDIO = 'lingualab-audio-v1';
const AUDIO_MAX = 1500;

// hashed JS/CSS bundles referenced by an index.html (so the app opens offline after the first visit)
function bundlesOf(html) {
  return [...html.matchAll(/(?:src|href)="\.?\/?(assets\/[^"]+)"/g)].map((m) => new URL(m[1], self.registration.scope).href);
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      const res = await fetch('./index.html', { cache: 'no-cache' });
      const html = await res.clone().text();
      await cache.put('./index.html', res);
      await cache.addAll(['./', './manifest.webmanifest', './icon.svg', ...bundlesOf(html)]);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (e) => {
  const keep = new Set([SHELL, DATA, AUDIO]);
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (!keep.has(k)) await caches.delete(k);
      // drop bundles of previous builds
      const cache = await caches.open(SHELL);
      const index = await cache.match('./index.html');
      if (index) {
        const current = new Set(bundlesOf(await index.text()));
        for (const r of await cache.keys()) if (r.url.includes('/assets/') && !current.has(r.url)) await cache.delete(r);
      }
      await self.clients.claim();
    })(),
  );
});

async function trimAudio() {
  const cache = await caches.open(AUDIO);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - AUDIO_MAX; i++) await cache.delete(keys[i]);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html')),
    );
    return;
  }

  const isAudio = url.hostname === 'upload.wikimedia.org';
  if (isAudio) {
    e.respondWith(
      caches.open(AUDIO).then(async (cache) => {
        const hit = await cache.match(req.url);
        if (hit) return hit;
        try {
          const res = await fetch(req.url, { mode: 'cors' });
          if (res.ok) {
            cache.put(req.url, res.clone());
            trimAudio();
          }
          return res;
        } catch {
          return fetch(req);
        }
      }),
    );
    return;
  }

  if (url.origin !== self.location.origin) return;
  const bucket = url.pathname.includes('/content/') ? DATA : SHELL;
  e.respondWith(
    caches.open(bucket).then(async (cache) => {
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) {
        // keep only the newest version of each content file (URLs differ by ?v=build)
        if (bucket === DATA) {
          for (const k of await cache.keys()) if (new URL(k.url).pathname === url.pathname) await cache.delete(k);
        }
        cache.put(req, res.clone());
      }
      return res;
    }),
  );
});
