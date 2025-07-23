// --- START OF FILE src/utils/notifications.ts ---

// --- User Notification Preferences (localStorage) ---
const NOTIFICATION_PREF_PREFIX = 'notification_pref_';

/**
 * Gets the user's preference for a specific notification category.
 * Defaults to true if no preference is saved.
 * @param categoryId The ID of the notification category (e.g., 'aurora-50percent').
 * @returns boolean indicating if the notification is enabled.
 */
export const getNotificationPreference = (categoryId: string): boolean => {
  try {
    const storedValue = localStorage.getItem(NOTIFICATION_PREF_PREFIX + categoryId);
    // If not explicitly set (null), default to true. Otherwise, parse stored boolean.
    return storedValue === null ? true : JSON.parse(storedValue);
  } catch (e) {
    console.error(`Error reading notification preference for ${categoryId}:`, e);
    return true; // Default to true on error
  }
};

/**
 * Sets the user's preference for a specific notification category.
 * @param categoryId The ID of the notification category.
 * @param enabled Whether the notification should be enabled (true) or disabled (false).
 */
export const setNotificationPreference = (categoryId: string, enabled: boolean) => {
  try {
    localStorage.setItem(NOTIFICATION_PREF_PREFIX + categoryId, JSON.stringify(enabled));
  } catch (e) {
    console.error(`Error saving notification preference for ${categoryId}:`, e);
  }
};


// --- Core Notification Functions ---

// Function to request notification permission from the user
export const requestNotificationPermission = async (): Promise<NotificationPermission | 'unsupported'> => {
  // Check if the browser supports notifications
  if (!('Notification' in window)) {
    console.warn('Notifications are not supported by this browser.');
    return 'unsupported';
  }

  // If permission is already granted or denied, return current status
  if (Notification.permission === 'granted' || Notification.permission === 'denied') {
    return Notification.permission;
  }

  // Request permission from the user
  try {
    const permission = await Notification.requestPermission();
    return permission;
  } catch (error) {
    console.error('Error requesting notification permission:', error);
    return 'denied'; // Assume denied if an error occurs
  }
};

/**
 * Sends a test notification to the user to confirm their setup.
 */
export const sendTestNotification = (): void => {
  if (Notification.permission !== 'granted') {
    console.warn('Cannot send test notification: Permission not granted.');
    alert('Notification permission has not been granted. Please enable notifications first.');
    return;
  }

  const title = 'Test Notification';
  const options: NotificationOptions = {
    body: 'If you can see this, your notifications are working correctly!',
    // IMPORTANT: Replace with a valid path to one of your public icons.
    // The 192x192 PNG from your PWA manifest is an excellent choice.
    icon: '/logo192.png', 
    tag: 'test-notification', // Using a tag replaces any previous test notification instantly.
    renotify: true, // Makes sure the user is notified even if the tag is the same.
  };

  // Using the Service Worker registration is the most robust way to show a notification,
  // as it works even if the app tab is not in the foreground.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready.then((registration) => {
      registration.showNotification(title, options);
    }).catch(err => {
      console.error('Service Worker not ready, falling back to simple notification.', err);
      // Fallback for when SW isn't ready (e.g., during some development scenarios)
      new Notification(title, options);
    });
  } else {
      // Fallback for browsers that support notifications but not service workers
      new Notification(title, options);
  }
};


// --- Cooldown Mechanism to Prevent Notification Spam ---
const notificationCooldowns: Map<string, number> = new Map(); // Stores last notification timestamp for each tag
const DEFAULT_NOTIFICATION_COOLDOWN_MS = 30 * 60 * 1000; // Default cooldown: 30 minutes

/**
 * Checks if a notification with a given tag can be sent based on its cooldown and user preferences.
 * If it can, it updates the last sent timestamp.
 * @param tag A unique string identifier for the notification type (e.g., 'aurora-50percent', 'flare-M5').
 * @param cooldownMs The minimum time in milliseconds that must pass before sending another notification with this tag.
 * @returns true if the notification can be sent, false otherwise.
 */
export const canSendNotification = (tag: string, cooldownMs: number = DEFAULT_NOTIFICATION_COOLDOWN_MS): boolean => {
  // First, check user preference. If disabled, can't send.
  if (!getNotificationPreference(tag)) {
    console.log(`Notification for category '${tag}' is disabled by user preference.`);
    return false;
  }

  // Then, check cooldown.
  const lastSent = notificationCooldowns.get(tag) || 0;
  const now = Date.now();

  if (now - lastSent > cooldownMs) {
    notificationCooldowns.set(tag, now); // Update timestamp
    return true;
  }
  
  console.log(`Notification for category '${tag}' is on cooldown.`);
  return false;
};

/**
 * **FIX:** RESTORED a missing function.
 * Clears the cooldown for a specific notification tag.
 * Useful if conditions change significantly and you want to allow immediate re-notification.
 * @param tag The unique string identifier for the notification type.
 */
export const clearNotificationCooldown = (tag: string) => {
  notificationCooldowns.delete(tag);
};


// --- Web Push Subscription Logic (More Advanced) ---
// This part remains unchanged from what you provided, as it's for server-side push.

const VAPID_PUBLIC_KEY = 'BJFhRHKlybzXdM37Hz0Tv0chiN0mkTP9YuUe_-RWWJJnkWs-Xt1asrQ99OYf5QiUAD77hyZTxrrh0S5768lhVms'; // <-- REPLACE THIS!

const urlBase64ToUint8Array = (base64String: string): Uint8Array => {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
};

export const subscribeUserToPush = async (): Promise<PushSubscription | null> => {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('Service Workers or Push Messaging are not supported by this browser.');
    return null;
  }
  const permission = await requestNotificationPermission();
  if (permission !== 'granted') {
    console.warn('Notification permission not granted. Cannot subscribe to push.');
    return null;
  }
  try {
    const registration = await navigator.serviceWorker.ready;
    const existingSubscription = await registration.pushManager.getSubscription();
    if (existingSubscription) {
      console.log('User already has a push subscription:', existingSubscription);
      return existingSubscription;
    }
    const applicationServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
    const options = { userVisibleOnly: true, applicationServerKey: applicationServerKey };
    const subscription = await registration.pushManager.subscribe(options);
    console.log('Successfully subscribed to push:', subscription);
    await sendPushSubscriptionToServer(subscription);
    return subscription;
  } catch (error) {
    console.error('Failed to subscribe the user to push:', error);
    return null;
  }
};

const sendPushSubscriptionToServer = async (subscription: PushSubscription) => {
  try {
    const response = await fetch('/api/save-push-subscription', { // <-- REPLACE WITH YOUR BACKEND ENDPOINT
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription),
    });
    if (response.ok) {
      console.log('Push subscription sent to server successfully.');
    } else {
      console.error('Failed to send push subscription to server:', response.statusText);
    }
  } catch (error) {
    console.error('Error sending push subscription to server:', error);
  }
};
// --- END OF FILE src/utils/notifications.ts ---