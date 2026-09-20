/**
 * Spot The Aurora — Browser Service Worker
 * Handles Web Push notifications and notification click events.
 * @version 2.2.0
 *
 * The icon now comes from the push payload when the worker sends one, so the
 * category manifest in the app is the single place an icon is chosen. The map
 * below is the fallback for payloads sent before that change.
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
  'shock-ff':          '/icons/icon-shock-detection.png',
  'shock-sf':          '/icons/icon-shock-detection.png',
  'shock-fr':          '/icons/icon-shock-detection.png',
  'shock-sr':          '/icons/icon-shock-detection.png',
  'shock-imf':         '/icons/icon-shock-detection.png',
  'aurora-40percent':  '/icons/icon_aurora.png',
  'aurora-50percent':  '/icons/icon_aurora.png',
  'aurora-60percent':  '/icons/icon_aurora.png',
  'aurora-80percent':  '/icons/icon_aurora.png',
  'substorm-forecast': '/icons/icon-substorm.png',
  'admin-broadcast':   '/icons/icon-default.png',
};

// The small status-bar icon, per topic. Android masks these to a silhouette
// and discards colour, so they are drawn as bold white glyphs rather than
// being the colour artwork shrunk down.
const TOPIC_BADGES = {
  'visibility-dslr':   '/icons/icon-badge-dslr.png',
  'visibility-phone':  '/icons/icon-badge-phone.png',
  'visibility-naked':  '/icons/icon-badge-naked.png',
  'overnight-watch':   '/icons/icon-badge-moon.png',
  'flare-event':       '/icons/icon-badge-flare.png',
  'flare-peak':        '/icons/icon-badge-flare.png',
  'flare-M1':          '/icons/icon-badge-flare.png',
  'flare-M5':          '/icons/icon-badge-flare.png',
  'flare-X1':          '/icons/icon-badge-flare.png',
  'flare-X5':          '/icons/icon-badge-flare.png',
  'flare-X10':         '/icons/icon-badge-flare.png',
  'shock-ff':          '/icons/icon-badge-shock.png',
  'shock-sf':          '/icons/icon-badge-shock.png',
  'shock-fr':          '/icons/icon-badge-shock.png',
  'shock-sr':          '/icons/icon-badge-shock.png',
  'shock-imf':         '/icons/icon-badge-shock.png',
  'substorm-forecast': '/icons/icon-badge-shock.png',
};

const DEFAULT_ICON  = '/icons/icon-default.png';
// The badge is the small mark Android draws in the status bar. It is masked to
// a silhouette and its colour is discarded, so a full-colour icon comes out as
// a solid blob - which is what using DEFAULT_ICON here did.
const DEFAULT_BADGE = '/icons/icon-badge.png';

function getIcon(tag) {
  return lookup(TOPIC_ICONS, tag, DEFAULT_ICON);
}

/**
 * The status-bar glyph for a topic.
 *
 * Looked up here as well as being sent by the server, because the two paths
 * that skip the server's stamping - a test push, and any older payload - would
 * otherwise all fall back to the app mark, which is the same silhouette for
 * every alert and tells you nothing about which one arrived.
 */
function getBadge(tag) {
  return lookup(TOPIC_BADGES, tag, DEFAULT_BADGE);
}

function lookup(map, tag, fallback) {
  if (!tag) return fallback;
  // Handle tags like "test-visibility-dslr-1234567" — extract the topic
  for (const topic of Object.keys(map)) {
    if (tag === topic || tag.startsWith(`test-${topic}`)) return map[topic];
  }
  return fallback;
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
  // Prefer what the server sent. It is generated from the category manifest,
  // so an icon changed there takes effect without this file being touched.
  const icon  = data.icon  || data.data?.icon  || getIcon(tag);
  const badge = data.badge || data.data?.badge || getBadge(tag);
  const title = data.title || 'Spot The Aurora';
  const ts    = data.ts || Date.now();

  const options = {
    body:               data.body || '',
    icon,
    badge,
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