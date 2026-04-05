// --- START OF FILE src/utils/notifications.ts ---

/**
 * Notifications utility (server-push + local notifications + diagnostics)
 *
 * Adds:
 * - Category tagging via `tag` and payload `category`
 * - Self-test helper that hits /trigger-test-push-for-me
 * - Returns subscription id (hash of endpoint) for easier single-device testing
 */

// Icon map — mirrors TOPIC_ICONS in sw.js so local test notifications
// also show the correct icon. Must be kept in sync with public/sw.js.
const TOPIC_ICONS: Record<string, string> = {
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
  'ips-shock':         '/icons/icon-ips-shock.png',
  'aurora-40percent':  '/icons/icon-aurora.png',
  'aurora-50percent':  '/icons/icon-aurora.png',
  'aurora-60percent':  '/icons/icon-aurora.png',
  'aurora-80percent':  '/icons/icon-aurora.png',
  'substorm-forecast': '/icons/icon-substorm.png',
  'admin-broadcast':   '/icons/icon-default.png',
};
const DEFAULT_ICON = '/icons/icon-default.png';

function getNotificationIcon(tag?: string): string {
  if (!tag) return DEFAULT_ICON;
  for (const topic of Object.keys(TOPIC_ICONS)) {
    if (tag === topic || tag.startsWith(`test-${topic}`)) {
      return TOPIC_ICONS[topic];
    }
  }
  return DEFAULT_ICON;
}

// All notification topic keys — kept in sync with the worker.
// Existing topics are preserved for backwards compatibility.
// New topics added here are opt-out by default (undefined = send).
const NOTIFICATION_CATEGORIES = [
  // Aurora visibility — new location-aware notifications
  'visibility-dslr',
  'visibility-phone',
  'visibility-naked',
  // Overnight watch
  'overnight-watch',
  // Solar flare event (replaces flare-peak in UI — old topic still runs on worker)
  'flare-event',
  // Shock detection
  'shock-detection',
// IPS shock (interplanetary shock from DONKI) — was missing, causing it to never be sent
  'ips-shock',
  // Legacy topics — kept for backwards compat, hidden from UI but still respected
  'aurora-40percent', 'aurora-50percent', 'aurora-60percent', 'aurora-80percent',
  'flare-M1', 'flare-M5', 'flare-X1', 'flare-X5', 'flare-X10', 'flare-peak',
  'substorm-forecast',
  // Admin broadcast
  'admin-broadcast',
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
  skipPreferenceCheck?: boolean;
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
    icon: opts?.icon ?? getNotificationIcon(opts?.tag),
    badge: opts?.badge ?? getNotificationIcon(opts?.tag),
    vibrate: opts?.vibrate ?? [200, 100, 200],
    data: { ...(opts?.data || {}), category: (opts?.tag || 'general') },
    requireInteraction: opts?.requireInteraction,
    silent: opts?.silent,
    actions: opts?.actions,
    image: opts?.image,
    renotify: false,
    timestamp: Date.now(),
  };
  return stacking ? base : { ...base, tag: opts?.tag ?? 'general' };
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
  if (isAppVisible() && !(options?.forceWhenVisible)) {
    if (DEBUG) console.log('Notification suppressed because the application is currently visible.');
    return false;
  }
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
  if (!options?.skipPreferenceCheck && categoryKey && !getNotificationPreference(categoryKey)) {
    if (DEBUG) console.log(`Notification for category '${categoryKey}' is disabled by user preference.`);
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

async function computeSubscriptionId(endpoint: string): Promise<string> {
  const enc = new TextEncoder().encode(endpoint);
  // @ts-ignore
  const buf = await crypto.subtle.digest('SHA-256', enc);
  const b = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const subscribeUserToPush = async (): Promise<{ subscription: PushSubscription, id: string } | null> => {
  console.log("DIAGNOSTIC: Attempting to subscribe user to push notifications...");
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.error('DIAGNOSTIC: CRITICAL - Service Worker or Push Manager not supported.');
    return null;
  }
  if (!VAPID_PUBLIC_KEY || VAPID_PUBLIC_KEY.length < 50) {
    console.error('DIAGNOSTIC: CRITICAL - VAPID_PUBLIC_KEY is missing or invalid.');
    return null;
  }
  const permission = await requestNotificationPermission();
  if (permission !== 'granted') {
    console.warn('DIAGNOSTIC: Push subscription failed: Permission not granted.');
    return null;
  }
  try {
    const reg = await waitForServiceWorkerReady();
    if (!reg) {
      console.error('DIAGNOSTIC: Service worker is not ready; cannot subscribe to push.');
      return null;
    }
    console.log("DIAGNOSTIC: Service worker is ready.");

    const preferences: Record<string, boolean> = {};
    NOTIFICATION_CATEGORIES.forEach(id => {
      preferences[id] = getNotificationPreference(id);
    });
    console.log("DIAGNOSTIC: Gathered user preferences:", preferences);

    let subscription = await reg.pushManager.getSubscription();
    if (subscription) {
      console.log('DIAGNOSTIC: Existing push subscription found.');
    } else {
      console.log('DIAGNOSTIC: No existing subscription found, creating a new one...');
      const appServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: appServerKey,
      });
      console.log('DIAGNOSTIC: New push subscription created successfully.');
    }

    // Try to get GPS position to store precise location for visibility notifications
    let coords: { latitude: number; longitude: number } | null = null;
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: false,
          timeout: 8000,
          maximumAge: 3600000,
        })
      );
      coords = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
      console.log('DIAGNOSTIC: GPS position obtained for subscription:', coords);
    } catch {
      console.warn('DIAGNOSTIC: GPS unavailable, will use Cloudflare IP geolocation');
    }

    await sendPushSubscriptionToServer(subscription, preferences, coords);

    const id = await computeSubscriptionId(subscription.endpoint);
    try { localStorage.setItem('push_subscription_id', id); } catch {}
    console.log('DIAGNOSTIC: Your subscription id is:', id);

    return { subscription, id };
  } catch (error) {
    console.error('DIAGNOSTIC: CRITICAL ERROR during subscribeUserToPush:', error);
    return null;
  }
};

