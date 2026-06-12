/* Service worker: cache the app shell for offline use, and keep the last
 * successful bazaar response so the app shows stale-but-useful data offline. */
const SHELL_CACHE = "bazaar-shell-v2";
const DATA_CACHE = "bazaar-data-v1";
const SHELL = [
  "./", "index.html", "styles.css", "app.js", "recipes.js", "manifest.json",
  "fonts/minecraft.woff2", "fonts/minecraft.woff",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== SHELL_CACHE && k !== DATA_CACHE).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // Live API: network-first, fall back to last cached response when offline.
  if (url.hostname === "api.hypixel.net") {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(DATA_CACHE).then((c) => c.put(e.request, copy));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // App shell: cache-first.
  if (url.origin === location.origin) {
    e.respondWith(caches.match(e.request).then((cached) => cached || fetch(e.request)));
  }
});
