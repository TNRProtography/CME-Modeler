// --- START OF FILE public/sw.js (with Deep Diagnostics) ---

const CACHE_NAME = 'cme-modeler-cache-v32-network-only';

self.addEventListener('install', (event) => {
  console.log('SW DIAGNOSTIC: Install event fired. Forcing activation.');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('SW DIAGNOSTIC: Activate event fired. Claiming clients.');
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

// ---- Push notifications ----
self.addEventListener('push', (event) => {
  console.log('SW DIAGNOSTIC: Push event received!');

  if (!event.data) {
    console.error('SW DIAGNOSTIC: Push event had no data. Cannot show notification.');
    return;
  }

  // --- CRITICAL DIAGNOSTIC STEP: Log the raw data first ---
  const payloadText = event.data.text();
  console.log('SW DIAGNOSTIC: Raw payload text received:', payloadText);

  const promiseChain = (async () => {
    try {
      const data = JSON.parse(payloadText);
      console.log('SW DIAGNOSTIC: Payload parsed successfully:', data);

      const title = data.title || 'Spot The Aurora';
      const options = {
        body: data.body || 'You have a new alert. Tap to see the latest updates.',
        icon: '/icons/android-chrome-192x192.png',
        badge: '/icons/android-chrome-192x192.png',
        vibrate: [200, 100, 200],
        tag: 'spot-the-aurora-alert',
        data: { url: '/' },
      };

      console.log('SW DIAGNOSTIC: Attempting to show notification with title:', title);
      await self.registration.showNotification(title, options);
      console.log('SW DIAGNOSTIC: showNotification command issued successfully.');

    } catch (err) {
      console.error('SW DIAGNOSTIC: CRITICAL ERROR in push handler:', err);
      // As a fallback, show a generic error notification
      await self.registration.showNotification('Notification Error', {
        body: 'Could not parse incoming alert. Check the console for details.',
        icon: '/icons/android-chrome-192x192.png',
      });
    }
  })();

  event.waitUntil(promiseChain);
});


// ---- Click -> focus/open app ----
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