const CACHE_NAME = 'vod-network-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/app.js',
  '/manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS_TO_CACHE)));
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(response => response || fetch(event.request))
  );
});

self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : { title: 'VOD Network', body: 'New activity on the swarm.' };
  event.waitUntil(
    self.registration.showNotification(data.title, { body: data.body, icon: 'https://api.dicebear.com/7.x/identicon/svg?seed=vod&backgroundColor=1f2833' })
  );
});