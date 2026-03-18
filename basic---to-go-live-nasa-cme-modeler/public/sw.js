/**
 * Spot The Aurora — Browser Service Worker
 * Handles Web Push notifications and notification click events.
 * @version 2.0.1
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
  'aurora-40percent':  '/icons/icon-aurora.png',
  'aurora-50percent':  '/icons/icon-aurora.png',
  'aurora-60percent':  '/icons/icon-aurora.png',
  'aurora-80percent':  '/icons/icon-aurora.png',
  'substorm-forecast': '/icons/icon-substorm.png',
};

const DEFAULT_ICON  = '/icons/android-chrome-192x192.png';
const DEFAULT_BADGE = '/icons/icon-badge.png';

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

  const options = {
    body:               data.body || '',
    icon,
    badge:              icon,
    vibrate:            [200, 100, 200],
    tag,
    renotify:           false,
    requireInteraction: false,
    data:               data.data || { url: '/' },
    timestamp:          data.ts || Date.now(),
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
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