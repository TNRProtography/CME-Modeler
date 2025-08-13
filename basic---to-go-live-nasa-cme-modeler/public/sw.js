// --- START OF FILE public/sw.js ---

const CACHE_NAME = 'cme-modeler-cache-v35';

// Only use the Workers API endpoint (returns JSON). We add ?ts= to bust any cache.
// If you have a custom domain API, add it to this list too.
const ALERT_ENDPOINTS = [
  'https://spottheaurora.thenamesrock.workers.dev/get-latest-alert',
];

const GENERIC_BODY = 'New activity detected. Open the app for details.';
const NOTIF_TAG = 'spot-the-aurora-alert';

// Backoff schedule (ms): total ~15s, 6 fetches max per push per device
const RETRY_DELAYS = [0, 500, 1000, 2000, 4000, 8000];

self.addEventListener('install', (event) => {
  console.log('SW DIAGNOSTIC: Install -> skipWaiting');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('SW DIAGNOSTIC: Activate -> claim & clean caches');
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : Promise.resolve())));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request).catch(() =>
      new Response('<h1>Network Error</h1><p>Please check your internet connection.</p>', {
        headers: { 'Content-Type': 'text/html' }, status: 503, statusText: 'Service Unavailable'
      })
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
      tag: NOTIF_TAG,
      renotify: false,
      data: { url: '/' },
    };

    // Close any prior generic one so the new one replaces cleanly across platforms
    try {
      const existing = await self.registration.getNotifications({ tag: NOTIF_TAG });
      existing.forEach(n => n.close());
    } catch (_) {}

    await self.registration.showNotification(title, options);
  };

  const fetchLatestAlertOnce = async () => {
    for (const base of ALERT_ENDPOINTS) {
      const url = `${base}?ts=${Date.now()}&rnd=${Math.random().toString(36).slice(2)}`; // cache-bust
      try {
        const res = await fetch(url, { mode: 'cors', cache: 'no-store' });
        if (!res.ok) {
          console.warn('SW DIAGNOSTIC: Alert fetch not OK', url, res.status);
          continue;
        }
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('application/json')) {
          console.warn('SW DIAGNOSTIC: Alert fetch non-JSON content-type', ct);
          continue;
        }
        const data = await res.json();
        console.log('SW DIAGNOSTIC: Loaded alert payload', data?.ts || null, data?.nonce || null);
        return data;
      } catch (err) {
        console.warn('SW DIAGNOSTIC: Alert fetch failed', url, err && (err.name || err.message));
      }
    }
    return null;
  };

  const run = (async () => {
    try {
      // If a payload is ever sent directly, support it
      if (event.data) {
        console.log('SW DIAGNOSTIC: Push included data payload.');
        try {
          const json = event.data.json();
          await show(json);
          return;
        } catch {
          const text = await event.data.text().catch(() => '');
          await show({ title: 'Spot The Aurora', body: text || GENERIC_BODY });
          return;
        }
      }

      // No payload: fetch with backoff and replace-in-place
      let usedReal = false;
      for (let i = 0; i < RETRY_DELAYS.length; i++) {
        if (i > 0) await new Promise(r => setTimeout(r, RETRY_DELAYS[i]));
        const data = await fetchLatestAlertOnce();

        if (data) {
          await show(data);
          if (data.body && data.body !== GENERIC_BODY) {
            usedReal = true;
            break;
          }
          // first iteration shows generic; keep looping to replace later
        } else if (i === 0) {
          // show generic immediately on first failure, then try to upgrade later
          await show(null);
        }
      }

      if (!usedReal) {
        console.warn('SW DIAGNOSTIC: Could not fetch non-generic payload within retry window; user sees generic.');
      }
    } catch (err) {
      console.error('SW DIAGNOSTIC: Fatal in push handler', err);
      await show(null);
    }
  })();

  event.waitUntil(run);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      if (client.url.startsWith(self.location.origin) && 'focus' in client) return client.focus();
    }
    if (clients.openWindow) return clients.openWindow(urlToOpen);
  })());
});

// --- END OF FILE public/sw.js ---
