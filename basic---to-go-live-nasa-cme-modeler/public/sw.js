/**
 * Spot The Aurora — Browser Service Worker
 * Handles Web Push notifications and notification click events.
 * @version 2.0.2
 */

// Maps notification topic/tag to a specific icon
const TOPIC_ICONS = {
  'visibility-dslr':   '/icons/icon-visibility-dslr.png',
  'visibility-phone':  '/icons/icon-visibility-phone.png',
  'visibility-naked':  '/icons/icon-visibility-naked.png',
  'overnight-watch':   '/icons/icon-overnight-watch.png',
  'flare-event':       '/icons/icon-flare-event.png',
  'flare-peak':        '/icons/icon-flare-peak.png',
  'flare-M1':          '/icons/icon-flare-event.png',
  'flare-M5':          '/icons/icon-flare-event.png',
  'flare-X1':          '/icons/icon-flare-event.png',
  'flare-X5':          '/icons/icon-flare-event.png',
  'flare-X10':         '/icons/icon-flare-event.png',
  'shock-detection':   '/icons/icon-shock-detection.png',
  'cme-sheath':        '/icons/icon-cme-sheath.png',
  'ips-shock':         '/icons/icon-ips-shock.png',
  'aurora-40percent':  '/icons/icon_aurora.png',
  'aurora-50percent':  '/icons/icon_aurora.png',
  'aurora-60percent':  '/icons/icon_aurora.png',
  'aurora-80percent':  '/icons/icon_aurora.png',
  'substorm-forecast': '/icons/icon-substorm.png',
  'admin-broadcast':   '/icons/icon-default.png',
};

const DEFAULT_ICON  = '/icons/icon-default.png';
const DEFAULT_BADGE = '/icons/icon-default.png';

function getIcon(tag) {
  if (!tag) return DEFAULT_ICON;
  // Handle tags like "test-visibility-dslr-1234567" — extract the topic
  for (const topic of Object.keys(TOPIC_ICONS)) {
    if (tag === topic || tag.startsWith(`test-${topic}`)) {
      return TOPIC_ICONS[topic];
    }
  }
  return DEFAULT_ICON;
}

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

// ── IndexedDB helpers for notification history ───────────────────────────────
const DB_NAME    = 'sta-notifications';
const DB_VERSION = 1;
const STORE_NAME = 'history';
const MAX_HISTORY = 100; // keep last 100 notifications

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

async function saveNotificationToHistory(entry) {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.add(entry);
    // Prune oldest records beyond MAX_HISTORY
    const countReq = store.count();
    countReq.onsuccess = () => {
      if (countReq.result > MAX_HISTORY) {
        const cursor = store.index('timestamp').openCursor();
        let toDelete = countReq.result - MAX_HISTORY;
        cursor.onsuccess = (e) => {
          const c = e.target.result;
          if (c && toDelete > 0) {
            c.delete();
            toDelete--;
            c.continue();
          }
        };
      }
    };
    tx.oncomplete = () => db.close();
  } catch (err) {
    console.error('[SW] Failed to save notification to history:', err);
  }
}

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    console.error('[SW] Failed to parse push payload:', e);
    data = { title: 'Spot The Aurora', body: event.data?.text() || 'New alert' };
  }

  const tag   = data.tag || data.data?.category || 'sta-notification';
  const icon  = getIcon(tag);
  const title = data.title || 'Spot The Aurora';
  const ts    = data.ts || Date.now();

  const options = {
    body:               data.body || '',
    icon,
    badge:              icon,
    vibrate:            [200, 100, 200],
    tag,
    renotify:           false,
    requireInteraction: false,
    data:               data.data || { url: '/' },
    timestamp:          ts,
  };

  // Save to IndexedDB history before showing
  const historyEntry = {
    title,
    body:      data.body || '',
    tag,
    timestamp: ts,
    url:       data.data?.url || '/',
    category:  data.data?.category || tag,
    read:      false,
  };

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      saveNotificationToHistory(historyEntry),
    ])
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          if ('navigate' in client) client.navigate(targetUrl);
          return;
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});