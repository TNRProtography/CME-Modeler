// --- START OF FILE public/sw.js ---

const CACHE_NAME = 'cme-modeler-cache-v37';
const FALLBACK_ENDPOINTS = [
  // Legacy fallback only; most pushes now include the full payload
  'https://spottheaurora.thenamesrock.workers.dev/get-latest-alert',
];

const GENERIC_BODY = 'New activity detected. Open the app for details.';

// Category tags (used by Chrome/Android for grouping)
const TAGS = {
  general:  'sta-general',
  aurora:   'sta-aurora',
  flare:    'sta-flare',
  substorm: 'sta-substorm',
};

const RETRY_DELAYS = [0, 600, 1200];

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

    // Infer category from payload.category or payload.topic
    const rawCat = (payload?.category || (payload?.topic ? inferCategoryFromTopic(payload.topic) : '') || 'general');
    const category = (['general','aurora','flare','substorm'].includes(rawCat) ? rawCat : 'general');

    const options = {
      body: payload?.body || GENERIC_BODY,
      icon: '/icons/android-chrome-192x192.png',
      badge: '/icons/android-chrome-192x192.png',
      vibrate: [200, 100, 200],
      // Use category tag so Android groups them separately
      tag: TAGS[category] || TAGS.general,
      renotify: false,
      timestamp: Date.now(),
      data: {
        url: '/',
        category,
        topic: payload?.topic || undefined,
      },
      // (Optional) You could add category-specific actions later
      // actions: [{ action:'open', title:'Open' }],
    };

    // De-duplicate by tag (close existing)
    try {
      const existing = await self.registration.getNotifications({ tag: options.tag });
      existing.forEach(n => n.close());
    } catch {}

    await self.registration.showNotification(title, options);
  };

  const run = (async () => {
    try {
      // 1) Prefer encrypted payload (now standard)
      if (event.data) {
        try {
          const json = event.data.json();
          await show(json);
          return;
        } catch {
          const text = await event.data.text().catch(() => '');
          await show({ title: 'Spot The Aurora', body: text || GENERIC_BODY, category: 'general' });
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

      // 3) Fallback generic if absolutely nothing else worked
      await show(null);
    } catch (err) {
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

// ---- helpers ----
function inferCategoryFromTopic(topic) {
  if (!topic) return 'general';
  if (topic.startsWith('flare-')) return 'flare';
  if (topic.startsWith('aurora-')) return 'aurora';
  if (topic === 'substorm-forecast') return 'substorm';
  return 'general';
}

// --- END OF FILE public/sw.js ---
