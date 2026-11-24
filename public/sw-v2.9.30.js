// Retired service worker.
// Version 2.9 of the app registered this file to cache app.js / styles.css, which no longer
// exist. Any browser that still has it installed gets this version, which clears its caches,
// unregisters itself and reloads open tabs onto the current app.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach((c) => c.navigate(c.url));
    })()
  );
});
