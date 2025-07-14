// sw.js - Network-Only Strategy
const CACHE_NAME = 'cme-modeler-cache-v32-network-only'; // New version name to force update

// INSTALL: The service worker now installs but does not pre-cache anything.
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Install');
  // We are not caching the app shell anymore to ensure freshness on every load.
  self.skipWaiting();
});

// ACTIVATE: Clean up all old caches.
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activate');
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(keyList.map((key) => {
        console.log('[Service Worker] Removing old cache', key);
        return caches.delete(key);
      }));
    })
  );
  return self.clients.claim();
});

// FETCH: Always fetch from the network.
self.addEventListener('fetch', (event) => {
  // We are bypassing the cache and going directly to the network.
  // This ensures that all resources (app files, API data) are always fresh.
  event.respondWith(
    fetch(event.request).catch((error) => {
      console.error('[Service Worker] Fetch failed:', error);
      // Optional: Return a custom offline response if the network fails.
      return new Response(
        'Network error. Please check your connection.', 
        { status: 503, statusText: 'Service Unavailable' }
      );
    })
  );
});