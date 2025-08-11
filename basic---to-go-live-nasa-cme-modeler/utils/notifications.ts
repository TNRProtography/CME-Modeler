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
  if (options?.tag && !getNotificationPreference(options.tag)) {
    console.log(`Notification for category '${options.tag}' is disabled by user preference.`);
    return;
  }

  if (Notification.permission === 'granted') {
    const notificationOptions: NotificationOptions = {
      body: body,
      icon: '/icons/android-chrome-192x192.png',
      badge: '/icons/android-chrome-192x192.png',
      vibrate: [200, 100, 200],
      ...options,
    };

    new Notification(title, notificationOptions);
    console.log('Notification sent (in-app):', title, body);
  } else {
    console.warn('Notification not sent (in-app). Permission:', Notification.permission);
  }
};

// --- New: Web Push Subscription Logic ---

const VAPID_PUBLIC_KEY = 'BIQ9JadNJgyMDPebgXu5Vpf7-7XuCcl5uEaxocFXeIdUxDq1Q9bGe0E5C8-a2qQ-psKhqbAzV2vELkRxpnWqebU';

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


export const subscribeUserToPush = async (): Promise<PushSubscription | null> => {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('Service Workers or Push Messaging are not supported by this browser.');
    return null;
  }
  
  // --- THIS IS THE CORRECTED LOGIC ---
  // It checks against the placeholder, not your actual key.
  if (VAPID_PUBLIC_KEY === 'YOUR_VAPID_PUBLIC_KEY_HERE') {
    console.error('VAPID_PUBLIC_KEY has not been replaced. Cannot subscribe to push notifications.');
    alert('Push notification setup is incomplete. Please contact the administrator.');
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
      await sendPushSubscriptionToServer(existingSubscription);
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
    if (Notification.permission === 'denied') {
        console.warn('User denied push permission or blocked notifications.');
    }
    return null;
  }
};

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

// --- Cooldown Mechanism ---
const notificationCooldowns: Map<string, number> = new Map();
const DEFAULT_NOTIFICATION_COOLDOWN_MS = 30 * 60 * 1000;

export const canSendNotification = (tag: string, cooldownMs: number = DEFAULT_NOTIFICATION_COOLDOWN_MS): boolean => {
  if (!getNotificationPreference(tag)) {
    return false;
  }
  const lastSent = notificationCooldowns.get(tag) || 0;
  const now = Date.now();
  if (now - lastSent > cooldownMs) {
    notificationCooldowns.set(tag, now);
    return true;
  }
  return false;
};

export const clearNotificationCooldown = (tag: string) => {
  notificationCooldowns.delete(tag);
};

// --- User Notification Preferences ---
const NOTIFICATION_PREF_PREFIX = 'notification_pref_';

export const getNotificationPreference = (categoryId: string): boolean => {
  try {
    const storedValue = localStorage.getItem(NOTIFICATION_PREF_PREFIX + categoryId);
    return storedValue === null ? true : JSON.parse(storedValue);
  } catch (e) {
    console.error(`Error reading notification preference for ${categoryId}:`, e);
    return true;
  }
};

export const setNotificationPreference = (categoryId: string, enabled: boolean) => {
  try {
    localStorage.setItem(NOTIFICATION_PREF_PREFIX + categoryId, JSON.stringify(enabled));
  } catch (e) {
    console.error(`Error saving notification preference for ${categoryId}:`, e);
  }
};

// --- Test Notification Function ---
export const sendTestNotification = () => {
  if (!('Notification' in window)) {
    alert('This browser does not support notifications.');
    return;
  }
  if (Notification.permission === 'granted') {
    new Notification('Test Notification', {
      body: 'This is a test notification. If you received this, your device is set up correctly!',
      icon: '/icons/android-chrome-192x192.png',
      tag: 'test-notification'
    });
  } else {
    alert(`Cannot send test notification. Permission status is: ${Notification.permission}. Please enable notifications first.`);
  }
};
// --- END OF FILE src/utils/notifications.ts ---