/**
 * Spot The Aurora — Browser Service Worker
 *
 * Handles incoming Web Push notifications and notification click events.
 * This file runs in the browser, NOT on Cloudflare.
 * The Cloudflare push notification worker is a separate deployment.
 */

self.addEventListener('install', (event) => {
  // Activate immediately — don't wait for old SW to finish
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Take control of all open clients immediately
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

  const title   = data.title || 'Spot The Aurora';
  const options = {
    body:             data.body || '',
    icon:             '/icons/android-chrome-192x192.png',
    badge:            '/icons/android-chrome-192x192.png',
    vibrate:          [200, 100, 200],
    tag:              data.tag || 'sta-notification',
    renotify:         false,
    requireInteraction: false,
    data:             data.data || { url: '/' },
    timestamp:        data.ts || Date.now(),
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
      // If the app is already open, focus it and navigate
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          if ('navigate' in client) client.navigate(targetUrl);
          return;
        }
      }
      // Otherwise open a new window
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});