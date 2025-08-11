// --- START OF FILE public/sw.js ---
// Network-only + Push handlers

const CACHE_NAME = 'cme-modeler-cache-v32-network-only';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
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
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch {}
  const title = data.title || '✨ Aurora Alert';
  const options = {
    body: data.body || 'Strong solar activity detected. Tap to open.',
    icon: data.icon || '/icons/android-chrome-192x192.png',
    badge: data.badge || '/icons/android-chrome-192x192.png',
    vibrate: data.vibrate || [200, 100, 200],
    tag: data.tag,
    requireInteraction: data.requireInteraction ?? false,
    data: data.data || { url: '/' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// ---- Click -> focus/open app ----
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = (event.notification.data && event.notification.data.url) || '/';
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