const sendPushSubscriptionToServer = async (
  subscription: PushSubscription,
  preferences: Record<string, boolean>,
  coords?: { latitude: number; longitude: number } | null
) => {
  console.log("DIAGNOSTIC: Sending subscription to server...");
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const body = JSON.stringify({
    subscription,
    preferences,
    timezone,
    overnight_mode: getOvernightMode(),
    ...(coords ? { latitude: coords.latitude, longitude: coords.longitude } : {}),
  });
  console.log("DIAGNOSTIC: Request Body being sent:", body);

  try {
    const resp = await fetch('https://push-notification-worker.thenamesrock.workers.dev/save-subscription', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body,
    });

    console.log("DIAGNOSTIC: Server responded with status:", resp.status);
    if (!resp.ok) {
      const errorText = await resp.text();
      console.error('DIAGNOSTIC: SERVER REJECTED SUBSCRIPTION:', errorText);
      alert(`Error: The server rejected the notification subscription. Please check the console for details. Server message: ${errorText}`);
    } else {
      try {
        const j = await resp.json().catch(() => null);
        if (j?.id) {
          localStorage.setItem('push_subscription_id', j.id);
          console.log('DIAGNOSTIC: Server returned id:', j.id);
        }
      } catch {}
      console.log('DIAGNOSTIC: Push subscription and preferences sent to server successfully.');
    }
  } catch (error) {
    console.error('DIAGNOSTIC: FATAL NETWORK ERROR sending push subscription to server:', error);
    alert('Fatal Error: Could not send subscription to the server. Check network connection and console logs.');
  }
};

// --- NEW FUNCTION TO UPDATE PREFERENCES ON THE SERVER ---
/**
 * Gathers current preferences from localStorage and re-sends them to the server
 * for the existing subscription. This should be called whenever a user changes a setting.
 */
export const updatePushSubscriptionPreferences = async () => {
  const reg = await waitForServiceWorkerReady();
  if (!reg) {
    console.error("Cannot update preferences: Service worker not ready.");
    return;
  }

  const subscription = await reg.pushManager.getSubscription();
  if (!subscription) {
    console.warn("Cannot update preferences: No active push subscription found.");
    return;
  }

  const updatedPreferences: Record<string, boolean> = {};
  NOTIFICATION_CATEGORIES.forEach(id => {
    updatedPreferences[id] = getNotificationPreference(id);
  });
  
  console.log("DIAGNOSTIC: Preferences changed, sending update to server...", updatedPreferences);
  await sendPushSubscriptionToServer(subscription, updatedPreferences);
};

// --- Location refresh on app load ---

const PUSH_WORKER_URL = 'https://push-notification-worker.thenamesrock.workers.dev';

/**
 * Called on every app load. If the user has an active push subscription,
 * silently refreshes their GPS location in the worker KV record so that
 * visibility-based notifications use their current precise location.
 * Completely non-blocking — failures are silent.
 */
export const refreshLocationOnServer = async (): Promise<void> => {
  try {
    const reg = await waitForServiceWorkerReady(3000);
    if (!reg) return;
    const subscription = await reg.pushManager.getSubscription();
    if (!subscription) return; // not subscribed, nothing to do

    const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: false,
        timeout: 8000,
        maximumAge: 3600000, // use cached fix if <1hr old — no GPS hardware needed
      })
    );

    await fetch(`${PUSH_WORKER_URL}/update-location`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: subscription.endpoint,
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      }),
    });
  } catch {
    // Silent — GPS denied, no subscription, or network failure. All fine.
  }
};

