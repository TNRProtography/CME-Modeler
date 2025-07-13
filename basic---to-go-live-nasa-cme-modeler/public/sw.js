// sw.js - More Robust Version
const CACHE_NAME = 'cme-modeler-cache-v31'; // Increment version!

// App Shell: The minimal set of files to get the app running.
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.ico',
  '/icons/android-chrome-192x192.png',
  '/icons/android-chrome-512x512.png',
  '/placeholder.png', 
  '/error.png', 
];

// List of API domains that should use a network-first strategy
const API_HOSTS = [
  'api.nasa.gov', 
  'services.swpc.noaa.gov', 
  'spottheaurora.thenamesrock.workers.dev', // CORRECTED: Added the primary forecast API host
  'hemispheric-power.thenamesrock.workers.dev',
  'aurora-sightings.thenamesrock.workers.dev',
  'huxt-bucket.s3.eu-west-2.amazonaws.com',
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

// FETCH: Handle network requests
self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  const url = new URL(event.request.url);

  // Strategy 1: Network First for explicitly listed API hosts.
  if (API_HOSTS.includes(url.hostname)) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (!networkResponse || networkResponse.status !== 200) {
            return networkResponse;
          }
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
          return networkResponse;
        })
        .catch(() => {
          console.warn(`[Service Worker] Network-first fetch failed for ${url.hostname}, serving from cache.`);
          return caches.match(event.request);
        })
    );
    return;
  }

  // Strategy 2: Cache-first for all other requests.
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // Return cached response if found
      if (cachedResponse) {
        return cachedResponse;
      }
      
      // Otherwise, fetch from network
      return fetch(event.request).then((networkResponse) => {
        // Don't cache opaque responses or errors
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