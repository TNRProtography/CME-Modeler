// --- START OF FILE public/sw.js ---

// MODIFIED: Renamed the main cache and added a new dedicated cache for static assets
const APP_CACHE_NAME = 'cme-modeler-app-cache-v39'; // Incremented version
const STATIC_ASSETS_CACHE_NAME = 'static-assets-cache-v1';

// MODIFIED: Added a list of static assets to cache on install
const STATIC_ASSETS_TO_CACHE = [
  '/background-aurora.jpg',
  '/background-solar.jpg',
  'https://upload.wikimedia.org/wikipedia/commons/6/60/ESO_-_Milky_Way.jpg'
];

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

// MODIFIED: The install event now pre-caches the static background images.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_ASSETS_CACHE_NAME).then((cache) => {
      console.log('Service Worker: Pre-caching static assets.');
      // Use addAll with a catch to prevent a single failed image from breaking the entire SW install
      return cache.addAll(STATIC_ASSETS_TO_CACHE).catch(error => {
        console.error('Service Worker: Failed to cache one or more static assets during install.', error);
      });
    }).then(() => {
      return self.skipWaiting();
    })
  );
});

// MODIFIED: The activate event now correctly manages multiple caches.
self.addEventListener('activate', (event) => {
  const allowedCaches = [APP_CACHE_NAME, STATIC_ASSETS_CACHE_NAME];
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames.map(cacheName => {
        if (!allowedCaches.includes(cacheName)) {
          console.log('Service Worker: Deleting old cache:', cacheName);
          return caches.delete(cacheName);
        }
      })
    );
    await self.clients.claim();
  })());
});

// MODIFIED: The fetch event now uses a cache-first strategy for static images
// and a network-only strategy for everything else.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Check if the request is for one of our static, cacheable assets
  if (STATIC_ASSETS_TO_CACHE.includes(url.pathname) || STATIC_ASSETS_TO_CACHE.includes(url.href)) {
    event.respondWith(
      caches.open(STATIC_ASSETS_CACHE_NAME).then(cache => {
        return cache.match(event.request).then(cachedResponse => {
          // Return from cache if found
          if (cachedResponse) {
            return cachedResponse;
          }
          // Otherwise, fetch from network, cache it, and return the response
          return fetch(event.request).then(networkResponse => {
            cache.put(event.request, networkResponse.clone());
            return networkResponse;
          });
        });
      })
    );
    return; // End execution for this request
  }

  // For all other requests, use the original network-only strategy
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