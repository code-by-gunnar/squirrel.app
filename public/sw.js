/*
 * Minimal service worker for Squirrel.
 * Satisfies the PWA installability requirement (a fetch handler) and speeds up
 * static assets with a cache-first strategy. Dynamic, DB-backed pages fall
 * through to the network so data is never served stale.
 */
const STATIC_CACHE = "squirrel-static-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== STATIC_CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

function isStatic(url) {
  return (
    url.origin === self.location.origin &&
    (url.pathname.startsWith("/_next/static") ||
      url.pathname.startsWith("/icon-") ||
      url.pathname === "/apple-touch-icon.png")
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (!isStatic(url)) return; // let the network handle dynamic requests

  event.respondWith(
    caches.open(STATIC_CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone());
      return response;
    }),
  );
});
