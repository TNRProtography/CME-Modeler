/**
 * Spot The Aurora — Browser Service Worker
 * Handles Web Push notifications and notification click events.
 * @version 2.5.1
 *
 * The icon now comes from the push payload when the worker sends one, so the
 * category manifest in the app is the single place an icon is chosen. The map
 * below is the fallback for payloads sent before that change.
 *
 * Deliberately has no `fetch` handler and stores nothing in Cache Storage. An
 * earlier version of this file served navigations cache-first, which is how a
 * stale build could pin itself on a device for as long as the cache survived.
 * Without a fetch handler there is nothing for an old copy of the app to be
 * served *from*: the network and the CDN decide what the page is, the same as
 * on a browser with no service worker at all. Do not add caching here without
 * a versioned cache name and a matching cleanup in `activate`.
 */

// Bumped on every change to this file. The byte-compare the browser does on
// /sw.js is what actually triggers an update, so this is not load-bearing - it
// exists so a device can be asked what it is running, and so a version stuck in
// the field is a fact somebody can read rather than a theory.
const SW_VERSION = '2.5.1';

// Maps notification topic/tag to a specific icon
const TOPIC_ICONS = {
  'visibility-dslr':   '/icons/notifications/icon-visibility-dslr.png',
  'visibility-phone':  '/icons/notifications/icon-visibility-phone.png',
  'visibility-naked':  '/icons/notifications/icon-visibility-naked.png',
  'overnight-watch':   '/icons/notifications/icon-overnight-watch.png',
  'flare-event':       '/icons/notifications/icon-flare-M1.png',
  'flare-peak':        '/icons/notifications/icon-flare-peak.png',
  'flare-M1':          '/icons/notifications/icon-flare-M1.png',
  'flare-M5':          '/icons/notifications/icon-flare-M5.png',
  'flare-X1':          '/icons/notifications/icon-flare-X1.png',
  'flare-X5':          '/icons/notifications/icon-flare-X5.png',
  'flare-X10':         '/icons/notifications/icon-flare-X10.png',
  'cme-earth-directed':'/icons/notifications/icon-cme-earth-directed.png',
  'shock-ff':          '/icons/notifications/icon-shock-ff.png',
  'shock-sf':          '/icons/notifications/icon-shock-sf.png',
  'shock-fr':          '/icons/notifications/icon-shock-fr.png',
  'shock-sr':          '/icons/notifications/icon-shock-sr.png',
  'shock-imf':         '/icons/notifications/icon-shock-imf.png',
  'aurora-40percent':  '/icons/icon_aurora.png',
  'aurora-50percent':  '/icons/icon_aurora.png',
  'aurora-60percent':  '/icons/icon_aurora.png',
  'aurora-80percent':  '/icons/icon_aurora.png',
  'substorm-forecast': '/icons/notifications/icon-substorm-watch.png',
  'substorm-watch':    '/icons/notifications/icon-substorm-watch.png',
  'substorm-likely':   '/icons/notifications/icon-substorm-likely.png',
  'substorm-imminent': '/icons/notifications/icon-substorm-imminent.png',
  'substorm-onset':    '/icons/notifications/icon-substorm-onset.png',
  'admin-broadcast':   '/icons/notifications/icon-admin-broadcast.png',
};