// --- Cooldown management ---
const notificationCooldowns: Map<string, number> = new Map();
const DEFAULT_NOTIFICATION_COOLDOWN_MS = 30 * 60 * 1000;
export const canSendNotification = (tag: string, cooldownMs: number = DEFAULT_NOTIFICATION_COOLDOWN_MS, reserve: boolean = true): boolean => {
  if (!getNotificationPreference(tag)) return false;
  const last = notificationCooldowns.get(tag) ?? 0;
  const now = Date.now();
  const ok = now - last > cooldownMs;
  if (ok && reserve) { notificationCooldowns.set(tag, now); }
  return ok;
};
export const clearNotificationCooldown = (tag: string) => { notificationCooldowns.delete(tag); };
export const sendNotificationWithCooldown = async (tag: string, cooldownMs: number, title: string, body: string, options?: CustomNotificationOptions): Promise<boolean> => {
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
// Categories that default to ON when not explicitly set by the user.
// These are high-value actionable alerts that subscribers almost certainly want.
const DEFAULT_ON_CATEGORIES = new Set([
  'overnight-watch',

  'visibility-naked',
  'visibility-phone',
  'visibility-dslr',
  'admin-broadcast',
  // Legacy topics — controlled server-side, should appear ON in debug
  'flare-event',
  'flare-M1',
  'flare-M5',
  'flare-X1',
  'flare-X5',
  'flare-X10',
  'flare-peak',
  'aurora-40percent',
  'aurora-50percent',
  'aurora-60percent',
  'aurora-80percent',
  'substorm-forecast',
]);
const LEGACY_PREF_FALLBACKS: Record<string, string[]> = {
  'flare-M1': ['flare-event', 'flare-peak'],
  'flare-M5': ['flare-event', 'flare-peak'],
  'flare-X1': ['flare-event', 'flare-peak'],
  'flare-X5': ['flare-event', 'flare-peak'],
  'flare-X10': ['flare-event', 'flare-peak'],
};

export const getNotificationPreference = (categoryId: string): boolean => {
  try {
    const stored = localStorage.getItem(NOTIFICATION_PREF_PREFIX + categoryId);
    if (stored !== null) return JSON.parse(stored);

    // Backward-compatibility: if this is a new split category and the user
    // has an explicit legacy flare preference, inherit that setting.
    const legacyIds = LEGACY_PREF_FALLBACKS[categoryId] ?? [];
    for (const legacyId of legacyIds) {
      const legacyStored = localStorage.getItem(NOTIFICATION_PREF_PREFIX + legacyId);
      if (legacyStored !== null) return JSON.parse(legacyStored);
    }

    // If never explicitly set, default to true for high-value categories
    return DEFAULT_ON_CATEGORIES.has(categoryId);
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

// --- Overnight-watch mode (user-configurable, sent to server) ---
// 'every-night' — always send a nightly summary regardless of conditions
// 'camera'      — only when aurora may be detectable on a DSLR camera (score >= 25)
// 'phone'       — only when aurora should show on a phone camera (score >= 40)
// 'eye'         — only when aurora may be naked-eye visible (score >= 55)
export type OvernightMode = 'every-night' | 'camera' | 'phone' | 'eye';
const OVERNIGHT_MODE_KEY = 'notification_overnight_mode';
const DEFAULT_OVERNIGHT_MODE: OvernightMode = 'phone';

export const getOvernightMode = (): OvernightMode => {
  try {
    const stored = localStorage.getItem(OVERNIGHT_MODE_KEY) as OvernightMode | null;
    if (stored && ['every-night', 'camera', 'phone', 'eye'].includes(stored)) return stored;
    return DEFAULT_OVERNIGHT_MODE;
  } catch {
    return DEFAULT_OVERNIGHT_MODE;
  }
};

export const setOvernightMode = (mode: OvernightMode) => {
  try {
    localStorage.setItem(OVERNIGHT_MODE_KEY, mode);
  } catch (e) {
    console.error('Error saving overnight mode:', e);
  }
};

// --- Quick test helpers ---

export const sendTestNotification = async (title?: string, body?: string, categoryId?: string) => {
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
  // Use a recognised category tag so the preference check passes,
  // but append a timestamp so it stacks rather than replacing previous notifications.
  const tag = categoryId ? `test-${categoryId}-${Date.now()}` : `test-${Date.now()}`;
  await sendNotification(finalTitle, finalBody, {
    forceWhenVisible: true,
    stacking: true,
    tag,
    // Skip the preference gate for test notifications — the user explicitly clicked Test
    skipPreferenceCheck: true,
  });
};

export const sendServerSelfTest = async (category: string) => {
  const reg = await waitForServiceWorkerReady();
  if (!reg) { alert('Service worker not ready'); return; }
  const sub = await reg.pushManager.getSubscription();
  if (!sub) { alert('No push subscription found. Please enable notifications first.'); return; }

  const resp = await fetch('https://push-notification-worker.thenamesrock.workers.dev/trigger-test-push-for-me', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription: sub.toJSON(), category }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    console.error('Self-test failed:', t);
    alert('Self-test failed. See console.');
  } else {
    console.log('Self-test ok:', await resp.json().catch(() => ({})));
  }
};

export const getLocalSubscriptionId = (): string | null => {
  try { return localStorage.getItem('push_subscription_id'); } catch { return null; }
};

// --- END OF FILE src/utils/notifications.ts ---
