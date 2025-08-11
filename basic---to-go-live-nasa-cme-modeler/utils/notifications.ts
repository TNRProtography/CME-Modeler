// --- START OF FILE src/utils/notifications.ts ---

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

interface CustomNotificationOptions extends NotificationOptions {
    tag?: string; // Custom tag for grouping/replacing notifications
}

// Function to send a notification (This is for *in-app* notifications, not push)
export const sendNotification = (title: string, body: string, options?: CustomNotificationOptions) => {
  // Ensure notifications are supported and permission is granted
  if (!('Notification' in window)) {
    console.warn('Notifications are not supported by this browser.');
    return;
  }

  // Check if the specific notification category is enabled by the user
  // This preference is local and won't affect server-sent push notifications directly
  // unless you also send it to your backend for filtering there.
  if (options?.tag && !getNotificationPreference(options.tag)) {
    console.log(`Notification for category '${options.tag}' is disabled by user preference.`);
    return;
  }

  if (Notification.permission === 'granted') {
    const notificationOptions: NotificationOptions = {
      body: body,
      icon: '/icons/android-chrome-192x192.png', // Path to your app icon (from manifest)
      badge: '/icons/android-chrome-192x192.png', // For Android badges (same as icon for simplicity)
      vibrate: [200, 100, 200], // Standard vibration pattern: vibrate, pause, vibrate
      ...options, // Allow overriding default options
    };

    new Notification(title, notificationOptions); // This is the Web Notification API
    console.log('Notification sent (in-app):', title, body);
  } else {
    console.warn('Notification not sent (in-app). Permission:', Notification.permission);
  }
};

// --- New: Web Push Subscription Logic ---

// =========================================================================
// === IMPORTANT: This should be your actual VAPID PUBLIC KEY! ===
// This key identifies your application server to the push service.
// =========================================================================
const VAPID_PUBLIC_KEY = 'BJFhRHKlybzXdM37Hz0Tv0chiN0mkTP9YuUe_-RWWJJnkWs-Xt1asrQ99OYf5QiUAD77hyZTxrrh0S5768lhVms'; // <-- MAKE SURE YOU'VE REPLACED THIS

/**
 * Helper function to convert a Base64 URL-safe string to a Uint8Array.
 * Required for PushManager.subscribe's applicationServerKey option.
 */
const urlBase64ToUint8Array = (base64String: string): Uint8Array => {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
        .replace(/\-/g, '+')
        .replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
};

/**
 * Subscribes the user to Web Push Notifications.
 * This should be called after notification permission is granted, ideally from a user interaction.
 * @returns The PushSubscription object if successful, or null.
 */
export const subscribeUserToPush = async (): Promise<PushSubscription | null> => {
  // Check for service worker and push manager support
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('Service Workers or Push Messaging are not supported by this browser.');
    return null;
  }
  
  // --- ADDED: Check if VAPID key is still the placeholder ---
  if (VAPID_PUBLIC_KEY === 'YOUR_VAPID_PUBLIC_KEY_HERE') {
    console.error('VAPID_PUBLIC_KEY is not set. Cannot subscribe to push notifications.');
    alert('Push notification setup is incomplete. Please contact the administrator.');
    return null;
  }

  // Ensure notification permission is granted
  const permission = await requestNotificationPermission();
  if (permission !== 'granted') {
    console.warn('Notification permission not granted. Cannot subscribe to push.');
    return null;
  }

  try {
    // Get the service worker registration
    const registration = await navigator.serviceWorker.ready;

    // Check if there's an existing subscription
    const existingSubscription = await registration.pushManager.getSubscription();
    if (existingSubscription) {
      console.log('User already has a push subscription:', existingSubscription);
      // Send subscription to server to ensure it's up to date.
      await sendPushSubscriptionToServer(existingSubscription);
      return existingSubscription;
    }

    // Subscribe to push notifications
    const applicationServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
    const options = { userVisibleOnly: true, applicationServerKey: applicationServerKey };
    const subscription = await registration.pushManager.subscribe(options);

    console.log('Successfully subscribed to push:', subscription);
    
    // Send this new subscription object to your backend server.
    await sendPushSubscriptionToServer(subscription);
    return subscription;

  } catch (error) {
    console.error('Failed to subscribe the user to push:', error);
    if (Notification.permission === 'denied') {
        console.warn('User denied push permission or blocked notifications.');
    }
    return null;
  }
};

/**
 * Sends the PushSubscription object to your backend server.
 */
const sendPushSubscriptionToServer = async (subscription: PushSubscription) => {
  try {
    const response = await fetch('https://push-notification-worker.thenamesrock.workers.dev/save-subscription', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(subscription),
    });

    if (response.ok) {
      console.log('Push subscription sent to server successfully.');
    } else {
      console.error('Failed to send push subscription to server:', await response.text());
    }
  } catch (error) {
    console.error('Error sending push subscription to server:', error);
  }
};


// --- Cooldown Mechanism to Prevent Notification Spam ---
const notificationCooldowns: Map<string, number> = new Map(); // Stores last notification timestamp for each tag
const DEFAULT_NOTIFICATION_COOLDOWN_MS = 30 * 60 * 1000; // Default cooldown: 30 minutes

/**
 * Checks if a notification with a given tag can be sent based on its cooldown.
 * If it can, updates the last sent timestamp.
 * @param tag A unique string identifier for the notification type (e.g., 'aurora-50percent', 'flare-M5').
 * @param cooldownMs The minimum time in milliseconds that must pass before sending another notification with this tag.
 * @returns true if the notification can be sent, false otherwise.
 */
export const canSendNotification = (tag: string, cooldownMs: number = DEFAULT_NOTIFICATION_COOLDOWN_MS): boolean => {
  // First, check user preference
  if (!getNotificationPreference(tag)) {
    return false; // User has disabled this notification type
  }

  // Then, check cooldown
  const lastSent = notificationCooldowns.get(tag) || 0;
  const now = Date.now();

  if (now - lastSent > cooldownMs) {
    notificationCooldowns.set(tag, now);
    return true;
  }
  return false;
};

/**
 * Clears the cooldown for a specific notification tag.
 * Useful if conditions change significantly and you want to allow immediate re-notification.
 * @param tag The unique string identifier for the notification type.
 */
export const clearNotificationCooldown = (tag: string) => {
  notificationCooldowns.delete(tag);
};

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

// --- ADDED THIS ENTIRE FUNCTION ---
// Can be called from a button in your UI to test if notifications are working
export const sendTestNotification = () => {
  if (!('Notification' in window)) {
    alert('This browser does not support notifications.');
    return;
  }

  if (Notification.permission === 'granted') {
    new Notification('Test Notification', {
      body: 'If you can see this, in-app notifications are working!',
      icon: '/icons/android-chrome-192x192.png',
    });
  } else {
    alert(`Cannot send test notification. Permission status is: ${Notification.permission}. Please enable notifications first.`);
  }
};
// --- END OF FILE src/utils/notifications.ts ---