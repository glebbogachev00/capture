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
const VERSION = "v3";
const SHELL_CACHE = `capture-shell-${VERSION}`;
const STATIC_CACHE = `capture-static-${VERSION}`;
const APP_SHELL = ["/icon.svg"];
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

/** A stalled network must not hold a saved installed shell indefinitely. */
async function fetchShell(request) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      fetch(request, { signal: controller.signal }),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error("Shell navigation timed out"));
          controller.abort();
        }, 4000);
      }),
    ]);
  } finally { clearTimeout(timer); }
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
            if (!response.ok || response.redirected) return response;
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

  // Only generic HTML entry shells and public icons. Never cache login,
  // callbacks, RSC payloads or arbitrary documents. Identity stays in /api/.
  const shell = request.mode === "navigate" && (url.pathname === "/app" || url.pathname === "/");
  const icon = ["/icon.svg", "/manifest.webmanifest", "/favicon.ico"].includes(url.pathname);
  if ((!shell && !icon) || request.headers.get("RSC")) return;
  const key = url.pathname;
  event.respondWith(
    fetchShell(request).then((response) => {
      if (response.ok && !response.redirected) {
        const copy = response.clone();
        event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.put(key, copy)).catch(() => {}));
      }
      return response;
    }).catch(async () => (await caches.match(key)) ?? new Response("Open Capture online once to save its app shell.", {
      status: 503, headers: { "Content-Type": "text/plain" },
    }))
  );
});
