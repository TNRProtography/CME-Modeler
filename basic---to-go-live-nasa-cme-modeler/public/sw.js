// public/sw.js

// Increment the version to ensure this new service worker gets installed.
const CACHE_VERSION = 'v1.4';
const APP_SHELL_CACHE_NAME = `spot-the-aurora-shell-${CACHE_VERSION}`;
const DYNAMIC_DATA_CACHE_NAME = `spot-the-aurora-data-${CACHE_VERSION}`;

// Add the paths to your background images here.
const APP_SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/background-aurora.jpg', // Example: Add your background image path
  '/background-solar.jpg',  // Example: Add your other background image path
  '/icons/android-chrome-192x192.png',
  '/icons/android-chrome-512x512.png'
];

// A list of hostnames for which we want to cache API data for 1 hour.
const DYNAMIC_HOSTNAMES = [
    'nasa-donki-api.thenamesrock.workers.dev',
    'services.swpc.noaa.gov',
    'huxt-bucket.s3.eu-west-2.amazonaws.com',
    'helioforecast.space',
    'swe.ssa.esa.int'
];

const ONE_HOUR_IN_MS = 60 * 60 * 1000;

self.addEventListener('install', (event) => {
  console.log('[SW] Install event for version:', CACHE_VERSION);
  event.waitUntil(
    caches.open(APP_SHELL_CACHE_NAME).then((cache) => {
      console.log('[SW] Caching app shell');
      return cache.addAll(APP_SHELL_URLS);
    })
  );
});

self.addEventListener('activate', (event) => {
  console.log('[SW] Activate event for version:', CACHE_VERSION);
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          // Delete all caches that are not the current app shell or data cache
          if (cacheName !== APP_SHELL_CACHE_NAME && cacheName !== DYNAMIC_DATA_CACHE_NAME) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const requestUrl = new URL(event.request.url);

  // --- STRATEGY 1: API CACHING (Cache-First, 1-Hour Expiry) ---
  if (DYNAMIC_HOSTNAMES.includes(requestUrl.hostname)) {
    event.respondWith(
      caches.open(DYNAMIC_DATA_CACHE_NAME).then(async (cache) => {
        const cachedResponse = await cache.match(event.request);
        
        if (cachedResponse) {
          const cachedTimestamp = cachedResponse.headers.get('sw-cache-timestamp');
          const isStale = cachedTimestamp && (Date.now() - Number(cachedTimestamp) > ONE_HOUR_IN_MS);
          if (!isStale) {
            // If we have a fresh response, return it immediately.
            return cachedResponse;
          }
        }

        // If the response is stale or not in the cache, fetch from the network.
        try {
          const networkResponse = await fetch(event.request);
          if (networkResponse && networkResponse.status === 200) {
            // Create a new response so we can add our custom timestamp header.
            const responseToCache = networkResponse.clone();
            const headers = new Headers(responseToCache.headers);
            headers.set('sw-cache-timestamp', Date.now().toString());

            const blob = await responseToCache.blob();
            const cacheableResponse = new Response(blob, {
              status: responseToCache.status,
              statusText: responseToCache.statusText,
              headers: headers
            });
            
            cache.put(event.request, cacheableResponse);
          }
          return networkResponse;
        } catch (error) {
          console.error('[SW] Network fetch failed for API. Returning stale data if available.', error);
          // If network fails, return the stale response as a fallback.
          return cachedResponse;
        }
      })
    );
    return;
  }
  
  // --- STRATEGY 2: APP SHELL & LOCAL ASSETS (Cache-First) ---
  if (requestUrl.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then(response => {
        return response || fetch(event.request);
      })
    );
    return;
  }

  // --- STRATEGY 3: ALL OTHER REQUESTS (Network Only) ---
  // For requests that don't match our rules (e.g., live camera images),
  // always go to the network and do not cache.
  event.respondWith(fetch(event.request));
});


// --- PUSH & MESSAGE LISTENERS (Unchanged) ---
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('push', (event) => {
  console.log('[SW] Push Received.');
  let notificationData = {};
  try {
    notificationData = event.data.json();
  } catch (e) {
    notificationData = { title: 'New Activity', body: 'Update from Spot The Aurora.', data: { url: '/' } };
  }
  const title = notificationData.title || 'Spot The Aurora';
  const options = {
    body: notificationData.body || 'New space weather event.',
    icon: '/icons/android-chrome-192x192.png',
    badge: '/icons/android-chrome-192x192.png',
    vibrate: [200, 100, 200],
    tag: notificationData.tag || 'general-notification',
    data: notificationData.data || { url: '/' },
    actions: [{ action: 'explore', title: 'Open App' }]
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = new URL(event.notification.data.url || '/', self.location.origin).href;
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === urlToOpen && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(urlToOpen);
    })
  );
});