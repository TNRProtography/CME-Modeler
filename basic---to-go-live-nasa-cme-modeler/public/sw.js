// --- START OF FILE public/sw.js (KV-race-resilient) ---

const CACHE_NAME = 'cme-modeler-cache-v34';

// IMPORTANT: First entry = your app origin (routes to 404 HTML on Pages — expected).
// Second entry = your Workers.dev API (CORS OK), which returns JSON.
const ALERT_ENDPOINTS = [
  '/get-latest-alert',
  'https://spottheaurora.thenamesrock.workers.dev/get-latest-alert',
];

// The generic copy your Worker returns when KV has no payload yet:
const GENERIC_BODY = 'New activity detected. Open the app for details.';
const NOTIF_TAG = 'spot-the-aurora-alert';
const RETRY_TOTAL_MS = 5000;      // total retry window
const RETRY_INTERVAL_MS = 800;    // step between retries

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

self.addEventListener('push', (event) => {
  console.log('SW DIAGNOSTIC: Push event received!');

  const show = async (payload) => {
    const title = payload?.title || 'Spot The Aurora';
    const options = {
      body: payload?.body || GENERIC_BODY,
      icon: '/icons/android-chrome-192x192.png',
      badge: '/icons/android-chrome-192x192.png',
      vibrate: [200, 100, 200],
      tag: NOTIF_TAG,      // same tag -> updates in-place
      renotify: false,
      data: { url: '/' },
    };
    await self.registration.showNotification(title, options);
  };

  const fetchLatestAlert = async () => {
    // Attempt both endpoints; ignore non-JSON/404 HTML on app origin
    for (const url of ALERT_ENDPOINTS) {
      try {
        const res = await fetch(url, { mode: 'cors' });
        if (!res.ok) {
          console.warn('SW DIAGNOSTIC: Alert fetch not OK', url, res.status);
          continue;
        }
        // Pages /get-latest-alert returns HTML -> .json() will throw SyntaxError (expected)
        const data = await res.json();
        console.log('SW DIAGNOSTIC: Loaded alert payload from', url);
        return data;
      } catch (err) {
        console.warn('SW DIAGNOSTIC: Alert fetch failed', url, err && (err.name || err.message));
      }
    }
    return null;
  };

  const retryUntilRealPayload = async () => {
    const deadline = Date.now() + RETRY_TOTAL_MS;
    while (Date.now() < deadline) {
      const data = await fetchLatestAlert();
      if (data && data.body && data.body !== GENERIC_BODY) {
        console.log('SW DIAGNOSTIC: Got real payload after retry; updating notification.');
        await show(data); // same tag => replaces generic
        return true;
      }
      await new Promise((r) => setTimeout(r, RETRY_INTERVAL_MS));
    }
    return false;
  };

  const handlePush = (async () => {
    try {
      if (event.data) {
        // You don't send payloads today, but this supports them if you add it later
        console.log('SW DIAGNOSTIC: Push included data payload.');
        let payload = null;
        try { payload = event.data.json(); } catch { payload = { body: await event.data.text() }; }
        await show(payload);
        return;
      }

      // No payload -> first fetch attempt
      console.warn('SW DIAGNOSTIC: Push had no payload. Fetching latest alert...');
      const data = await fetchLatestAlert();

      if (data) {
        await show(data);
        // If we only got the generic body, start a short retry loop to replace it
        if (!data.body || data.body === GENERIC_BODY) {
          console.warn('SW DIAGNOSTIC: Got generic payload; retrying briefly to beat KV propagation…');
          await retryUntilRealPayload();
        }
      } else {
        console.error('SW DIAGNOSTIC: Could not fetch latest alert. Showing generic fallback.');
        await show(null);
        await retryUntilRealPayload();
      }
    } catch (err) {
      console.error('SW DIAGNOSTIC: Error in push handler:', err);
      await show(null);
      await retryUntilRealPayload();
    }
  })();

  event.waitUntil(handlePush);
});

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
