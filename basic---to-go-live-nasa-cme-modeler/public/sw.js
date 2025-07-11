// sw.js - More Robust Version
const CACHE_NAME = 'cme-modeler-cache-v13'; // Version incremented to force update

// App Shell: The minimal set of files to get the app running.
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.ico',
  '/forecast.html',
  '/solar-activity.html',
  '/icons/android-chrome-192x192.png',
  '/icons/android-chrome-512x512.png',
  '/placeholder.png', // Add a placeholder image if you create one
  '/error.png', // Add an error image if you create one
];

// List of API domains that should use a network-first strategy
const API_HOSTS = [
  'api.nasa.gov', // Included as it's used for DONKI API (Flares, Active Regions)
  'services.swpc.noaa.gov', // Included for X-ray Flux data
  'hemispheric-power.thenamesrock.workers.dev',
  'tnr-aurora-forecast.thenamesrock.workers.dev',
  'basic-aurora-forecast.thenamesrock.workers.dev',
  'aurora-sightings.thenamesrock.workers.dev',
  // 'sdo.gsfc.nasa.gov', // This was for SDO images; SUVI images now come from services.swpc.noaa.gov
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
  // This ensures data is always fresh, with an offline fallback.
  if (API_HOSTS.includes(url.hostname)) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          // If fetch is successful, cache the new response for offline use
          if (!networkResponse || networkResponse.status !== 200 || networkResponse.type === 'opaque') {
            return networkResponse;
          }
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
          return networkResponse;
        })
        .catch(() => {
          // If fetch fails (offline), serve the cached version if it exists
          console.warn(`[Service Worker] Network-first fetch failed for ${url.hostname}, serving from cache.`);
          return caches.match(event.request);
        })
    );
    return;
  }

  // --- Fallback to original logic for non-API requests ---

  // Strategy 2: Network-first for the main HTML page (`index.html`) to get app updates.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          // If fetch is successful, cache the new version
          if (!networkResponse || networkResponse.status !== 200) {
            return networkResponse;
          }
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
          return networkResponse;
        })
        .catch(() => {
          // If fetch fails (offline), serve the cached version of the main page
          console.warn(`[Service Worker] Navigation fetch failed for ${url.pathname}, serving from cache.`);
          return caches.match(event.request);
        })
    );
    return;
  }

  // Strategy 3: Cache-first for all other static assets (JS bundles, CSS, images, etc.).
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      
      // Not in cache, fetch from network
      return fetch(event.request).then((networkResponse) => {
        // Don't cache opaque responses (from third-party CDNs without CORS) or errors
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type === 'opaque') {
          return networkResponse;
        }

        // Cache the new response
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        
        return networkResponse;
      }).catch((error) => {
        console.error(`[Service Worker] Cache-first network fetch failed for ${url.pathname}:`, error);
        return new Response('Network error for asset.', { status: 503 });
      });
    })
  );
});