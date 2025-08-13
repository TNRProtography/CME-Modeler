// --- START OF FILE public/sw.js ---

const CACHE_NAME = 'cme-modeler-cache-v38';

/**
 * Fallback endpoints:
 * 1) Your push-notification worker (correct one for LATEST_ALERT payloads)
 */
const FALLBACK_ENDPOINTS = [
  'https://push-notification-worker.thenamesrock.workers.dev/get-latest-alert',
];

const GENERIC_BODY = 'New activity detected. Open the app for details.';
const DEFAULT_TAG = 'spot-the-aurora-alert';
const RETRY_DELAYS = [0, 600, 1200];

// Simple helper: pick icons based on category/topic/tag
function chooseIcons(tagOrCategory) {
  const key = String(tagOrCategory || '').toLowerCase();

  // Flares
  if (key.startsWith('flare-')) {
    return {
      icon: '/icons/flare_icon192.png',
      badge: '/icons/flare_icon72.png',
    };
  }

  // Aurora forecast & substorm forecast use aurora icon set
  if (key.startsWith('aurora-') || key === 'substorm-forecast') {
    return {
      icon: '/icons/aurora_icon192.png',
      badge: '/icons/aurora_icon72.png',
    };
  }

  // Default app icons (same as before)
  return {
    icon: '/icons/android-chrome-192x192.png',
    badge: '/icons/android-chrome-192x192.png',
  };
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k !== CACHE_NAME ? caches.delete(k) : Promise.resolve())));
    await self.clients.claim();
  })());
});

// Network-only app fetch (unchanged behavior)
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
  const show = async (payload) => {
    const title = payload?.title || 'Spot The Aurora';

    // Accept category/tag from payload for better grouping/stacking
    const tagFromPayload =
      (payload && (payload.tag || payload.category || payload.topic)) || DEFAULT_TAG;

    // Choose icons based on the resolved category/tag/topic
    const { icon, badge } = chooseIcons(tagFromPayload);

    const options = {
      body: payload?.body || GENERIC_BODY,
      icon,
      badge,
      vibrate: [200, 100, 200],
      tag: String(tagFromPayload),
      renotify: false,
      // Keep a suggested URL (can be overridden by payload.data.url)
      data: { url: (payload && payload.data && payload.data.url) || '/' },
    };

    try {
      // Close any existing notification with the same tag (prevents stacking spam if desired)
      const existing = await self.registration.getNotifications({ tag: options.tag });
      existing.forEach(n => n.close());
    } catch {}
    await self.registration.showNotification(title, options);
  };

  const run = (async () => {
    try {
      // 1) Prefer encrypted payload (common path)
      if (event.data) {
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

      // 2) No payload: fallback fetch with small retry window
      for (let i = 0; i < RETRY_DELAYS.length; i++) {
        if (i > 0) await new Promise(r => setTimeout(r, RETRY_DELAYS[i]));
        for (const base of FALLBACK_ENDPOINTS) {
          const url = `${base}?ts=${Date.now()}&rnd=${Math.random().toString(36).slice(2)}`;
          try {
            const res = await fetch(url, { mode: 'cors', cache: 'no-store' });
            if (!res.ok) continue;
            const ct = (res.headers.get('content-type') || '').toLowerCase();
            if (!ct.includes('application/json')) continue;
            const data = await res.json();
            await show(data);
            return;
          } catch {}
        }
      }

      // 3) Final generic fallback
      await show(null);
    } catch {
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
