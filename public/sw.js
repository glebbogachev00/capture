/*
 * Two caches with different philosophies:
 *
 *  - Hashed build assets (/_next/static/, fonts) are immutable by name — a
 *    changed file gets a new URL. Serving them cache-first means an app
 *    open costs zero network for ~1MB of chunks, which is the difference
 *    between instant and sluggish when the phone reaches the Mac over
 *    Tailscale. The cache is capped, oldest entries first, so builds don't
 *    accumulate forever.
 *
 *  - Everything else (navigations, manifest, icons) is network-first,
 *    falling back to cache so the board still opens on a plane. The board
 *    itself lives in IndexedDB, so everything is readable offline — only
 *    sorting a new capture needs a connection.
 *
 * Bump VERSION to drop both caches on the next activate.
 */
const VERSION = "v2";
const SHELL_CACHE = `capture-shell-${VERSION}`;
const STATIC_CACHE = `capture-static-${VERSION}`;
const APP_SHELL = ["/", "/icon.svg"];
const STATIC_LIMIT = 80;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== SHELL_CACHE && k !== STATIC_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

/** Content-hashed by the build: the same URL can never mean different bytes. */
const isImmutable = (url) =>
  url.pathname.startsWith("/_next/static/") ||
  /\.(?:woff2?|ttf|otf)$/.test(url.pathname);

/** Keep the immutable cache from growing build over build. */
async function trimStatic() {
  const cache = await caches.open(STATIC_CACHE);
  const keys = await cache.keys();
  if (keys.length > STATIC_LIMIT) {
    await Promise.all(
      keys.slice(0, keys.length - STATIC_LIMIT).map((k) => cache.delete(k))
    );
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Sorting needs the network by definition, and the login gate must never be
  // answered from a stale cache.
  if (url.pathname.startsWith("/api/")) return;

  if (isImmutable(url)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            const copy = response.clone();
            caches
              .open(STATIC_CACHE)
              .then((cache) => cache.put(request, copy))
              .then(trimStatic)
              .catch(() => {});
            return response;
          })
      )
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches
          .open(SHELL_CACHE)
          .then((cache) => cache.put(request, copy))
          .catch(() => {});
        return response;
      })
      .catch(() =>
        caches.match(request).then((cached) => cached ?? caches.match("/"))
      )
  );
});
