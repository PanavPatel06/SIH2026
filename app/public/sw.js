// Hand-rolled instead of Workbox — the build-tool route (vite-plugin-pwa)
// breaks on paths containing an apostrophe, and this app's offline data
// strategy already lives in src/offline.js (localStorage cache + outbox), so
// the service worker's only job is: make the app shell open with zero network.
// Bump this string on any deploy that must force old clients to drop their
// cached shell (a broken build, a security fix) — activate below deletes
// every cache not matching the current name.
const SHELL_CACHE = "vaari-shell-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.add("/")));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== SHELL_CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});
// ponytail: within one SHELL_CACHE version, hashed bundle filenames from old
// builds still accumulate as individually-cached entries (cache-first below
// never evicts them) — bounded by how often the shell HTML itself is
// refetched, not unbounded. A real LRU/expiry policy is Workbox's job; add
// it back if cache bloat from repeated redeploys ever actually shows up.

// Cache-first for the built app shell (JS/CSS/HTML), network-only for the API
// (src/api.js already handles the API's own offline fallback via localStorage).
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // let API calls to the backend pass straight through
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((res) => {
          if (res.ok) caches.open(SHELL_CACHE).then((c) => c.put(event.request, res.clone()));
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
