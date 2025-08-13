// --- START OF FILE public/sw.js ---
// Network-only + Push handlers (Updated for server-sent payloads)

const CACHE_NAME = 'cme-modeler-cache-v32-network-only';

self.addEventListener('install', (event) => {
  // skipWaiting forces the new service worker to activate immediately.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Clean up old caches.
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(key => {
      if (key !== CACHE_NAME) return caches.delete(key);
    })))
  );
  // claim() ensures that the new service worker takes control of the page immediately.
  return self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Network-only strategy: Always go to the network.
  // This is good for an app that needs the absolute latest data.
  event.respondWith(
    fetch(event.request).catch(() => new Response(
      '<h1>Network Error</h1><p>Please check your internet connection.</p>',
      { headers: { 'Content-Type': 'text/html' }, status: 503, statusText: 'Service Unavailable' }
    ))
  );
});

// ---- Push notifications ----
// --- CRITICAL FIX: Rewritten to handle asynchronous data parsing correctly ---
self.addEventListener('push', (event) => {
  if (!event.data) {
    console.error('Push event received but no data was sent.');
    return;
  }

  // The event.data.json() method returns a Promise. We must handle it asynchronously.
  // The entire operation needs to be wrapped in event.waitUntil to ensure the
  // service worker stays alive long enough to parse the data AND show the notification.
  const promiseChain = event.data.json().then(data => {
    const title = data.title || 'Spot The Aurora'; // A safe fallback title
    const options = {
      body: data.body || 'You have a new alert. Tap to see the latest updates.', // A safe fallback body
      icon: '/icons/android-chrome-192x192.png',
      badge: '/icons/android-chrome-192x192.png',
      vibrate: [200, 100, 200],
      tag: 'spot-the-aurora-alert', // A general tag to allow new notifications to replace old ones.
      data: {
        url: '/', // The URL to open when the notification is clicked.
      },
    };

    // Show the notification after the data has been parsed.
    return self.registration.showNotification(title, options);
  });

  // Tell the browser to wait until our promise chain is complete.
  event.waitUntil(promiseChain);
});


// ---- Click -> focus/open app ----
// --- UNCHANGED: This logic is still correct and robust ---
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = (event.notification.data && event.notification.data.url) || '/';
  
  event.waitUntil((async () => {
    // Get a list of all open windows/tabs controlled by this service worker.
    const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    
    // Check if there's an existing window open for the app.
    for (const client of allClients) {
      if (client.url.startsWith(self.location.origin) && 'focus' in client) {
        // If a window is found, bring it into focus.
        return await client.focus();
      }
    }
    
    // If no window is found, open a new one.
    if (clients.openWindow) {
      return await clients.openWindow(urlToOpen);
    }
  })());
});
// --- END OF FILE public/sw.js ---