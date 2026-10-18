// Service worker minimal : rend le salon installable comme une appli. Toujours le réseau d'abord (le salon est en direct),
// la page en cache ne sert que si le réseau est coupé, pour afficher un message clair.
const CACHE = 'salon-v1';
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(['/', '/icon-192.png'])).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(() => caches.match('/')));
});