// The small status-bar icon, per topic. Android masks these to a silhouette
// and discards colour, so they are drawn as bold white glyphs rather than
// being the colour artwork shrunk down.
const TOPIC_BADGES = {
  'visibility-dslr':   '/icons/notifications/icon-badge-visibility-dslr.png',
  'visibility-phone':  '/icons/notifications/icon-badge-visibility-phone.png',
  'visibility-naked':  '/icons/notifications/icon-badge-visibility-naked.png',
  'overnight-watch':   '/icons/notifications/icon-badge-overnight-watch.png',
  'flare-event':       '/icons/notifications/icon-badge-flare-M1.png',
  'flare-peak':        '/icons/notifications/icon-badge-flare-peak.png',
  'flare-M1':          '/icons/notifications/icon-badge-flare-M1.png',
  'flare-M5':          '/icons/notifications/icon-badge-flare-M5.png',
  'flare-X1':          '/icons/notifications/icon-badge-flare-X1.png',
  'flare-X5':          '/icons/notifications/icon-badge-flare-X5.png',
  'flare-X10':         '/icons/notifications/icon-badge-flare-X10.png',
  'cme-earth-directed':'/icons/notifications/icon-badge-cme-earth-directed.png',
  'shock-ff':          '/icons/notifications/icon-badge-shock-ff.png',
  'shock-sf':          '/icons/notifications/icon-badge-shock-sf.png',
  'shock-fr':          '/icons/notifications/icon-badge-shock-fr.png',
  'shock-sr':          '/icons/notifications/icon-badge-shock-sr.png',
  'shock-imf':         '/icons/notifications/icon-badge-shock-imf.png',
  'substorm-forecast': '/icons/notifications/icon-badge-substorm-watch.png',
  'substorm-watch':    '/icons/notifications/icon-badge-substorm-watch.png',
  'substorm-likely':   '/icons/notifications/icon-badge-substorm-likely.png',
  'substorm-imminent': '/icons/notifications/icon-badge-substorm-imminent.png',
  'substorm-onset':    '/icons/notifications/icon-badge-substorm-onset.png',
  'admin-broadcast':   '/icons/notifications/icon-badge-admin-broadcast.png',
};

const DEFAULT_ICON  = '/icons/icon-default.png';
// The badge is the small mark Android draws in the status bar. It is masked to
// a silhouette and its colour is discarded, so a full-colour icon comes out as
// a solid blob - which is what using DEFAULT_ICON here did.
const DEFAULT_BADGE = '/icons/notifications/icon-badge.png';

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
  // The longest topic that fits wins: "test-flare-X10-1" starts with
  // "test-flare-X1" too, and was getting the X1 icon.
  let best = null;
  for (const topic of Object.keys(map)) {
    if ((tag === topic || tag.startsWith(`test-${topic}`)) && (best === null || topic.length > best.length)) best = topic;
  }
  return best === null ? fallback : map[best];
}

// ── lifecycle ────────────────────────────────────────────────────────────────
// The rule this file follows: a new version takes over immediately and an old
// one is never left running. `skipWaiting` means a new worker does not sit in
// `waiting` behind a tab that has been open for a week, and `clients.claim`
// means it controls the pages that are already open rather than only the next
// ones. Together they close the gap where an update had downloaded and
// installed but nothing on the device was using it yet.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Delete every Cache Storage entry. Nothing here writes one, so anything
    // present was left by an older version of this file, and an orphaned cache
    // is exactly the thing that used to serve a months-old index.html. Clearing
    // it on activate means the first load after this version lands also
    // permanently undoes the last one that cached.
    try {
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n)));
      if (names.length) console.log('[SW] Cleared stale caches:', names.join(', '));
    } catch (err) {
      console.warn('[SW] Could not clear caches:', err);
    }

    await self.clients.claim();

    // Tell whatever is open which version now controls it. The app logs this,
    // so a device running something unexpected shows up in the debug panel
    // rather than only in somebody's description of what went wrong.
    const all = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
    for (const client of all) {
      client.postMessage({ type: 'SW_ACTIVATED', version: SW_VERSION });
    }
  })());
});

self.addEventListener('message', (event) => {
  const type = event.data?.type;
  // Belt and braces: if a future version ever stops calling skipWaiting on
  // install, the page can still push a waiting worker through rather than
  // leaving it stranded until every tab closes.
  if (type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (type === 'GET_VERSION') {
    const reply = { type: 'SW_VERSION', version: SW_VERSION };
    if (event.ports?.[0]) event.ports[0].postMessage(reply);
    else event.source?.postMessage(reply);
  }
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