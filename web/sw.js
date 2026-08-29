const CACHE = 'sdp-shell-v1';
const SHELL = ['/', '/static/style.css', '/static/app.js', '/static/manifest.json'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL))));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/') || url.pathname === '/ws') return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
