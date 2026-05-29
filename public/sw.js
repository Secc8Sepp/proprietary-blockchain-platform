const CACHE_NAME = 'vod-network-v2';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/styles.css',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/utils.js',
  '/crypto.js',
  '/CoreEngine.js',
  '/MeshEngine.js',
  '/WalletEngine.js',
  '/AudioEngine.js',
  '/LayoutEngine.js',
  '/ActionEngine.js',
  '/GlobalTagEngine.js',
  '/BattleEngines.js',
  '/StemSplitterEngine.js',
  '/app.js',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Caching core assets');
        return cache.addAll(ASSETS_TO_CACHE);
      })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (event.request.method === 'GET' && response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then(cachedResponse => cachedResponse || caches.match('/index.html')))
  );
});

self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : { title: 'VOD Network', body: 'New activity on the swarm.' };
  event.waitUntil(
    self.registration.showNotification(data.title, { body: data.body, icon: '/icons/icon-192x192.png' })
  );
});