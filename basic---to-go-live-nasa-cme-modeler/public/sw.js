// sw.js - More Robust Version
const CACHE_NAME = 'cme-modeler-cache-v9'; // Version incremented to force update on all clients

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

// List of API domains that should use a network-first strategy
const API_HOSTS = [
  'api.nasa.gov',
  'services.swpc.noaa.gov',
  'hemispheric-power.thenamesrock.workers.dev',
  'tnr-aurora-forecast.thenamesrock.workers.dev',
  'basic-aurora-forecast.thenamesrock.workers.dev',
  'aurora-sightings.thenamesrock.workers.dev'
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

  const url = new URL(event.request.url);

  // --- NEW STRATEGY: Network Only for /solar-data ---
  // This ensures that the /solar-data endpoint always fetches from the network
  // and is NEVER cached by the Service Worker.
  if (url.pathname === '/solar-data') {
    event.respondWith(
      fetch(event.request).catch(() => {
        // If the network fails (e.g., user is offline),
        // we explicitly return a network error. No cached fallback.
        return new Response('Solar activity data not available offline.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain' },
        });
      })
    );
    return; // Stop further processing for this request
  }
  // --- END NEW STRATEGY ---


  // Strategy 1: Network First for explicitly listed API hosts.
  // This ensures data is always fresh, with an offline fallback.
  // Note: This strategy still caches the response for offline use.
  if (API_HOSTS.includes(url.hostname)) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          // If fetch is successful, cache the new response for offline use
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
          return networkResponse;
        })
        .catch(() => {
          // If fetch fails (offline), serve the cached version if it exists
          return caches.match(event.request);
        })
    );
    return; // End execution for API requests
  }

  // --- Fallback to original logic for non-API requests ---

  // Strategy 2: Network-first for the main HTML page to get app updates.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          // If fetch is successful, cache the new version
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
          return networkResponse;
        })
        .catch(() => {
          // If fetch fails (offline), serve the cached version
          return caches.match(event.request);
        })
    );
    return;
  }

  // Strategy 3: Cache-first for all other static assets (JS, CSS, images).
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