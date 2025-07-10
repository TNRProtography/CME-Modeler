// sw.js - More Robust Version
const CACHE_NAME = 'cme-modeler-cache-v6'; // Version incremented

// App Shell: The minimal set of files to get the app running.
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.ico',
  '/forecast.html',
  '/icons/android-chrome-192x192.png',
  '/icons/android-chrome-512x512.png',
];

// INSTALL: Cache the app shell.
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Install');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Caching app shell');
      return cache.addAll(urlsToCache);
    })
  );
  self.skipWaiting();
});

// ACTIVATE: Clean up old caches.
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activate');
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(keyList.map((key) => {
        if (key !== CACHE_NAME) {
          console.log('[Service Worker] Removing old cache', key);
          return caches.delete(key);
        }
      }));
    })
  );
  return self.clients.claim();
});

// FETCH: Serve from cache, fall back to network, and cache new requests.
self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // Strategy: Stale-While-Revalidate for HTML/main requests to keep it fast and fresh.
  // This helps ensure the user gets updates quickly.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) => {
        return fetch(event.request).then((networkResponse) => {
          // If fetch is successful, cache the new version
          cache.put(event.request, networkResponse.clone());
          return networkResponse;
        }).catch(() => {
          // If fetch fails (offline), serve the cached version
          return cache.match(event.request);
        });
      })
    );
    return;
  }

  // Strategy: Cache-first for all other assets (JS, CSS, images).
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse; // Return from cache if found
      }
      
      // Not in cache, fetch from network
      return fetch(event.request).then((networkResponse) => {
        // Don't cache opaque responses (from third-party CDNs without CORS)
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type === 'opaque') {
          return networkResponse;
        }

        // Cache the new response
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        
        return networkResponse;
      });
    })
  );
}); 