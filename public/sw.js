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
    fetch(event.request)
      .then(response => {
        // Only cache successful GET requests
        if (event.request.method === 'GET' && response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : { title: 'VOD Network', body: 'New activity on the swarm.' };
  event.waitUntil(
    self.registration.showNotification(data.title, { body: data.body, icon: 'https://api.dicebear.com/7.x/identicon/svg?seed=vod&backgroundColor=1f2833' })
  );
});