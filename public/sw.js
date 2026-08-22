const CACHE = "v2.9.36.1";
const CORE = [
  "./",
  "./index.html",
  "./styles.css",
  "./config.js",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/logo-default.png",
  "./icons/icon16.png",
  "./icons/icon32.png",
  "./icons/icon48.png",
  "./icons/icon128.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(CORE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  const isAppAsset =
    url.pathname.endsWith("/") ||
    /\.(html|css|js|json|webmanifest|png|jpg|jpeg|svg|ico)$/i.test(url.pathname);

  if (!isAppAsset) return;

  event.respondWith(
    fetch(event.request, { cache: "no-store" })
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then(cached => cached || caches.match("./index.html")))
  );
});
