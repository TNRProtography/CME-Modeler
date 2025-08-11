// --- START OF FILE src/utils/notifications.ts ---

/**
 * Request Notification permission from the user.
 */
export const requestNotificationPermission = async (): Promise<NotificationPermission | 'unsupported'> => {
  if (!('Notification' in window)) {
    console.warn('Notifications are not supported by this browser.');
    return 'unsupported';
  }

  if (Notification.permission === 'granted' || Notification.permission === 'denied') {
    return Notification.permission;
  }

  try {
    const permission = await Notification.requestPermission();
    return permission;
  } catch (error) {
    console.error('Error requesting notification permission:', error);
    return 'denied';
  }
};

interface CustomNotificationOptions extends NotificationOptions {
  tag?: string; // category key
  forceWhenVisible?: boolean; // show even if app visible
  stacking?: boolean; // default true
}

/** App visibility utility */
const isAppVisible = (): boolean =>
  typeof document !== 'undefined' && document.visibilityState === 'visible';

/** Prefer SW notifications when possible */
const showNotification = async (title: string, options: NotificationOptions) => {
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready;
      if (reg?.showNotification) {
        await reg.showNotification(title, options);
        return true;
      }
    }
  } catch (e) {
    console.warn('SW showNotification failed, falling back to window Notification:', e);
  }

  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, options);
    return true;
  }
  return false;
};

/** Build options, honoring stacking rules */
const buildStackingOptions = (opts?: CustomNotificationOptions & { body?: string }): NotificationOptions => {
  const stacking = opts?.stacking ?? true;

  const base: NotificationOptions = {
    body: opts?.body,
    icon: opts?.icon ?? '/icons/favicon-32x32.png',
    badge: opts?.badge ?? '/icons/favicon-32x32.png',
    vibrate: opts?.vibrate ?? [200, 100, 200],
    data: opts?.data,
    requireInteraction: opts?.requireInteraction,
    silent: opts?.silent,
    actions: opts?.actions,
    image: opts?.image,
    renotify: false,
  };

  if (stacking) {
    return base; // omit tag for stacking
  } else {
    return { ...base, tag: opts?.tag ?? 'default' };
  }
};

/**
 * Send an in-app (local) notification.
 */
export const sendNotification = async (title: string, body: string, options?: CustomNotificationOptions) => {
  if (!('Notification' in window)) {
    console.warn('Notifications are not supported by this browser.');
    return;
  }

  const categoryKey = options?.tag;
  if (categoryKey && !getNotificationPreference(categoryKey)) {
    console.log(`Notification for category '${categoryKey}' is disabled by user preference.`);
    return;
  }

  if (Notification.permission !== 'granted') {
    console.warn('Notification not sent. Permission:', Notification.permission);
    return;
  }

  const force = !!options?.forceWhenVisible;
  if (isAppVisible() && !force) {
    console.log('Notification suppressed because the application is currently visible.');
    return;
  }

  const finalOptions = buildStackingOptions({ ...options, body });
  const shown = await showNotification(title, finalOptions);

  if (shown) {
    console.log('Notification shown:', title, body, finalOptions);
  } else {
    console.warn('Notification could not be shown.');
  }
};

// ----------------- Web Push Subscription Logic -----------------

const VAPID_PUBLIC_KEY =
  'BIQ9JadNJgyMDPebgXu5Vpf7-7XuCcl5uEaxocFXeIdUxDq1Q9bGe0E5C8-a2qQ-psKhqbAzV2vELkRxpnWqebU';

const urlBase64ToUint8Array = (base64String: string): Uint8Array => {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
};

export const subscribeUserToPush = async (): Promise<PushSubscription | null> => {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('Service Workers or Push Messaging are not supported by this browser.');
    return null;
  }

  if (!VAPID_PUBLIC_KEY || VAPID_PUBLIC_KEY.length < 50) {
    console.error('VAPID_PUBLIC_KEY is missing/invalid.');
    return null;
  }

  const permission = await requestNotificationPermission();
  if (permission !== 'granted') {
    console.warn('Notification permission not granted. Cannot subscribe to push.');
    return null;
  }

  try {
    const reg = await navigator.serviceWorker.ready;

    const existing = await reg.pushManager.getSubscription();
    if (existing) {
      console.log('Existing push subscription:', existing);
      await sendPushSubscriptionToServer(existing);
      return existing;
    }

    const appServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: appServerKey,
    });

    console.log('New push subscription:', subscription);
    await sendPushSubscriptionToServer(subscription);
    return subscription;
  } catch (error) {
    console.error('Failed to subscribe the user to push:', error);
    return null;
  }
};

const sendPushSubscriptionToServer = async (subscription: PushSubscription) => {
  try {
    const resp = await fetch('https://push-notification-worker.thenamesrock.workers.dev/save-subscription', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription),
    });

    if (!resp.ok) {
      console.error('Failed to send push subscription to server:', await resp.text());
    } else {
      console.log('Push subscription sent to server successfully.');
    }
  } catch (error) {
    console.error('Error sending push subscription to server:', error);
  }
};

export const triggerServerPush = async (): Promise<void> => {
  try {
    const resp = await fetch('https://push-notification-worker.thenamesrock.workers.dev/trigger-push');
    const json = await resp.json();
    console.log('Trigger push result:', json);
  } catch (e) {
    console.error('Error triggering server push:', e);
  }
};

// ----------------- Cooldown Mechanism -----------------

const notificationCooldowns: Map<string, number> = new Map();
const DEFAULT_NOTIFICATION_COOLDOWN_MS = 30 * 60 * 1000;

export const canSendNotification = (tag: string, cooldownMs: number = DEFAULT_NOTIFICATION_COOLDOWN_MS): boolean => {
  if (!getNotificationPreference(tag)) return false;

  const last = notificationCooldowns.get(tag) ?? 0;
  const now = Date.now();
  if (now - last > cooldownMs) {
    notificationCooldowns.set(tag, now);
    return true;
  }
  return false;
};

export const clearNotificationCooldown = (tag: string) => {
  notificationCooldowns.delete(tag);
};

// ----------------- User Notification Preferences -----------------

const NOTIFICATION_PREF_PREFIX = 'notification_pref_';

export const getNotificationPreference = (categoryId: string): boolean => {
  try {
    const stored = localStorage.getItem(NOTIFICATION_PREF_PREFIX + categoryId);
    return stored === null ? true : JSON.parse(stored);
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

// ----------------- Test Notification -----------------

export const sendTestNotification = async (title?: string, body?: string) => {
  if (!('Notification' in window)) {
    alert('This browser does not support notifications.');
    return;
  }

  if (Notification.permission !== 'granted') {
    const perm = await requestNotificationPermission();
    if (perm !== 'granted') {
      alert(`Cannot send test notification. Permission status is: ${Notification.permission}.`);
      return;
    }
  }

  const finalTitle = title || 'Test Notification';
  const finalBody =
    body ||
    'This is a test notification. If you received this, your device is set up correctly!';

  await sendNotification(finalTitle, finalBody, {
    forceWhenVisible: true,
    stacking: true,
    icon: '/icons/favicon-32x32.png',
    badge: '/icons/favicon-32x32.png',
  });
};

// --- END OF FILE src/utils/notifications.ts ---
