// public/sw.js

// This version string is crucial. Any change to this file, especially this version,
// will trigger the service worker update process.
const CACHE_VERSION = 'v1.2'; // Incremented version to ensure updates
const CACHE_NAME = `spot-the-aurora-cache-${CACHE_VERSION}`;

// A list of essential files to be cached when the service worker is installed.
const APP_SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/android-chrome-192x192.png',
  '/icons/android-chrome-512x512.png'
];

// --- 1. INSTALLATION & CACHING LOGIC ---
self.addEventListener('install', (event) => {
  console.log('[SW] Install event');
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

// --- 2. ACTIVATION & CACHE CLEANUP LOGIC ---
self.addEventListener('activate', (event) => {
  console.log('[SW] Activate event');
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

// --- 3. FETCH (CACHING STRATEGY) LOGIC ---
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }
  if (event.request.mode === 'navigate') {
    event.respondWith(
      caches.match(event.request).then((response) => response || fetch(event.request))
    );
    return;
  }
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
});

// --- 4. AUTO-UPDATE LOGIC ---
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('[SW] Received SKIP_WAITING message. Activating new version.');
    self.skipWaiting();
  }
});

// --- 5. PUSH NOTIFICATION RECEIVING LOGIC ---
// This is the crucial part that listens for notifications from your server.
self.addEventListener('push', (event) => {
  console.log('[SW] Push Received.');

  let notificationData = {};
  try {
    // Attempt to parse the payload from the push event.
    notificationData = event.data.json();
  } catch (e) {
    console.error('[SW] Error parsing push data:', e);
    // Create a fallback notification if data is missing or malformed.
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

// This handles what happens when a user clicks the notification itself.
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification click Received.');
  event.notification.close();

  const urlToOpen = new URL(event.notification.data.url || '/', self.location.origin).href;

  event.waitUntil(
    clients.matchAll({
      type: "window",
      includeUncontrolled: true
    }).then((clientList) => {
      // If a window for the app is already open, focus it.
      for (const client of clientList) {
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise, open a new window.
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});