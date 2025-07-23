// public/sw.js - Network-Only Strategy with Push and Notification Click Handlers

const CACHE_NAME = 'cme-modeler-cache-v32-network-only'; // New version name to force update

// INSTALL: The service worker now installs but does not pre-cache anything.
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Install');
  // We are not caching the app shell anymore to ensure freshness on every load.
  self.skipWaiting(); // Forces the waiting service worker to become the active service worker
});

// ACTIVATE: Clean up all old caches.
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activate');
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(keyList.map((key) => {
        // Only delete caches that don't match the current CACHE_NAME.
        // If your caching strategy changes in the future, be careful with this.
        if (key !== CACHE_NAME) {
            console.log('[Service Worker] Removing old cache', key);
            return caches.delete(key);
        }
        return Promise.resolve(); // Do not delete current cache
      }));
    })
  );
  return self.clients.claim(); // Makes the current service worker control all clients immediately
});

// FETCH: Always fetch from the network.
self.addEventListener('fetch', (event) => {
  // We are bypassing the cache and going directly to the network.
  // This ensures that all resources (app files, API data) are always fresh.
  event.respondWith(
    fetch(event.request).catch((error) => {
      console.error('[Service Worker] Fetch failed:', error);
      // Optional: Return a custom offline response if the network fails.
      // This is less critical for a "network-only" strategy for a dashboard,
      // but still good practice for robustness.
      return new Response(
        '<h1>Network Error</h1><p>Please check your internet connection.</p>',
        { headers: { 'Content-Type': 'text/html' }, status: 503, statusText: 'Service Unavailable' }
      );
    })
  );
});

// --- New: Push Notification Handling ---

self.addEventListener('push', (event) => {
  console.log('[Service Worker] Push event received!', event);

  let data;
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    console.error('[Service Worker] Failed to parse push data:', e);
    data = { title: 'Notification', body: 'New update from solar dashboard.' };
  }

  const title = data.title || 'Solar Dashboard Alert';
  const options = {
    body: data.body || 'Something new happened on your solar dashboard!',
    icon: data.icon || '/icons/android-chrome-192x192.png', // Ensure this path is correct relative to root
    badge: data.badge || '/icons/android-chrome-192x192.png', // For Android badges
    vibrate: data.vibrate || [200, 100, 200], // Standard vibration pattern
    tag: data.tag, // Use a tag to replace existing notifications if desired
    data: data.data || { url: '/' } // Custom data, like a URL to open on click
  };

  // `event.waitUntil` ensures the service worker stays alive until the promise resolves,
  // preventing it from being terminated before the notification is shown.
  event.waitUntil(
    self.registration.showNotification(title, options).catch((error) => {
      console.error('[Service Worker] Error showing notification:', error);
    })
  );
});

// --- New: Notification Click Handling ---

self.addEventListener('notificationclick', (event) => {
  console.log('[Service Worker] Notification click received!', event);

  event.notification.close(); // Close the notification once clicked

  // This prevents the service worker from being terminated until the client is focused/opened
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Check if there's already an open window for the app
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          // If the app is open, focus it
          return client.focus();
        }
      }
      // If the app is not open, open a new window/tab
      // Use the URL from the notification data, or default to home
      const urlToOpen = event.notification.data.url || '/';
      return clients.openWindow(urlToOpen);
    })
  );
});