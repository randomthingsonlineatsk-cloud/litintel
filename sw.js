// LitIntel service worker: keeps the app itself available offline.
// Database and Crossref requests always go to the network and are never cached.
const CACHE = 'litintel-v0.3.0';
const SHELL = ['./', 'index.html', 'core.js', 'app.js', 'sample.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  const sameOrigin = url.origin === self.location.origin;
  const fonts = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (e.request.method !== 'GET' || (!sameOrigin && !fonts)) return; // APIs: straight to the network
  // network first so updates arrive quickly; fall back to the cached copy when offline
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request).then((m) => m || (e.request.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
});
