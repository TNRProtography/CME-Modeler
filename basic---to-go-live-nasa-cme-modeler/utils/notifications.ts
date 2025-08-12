// --- START OF FILE src/utils/notifications.ts ---

/**
 * Notifications utility (hardened for server-side push)
 *
 * This file handles both local (in-app) notifications and the logic for
 * subscribing to the server-side push notification worker.
 */

// A single source of truth for all notification categories used in the app.
const NOTIFICATION_CATEGORIES = [
    'aurora-40percent', 'aurora-50percent', 'aurora-60percent', 'aurora-80percent',
    'flare-M1', 'flare-M5', 'flare-X1', 'flare-X5', 'substorm-forecast',
];

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
  tag?: string;
  forceWhenVisible?: boolean;
  stacking?: boolean;
}

const DEBUG = (() => {
  try {
    return localStorage.getItem('debug_notifications') === '1';
  } catch {
    return false;
  }
})();

const isAppVisible = (): boolean =>
  typeof document !== 'undefined' && document.visibilityState === 'visible';

const waitForServiceWorkerReady = async (timeoutMs = 4000): Promise<ServiceWorkerRegistration | null> => {
  if (!('serviceWorker' in navigator)) return null;

  const timeout = new Promise<null>((resolve) => {
    const id = setTimeout(() => {
      clearTimeout(id);
      resolve(null);
    }, timeoutMs);
  });

  try {
    const ready = navigator.serviceWorker.ready;
    const reg = (await Promise.race([ready, timeout])) as ServiceWorkerRegistration | null;
    return reg ?? null;
  } catch {
    return null;
  }
};

const showNotification = async (title: string, options: NotificationOptions): Promise<boolean> => {
  try {
    const reg = await waitForServiceWorkerReady();
    if (reg && typeof reg.showNotification === 'function') {
      await reg.showNotification(title, options);
      return true;
    }
  } catch (e) {
    if (DEBUG) console.warn('SW showNotification failed, falling back to window Notification:', e);
  }

  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, options);
    return true;
  }
  return false;
};

const buildStackingOptions = (opts?: CustomNotificationOptions & { body?: string }): NotificationOptions => {
  const stacking = opts?.stacking ?? true;
  const base: NotificationOptions = {
    body: opts?.body,
    icon: opts?.icon ?? '/icons/android-chrome-192x192.png',
    badge: opts?.badge ?? '/icons/android-chrome-192x192.png',
    vibrate: opts?.vibrate ?? [200, 100, 200],
    data: opts?.data,
    requireInteraction: opts?.requireInteraction,
    silent: opts?.silent,
    actions: opts?.actions,
    image: opts?.image,
    renotify: false,
  };
  return stacking ? base : { ...base, tag: opts?.tag ?? 'default' };
};

const ensurePermission = async (): Promise<boolean> => {
  if (!('Notification' in window)) {
    console.warn('Notifications are not supported by this browser.');
    return false;
  }
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;

  try {
    const perm = await Notification.requestPermission();
    return perm === 'granted';
  } catch (e) {
    console.error('Error while requesting notification permission:', e);
    return false;
  }
};

export const sendNotification = async (
  title: string,
  body: string,
  options?: CustomNotificationOptions
): Promise<boolean> => {
  if (!('Notification' in window)) {
    console.warn('Notifications are not supported by this browser.');
    return false;
  }
  const hasPerm = await ensurePermission();
  if (!hasPerm) {
    console.warn('Notification not sent. Permission:', Notification.permission);
    return false;
  }
  const categoryKey = options?.tag;
  if (categoryKey && !getNotificationPreference(categoryKey)) {
    if (DEBUG) console.log(`Notification for category '${categoryKey}' is disabled by user preference.`);
    return false;
  }
  const force = options?.forceWhenVisible ?? true;
  if (isAppVisible() && !force) {
    if (DEBUG) console.log('Notification suppressed because the application is currently visible.');
    return false;
  }
  const finalOptions = buildStackingOptions({ ...options, body });
  const shown = await showNotification(title, finalOptions);
  if (shown) {
    if (DEBUG) console.log('Notification shown:', title, body, finalOptions);
  } else {
    console.warn('Notification could not be shown.');
  }
  return shown;
};

