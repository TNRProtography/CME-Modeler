// --- START OF FILE public/sw.js (Robust "no-payload" push handler) ---

const CACHE_NAME = 'cme-modeler-cache-v33';
/**
 * IMPORTANT:
 *  - First entry uses your app origin (Pages). Only works if that path is routed to your Worker.
 *  - Second entry is your Workers.dev API as a fallback (must send CORS headers, which your worker does).
 *  - If your Worker uses a custom domain, add it here too.
 */
const ALERT_ENDPOINTS = [
  '/get-latest-alert',
  'https://spottheaurora.thenamesrock.workers.dev/get-latest-alert',
];

// Force activate newly installed SW immediately
self.addEventListener('install', (event) => {
  console.log('SW DIAGNOSTIC: Install -> skipWaiting');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('SW DIAGNOSTIC: Activate -> claim clients & clean old caches');
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : Promise.resolve())));
    await self.clients.claim();
  })());
});

// Network-only fetch (you can tweak if you want caching later)
self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request).catch(() =>
      new Response(
        '<h1>Network Error</h1><p>Please check your internet connection.</p>',
        { headers: { 'Content-Type': 'text/html' }, status: 503, statusText: 'Service Unavailable' }
      )
    )
  );
});

// ---- PUSH HANDLER ----
self.addEventListener('push', (event) => {
  console.log('SW DIAGNOSTIC: Push event received!');

  const show = async (payload) => {
    const title = payload?.title || 'Spot The Aurora';
    const options = {
      body: payload?.body || 'New activity detected. Open the app for details.',
      icon: '/icons/android-chrome-192x192.png',
      badge: '/icons/android-chrome-192x192.png',
      vibrate: [200, 100, 200],
      tag: 'spot-the-aurora-alert',
      data: { url: '/' },
    };
    await self.registration.showNotification(title, options);
  };

  const fetchLatestAlert = async () => {
    // Abort after 4s total so we still show something
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    try {
      let data = null;
      for (const url of ALERT_ENDPOINTS) {
        try {
          const res = await fetch(url, { mode: 'cors', signal: controller.signal });
          if (res.ok) {
            data = await res.json();
            console.log('SW DIAGNOSTIC: Loaded alert payload from', url);
            break;
          } else {
            console.warn('SW DIAGNOSTIC: Alert fetch not OK', url, res.status);
          }
        } catch (err) {
          console.warn('SW DIAGNOSTIC: Alert fetch failed', url, err && (err.name || err.message));
        }
      }
      return data;
    } finally {
      clearTimeout(timeout);
    }
  };

  const handlePush = (async () => {
    try {
      // Case 1: Encrypted payload (not your current server path, but we support it anyway)
      if (event.data) {
        console.log('SW DIAGNOSTIC: Push included data payload.');
        let payload = null;
        try {
          payload = event.data.json();
        } catch {
          try { payload = { body: event.data.text() }; } catch {}
        }
        await show(payload);
        return;
      }

      // Case 2: No payload -> fetch from server
      console.warn('SW DIAGNOSTIC: Push had no payload. Fetching latest alert...');
      const data = await fetchLatestAlert();
      if (data) {
        await show(data);
      } else {
        console.error('SW DIAGNOSTIC: Could not fetch latest alert. Showing generic fallback.');
        await show(null);
      }
    } catch (err) {
      console.error('SW DIAGNOSTIC: Error in push handler:', err);
      await show(null);
    }
  })();

  event.waitUntil(handlePush);
});

// Focus/open app on click
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      if (client.url.startsWith(self.location.origin) && 'focus' in client) {
        return client.focus();
      }
    }
    if (clients.openWindow) return clients.openWindow(urlToOpen);
  })());
});

// --- END OF FILE public/sw.js ---
