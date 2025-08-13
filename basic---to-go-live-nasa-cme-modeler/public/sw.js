// --- START OF FILE public/sw.js (Fixed & resilient) ---

const CACHE_NAME = 'cme-modeler-cache-v32-network-only';

// If your API runs on a different origin, add it here as a fallback:
const ALERT_ENDPOINTS = [
  '/get-latest-alert',
  'https://spottheaurora.thenamesrock.workers.dev/get-latest-alert', // <— fallback to Workers.dev API (CORS-enabled)
];

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
      // Try each endpoint until one returns OK JSON
      let data = null;
      for (const url of ALERT_ENDPOINTS) {
        try {
          const res = await fetch(url, { mode: 'cors' });
          if (res.ok) {
            data = await res.json();
            break;
          }
        } catch (_) { /* try next */ }
      }

      const title = data?.title || 'Spot The Aurora';
      const options = {
        body: data?.body || 'New activity detected. Open the app for details.',
        icon: '/icons/android-chrome-192x192.png',
        badge: '/icons/android-chrome-192x192.png',
        vibrate: [200, 100, 200],
        tag: 'spot-the-aurora-alert',
        data: { url: '/' },
      };

      await self.registration.showNotification(title, options);
    } catch (err) {
      console.error('SW: Error during push handler:', err);
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

// --- END OF FILE public/sw.js ---
