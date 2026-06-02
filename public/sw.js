const CACHE_NAME = 'vod-network-v31';
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
  '/NotificationEngine.js',
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
  // Activate new service worker as soon as it's finished installing.
  self.skipWaiting();
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
  // Take control of uncontrolled clients as soon as the SW activates
  try { self.clients.claim(); } catch (e) { /* ignore on older browsers */ }
});

// Allow the page to trigger skipWaiting or clear caches via postMessage
self.addEventListener('message', (event) => {
  if (!event.data) return;
  if (event.data === 'SKIP_WAITING' || (event.data && event.data.type === 'SKIP_WAITING')) {
    self.skipWaiting();
  }
  if (event.data === 'CLEAR_CACHES' || (event.data && event.data.type === 'CLEAR_CACHES')) {
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))));
  }
});

self.addEventListener('fetch', event => {
  // For API calls and socket.io, always go to the network.
  if (event.request.url.includes('/api/') || event.request.url.includes('/socket.io/')) {
    // Do not use the cache for these. Let the browser handle it.
    return;
  }

  // For all other GET requests, use a cache-first strategy.
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      // If we have a cached response, return it immediately.
      if (cachedResponse) {
        return cachedResponse;
      }
      
      // If not in cache, fetch from the network and cache the response.
      return fetch(event.request).then(
        networkResponse => {
          // Check if we received a valid response to cache
          // Allow caching of cross-origin (CORS) responses, like from a CDN.
          if (!networkResponse || networkResponse.status !== 200) {
            return networkResponse;
          }
          
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
          
          return networkResponse;
        }
      );
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

self.addEventListener('sync', (event) => {
  console.log('Background sync triggered', event);
  // Future logic for sending offline posts when connection returns
});

self.addEventListener('periodicsync', (event) => {
  console.log('Periodic background sync triggered', event);
  // Future logic for fetching new feed data in the background
});