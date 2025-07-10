// sw.js
const CACHE_NAME = 'cme-modeler-cache-v4'; // IMPORTANT: We've incremented the version number again.
const urlsToCache = [
  '/', // The root of the site
  '/index.html',
  '/manifest.json',
  '/favicon.ico',
  '/forecast.html',
  // Add paths to your main icons
  '/icons/android-chrome-192x192.png',
  '/icons/android-chrome-512x512.png',
];

// The install event fires when the service worker is first installed.
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Install');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Caching all: app shell and content');
      return cache.addAll(urlsToCache);
    })
  );
  self.skipWaiting();
});

// The activate event fires after install. It's a good place to clean up old caches.
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

// The fetch event fires for every network request the page makes.
// This is what enables offline functionality. It MUST exist.
self.addEventListener('fetch', (event) => {
  // We only want to cache GET requests.
  if (event.request.method !== 'GET') {
    return;
  }
  
  event.respondWith(
    caches.match(event.request).then((response) => {
      // If the request is in the cache, return it. Otherwise, fetch from the network.
      return response || fetch(event.request);
    })
  );
});