// --- Push subscription helpers ---

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

/**
 * --- MODIFIED FOR SERVER-SIDE PUSH ---
 * This function now gathers user preferences and sends them with the subscription.
 */
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
    const reg = await waitForServiceWorkerReady();
    if (!reg) {
      console.error('Service worker is not ready; cannot subscribe to push.');
      return null;
    }

    // --- NEW: Gather all current notification preferences ---
    const preferences: Record<string, boolean> = {};
    NOTIFICATION_CATEGORIES.forEach(id => {
        preferences[id] = getNotificationPreference(id);
    });

    let subscription = await reg.pushManager.getSubscription();
    if (subscription) {
      if (DEBUG) console.log('Existing push subscription found.');
      // Always resend to server to ensure preferences are up-to-date.
      await sendPushSubscriptionToServer(subscription, preferences);
      return subscription;
    }

    const appServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
    subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: appServerKey,
    });

    if (DEBUG) console.log('New push subscription created.');
    await sendPushSubscriptionToServer(subscription, preferences);
    return subscription;
  } catch (error) {
    console.error('Failed to subscribe the user to push:', error);
    return null;
  }
};

/**
 * --- MODIFIED FOR SERVER-SIDE PUSH ---
 * Sends the subscription AND the user's preferences to the worker.
 */
const sendPushSubscriptionToServer = async (subscription: PushSubscription, preferences: Record<string, boolean>) => {
  try {
    const body = JSON.stringify({ subscription, preferences });
    const resp = await fetch('https://push-notification-worker.thenamesrock.workers.dev/save-subscription', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body,
    });

    if (!resp.ok) {
      console.error('Failed to send push subscription to server:', await resp.text());
    } else if (DEBUG) {
      console.log('Push subscription and preferences sent to server successfully.');
    }
  } catch (error) {
    console.error('Error sending push subscription to server:', error);
  }
};

// --- Cooldown management ---

const notificationCooldowns: Map<string, number> = new Map();
const DEFAULT_NOTIFICATION_COOLDOWN_MS = 30 * 60 * 1000;

export const canSendNotification = (
  tag: string,
  cooldownMs: number = DEFAULT_NOTIFICATION_COOLDOWN_MS,
  reserve: boolean = true
): boolean => {
  if (!getNotificationPreference(tag)) return false;
  const last = notificationCooldowns.get(tag) ?? 0;
  const now = Date.now();
  const ok = now - last > cooldownMs;
  if (ok && reserve) {
    notificationCooldowns.set(tag, now);
  }
  return ok;
};

export const clearNotificationCooldown = (tag: string) => {
  notificationCooldowns.delete(tag);
};

export const sendNotificationWithCooldown = async (
  tag: string,
  cooldownMs: number,
  title: string,
  body: string,
  options?: CustomNotificationOptions
): Promise<boolean> => {
  const allowed = canSendNotification(tag, cooldownMs, false);
  if (!allowed) return false;
  const shown = await sendNotification(title, body, { ...options, tag });
  if (shown) {
    notificationCooldowns.set(tag, Date.now());
  } else if (DEBUG) {
    console.warn(`Notification "${tag}" not shown; cooldown not updated.`);
  }
  return shown;
};

// --- Preferences ---

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

// --- Quick test helper ---

export const sendTestNotification = async (title?: string, body?: string) => {
  if (!('Notification' in window)) {
    alert('This browser does not support notifications.');
    return;
  }
  const hasPerm = await ensurePermission();
  if (!hasPerm) {
    alert(`Cannot send test notification. Permission status is: ${Notification.permission}.`);
    return;
  }
  const finalTitle = title || 'Test Notification';
  const finalBody = body || 'This is a test notification. If you received this, your device is set up correctly!';
  await sendNotification(finalTitle, finalBody, {
    forceWhenVisible: true,
    stacking: true, // Use a new notification for each test
    tag: `test-${Date.now()}` // Unique tag to prevent stacking for tests
  });
};

// --- END OF FILE src/utils/notifications.ts ---