// Lets phones install the app. It passes requests straight to the network
// (no caching), so new versions show up right away.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  if (new URL(e.request.url).origin === location.origin) e.respondWith(fetch(e.request));
});
