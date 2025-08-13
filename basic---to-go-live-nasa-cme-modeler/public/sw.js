// --- START OF FILE public/sw.js (Corrected, Browser-Side Code) ---

const CACHE_NAME = 'cme-modeler-cache-v32-network-only';

self.addEventListener('install', (event) => {
  console.log('SW: Install event fired. Forcing activation.');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('SW: Activate event fired. Claiming clients.');
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(key => {
      if (key !== CACHE_NAME) return caches.delete(key);
    })))
  );
  return self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request).catch(() => new Response(
      '<h1>Network Error</h1><p>Please check your internet connection.</p>',
      { headers: { 'Content-Type': 'text/html' }, status: 503, statusText: 'Service Unavailable' }
    ))
  );
});

self.addEventListener('push', (event) => {
  console.log('SW: Push event received (wake-up call).');

  const promiseChain = (async () => {
    try {
      // 1. Call back to the worker to get the latest alert details.
      const response = await fetch('/get-latest-alert');
      const data = await response.json();
      
      const title = data.title || 'Spot The Aurora';
      const options = {
        body: data.body || 'New activity detected. Open the app for details.',
        icon: '/icons/android-chrome-192x192.png',
        badge: '/icons/android-chrome-192x192.png',
        vibrate: [200, 100, 200],
        tag: 'spot-the-aurora-alert',
        data: { url: '/' },
      };

      // 2. Show the notification with the fetched data.
      await self.registration.showNotification(title, options);

    } catch (err) {
      console.error('SW: Error during push handler:', err);
      // Fallback notification if the fetch fails
      await self.registration.showNotification('Spot The Aurora', {
        body: 'New activity detected. Open the app for details.',
        icon: '/icons/android-chrome-192x192.png',
      });
    }
  })();

  event.waitUntil(promiseChain);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = (event.notification.data && event.notification.data.url) || '/';
  
  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      if (client.url.startsWith(self.location.origin) && 'focus' in client) {
        return await client.focus();
      }
    }
    if (clients.openWindow) {
      return await clients.openWindow(urlToOpen);
    }
  })());
});