// --- START OF FILE public/sw.js ---

const CACHE_NAME = 'cme-modeler-cache-v32-network-only';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(key => {
        if (key !== CACHE_NAME) return caches.delete(key);
      }))
    )
  );
  return self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request).catch(() =>
      new Response('<h1>Network Error</h1><p>Please check your internet connection.</p>', {
        headers: { 'Content-Type': 'text/html' },
        status: 503,
        statusText: 'Service Unavailable'
      })
    )
  );
});

// ---- Push handler: no icon, transparent badge, no URL in payload/options ----
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch {}

  const title = data.title || '✨ Aurora Alert';
  const options = {
    body: data.body || 'Strong solar activity detected. Tap to open.',
    // No large icon to avoid gray square thumbnails
    // Use a fully transparent small badge to avoid the colored letter-circle
    badge: '/icons/notification-badge.png',
    vibrate: data.vibrate || [200, 100, 200],
    tag: data.tag, // omit or vary to stack; set stable to replace
    requireInteraction: data.requireInteraction ?? false,
    // Do NOT attach a URL into data to avoid showing anything derived from it
    // (Note: Chrome will still show site origin by design; that can't be removed.)
    data: { } 
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ---- Click always opens app root (no URL shown/stored in notification data) ----
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = '/';
  event.waitUntil((async () => {
    const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of all) {
      if (client.url.startsWith(self.location.origin) && 'focus' in client) {
        await client.focus();
        return;
      }
    }
    await clients.openWindow(urlToOpen);
  })());
});

// --- END OF FILE public/sw.js ---
