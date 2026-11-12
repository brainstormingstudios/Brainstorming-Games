/*
 * Brainstorming Games service worker (written to /sw.js by scripts/postbuild.mjs).
 *
 * It caches the app shell only: hashed build assets, brand images and the offline page.
 * Game files are never cached here; they live on another origin and can be very large.
 */
const BUILD_ID = '__BUILD_ID__';
const OFFLINE_URLS = JSON.parse('__OFFLINE_URLS__');
const SHELL_CACHE = `bg-shell-${BUILD_ID}`;
const ASSET_CACHE = 'bg-assets-v1';
const PRECACHE = [...OFFLINE_URLS, '/brand/mascot-256.webp', '/brand/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k.startsWith('bg-shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function offlineFor(url) {
  const locale = /^\/([a-z]{2})\//.exec(url.pathname);
  const candidate = locale ? `/${locale[1]}/offline/` : '/offline/';
  return OFFLINE_URLS.includes(candidate) ? candidate : '/offline/';
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Page loads: network first, offline page if there is no connection.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(SHELL_CACHE);
        return (await cache.match(offlineFor(url))) || Response.error();
      }),
    );
    return;
  }

  // Hashed build assets and brand files never change under the same URL: cache first.
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/brand/')) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      }),
    );
  }
});
