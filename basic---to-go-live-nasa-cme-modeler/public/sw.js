// public/sw.js

// --- START OF MODIFICATION: Incremented version to force update ---
const CACHE_VERSION = 'v1.3';
// --- END OF MODIFICATION ---
const CACHE_NAME = `spot-the-aurora-cache-${CACHE_VERSION}`;

// A list of essential files to be cached when the service worker is installed.
const APP_SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/android-chrome-192x192.png',
  '/icons/android-chrome-512x512.png'
];

self.addEventListener('install', (event) => {
  console.log('[SW] Install event for version:', CACHE_VERSION);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching app shell');
        return cache.addAll(APP_SHELL_URLS);
      })
      .catch(error => {
        console.error('[SW] Failed to cache app shell:', error);
      })
  );
});

self.addEventListener('activate', (event) => {
  console.log('[SW] Activate event for version:', CACHE_VERSION);
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  // --- START OF MODIFICATION: Intelligent Caching Logic ---
  const requestUrl = new URL(event.request.url);

  // For requests to our own origin (the app shell and its assets), use a cache-first strategy.
  if (requestUrl.origin === self.location.origin) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) => {
        return cache.match(event.request).then((cachedResponse) => {
          const fetchPromise = fetch(event.request).then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              cache.put(event.request, networkResponse.clone());
            }
            return networkResponse;
          });
          return cachedResponse || fetchPromise;
        });
      })
    );
    return;
  }

  // For all other requests (APIs, proxies, external images), go directly to the network.
  // Do NOT cache these responses. This prevents cache bloat and ensures data is always fresh.
  event.respondWith(fetch(event.request));
  // --- END OF MODIFICATION ---
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('[SW] Received SKIP_WAITING message. Activating new version.');
    self.skipWaiting();
  }
});

self.addEventListener('push', (event) => {
  console.log('[SW] Push Received.');

  let notificationData = {};
  try {
    notificationData = event.data.json();
  } catch (e) {
    console.error('[SW] Error parsing push data:', e);
    notificationData = {
      title: 'New Activity',
      body: 'There is a new update from Spot The Aurora.',
      data: { url: '/' }
    };
  }

  const title = notificationData.title || 'Spot The Aurora';
  const options = {
    body: notificationData.body || 'New space weather event.',
    icon: '/icons/android-chrome-192x192.png',
    badge: '/icons/android-chrome-192x192.png',
    vibrate: [200, 100, 200],
    tag: notificationData.tag || 'general-notification',
    data: notificationData.data || { url: '/' },
    actions: [
        { action: 'explore', title: 'Open App' }
    ]
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification click Received.');
  event.notification.close();

  const urlToOpen = new URL(event.notification.data.url || '/', self.location.origin).href;

  event.waitUntil(
    clients.matchAll({
      type: "window",
      includeUncontrolled: true
    }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});