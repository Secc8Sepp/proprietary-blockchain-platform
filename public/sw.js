const CACHE_NAME = 'vod-network-v7';
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
        console.log('[SW] Caching core assets for offline-first experience.');
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
  // We only want to handle GET requests for http/https protocols
  if (event.request.method !== 'GET' || !event.request.url.startsWith('http')) {
    return;
  }

  // For API calls and socket.io, always go to the network.
  if (event.request.url.includes('/api/') || event.request.url.includes('/socket.io/')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      // If we have a cached response, return it immediately.
      if (cachedResponse) {
        return cachedResponse;
      }

      // If not in cache, fetch from the network.
      return fetch(event.request).then(networkResponse => {
        // After fetching, put a copy in the cache for next time.
        // We only cache successful responses.
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      });
    }).catch(() => {
      // For navigation requests when offline and not in cache, return the app shell.
      if (event.request.mode === 'navigate') {
        return caches.match('/index.html');
      }
    })
  );
});

self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : { title: 'VOD Network', body: 'New activity on the swarm.' };
  event.waitUntil(
    self.registration.showNotification(data.title, { body: data.body, icon: '/icons/icon-192x192.png' })
  );
});