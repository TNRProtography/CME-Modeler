// --- START OF FILE src/utils/notifications.ts ---
/**
 * Notifications utility — hardened for platform detection and safe fallbacks.
 * Exposes:
 *  - requestNotificationPermission()
 *  - canSendNotification()
 *  - sendNotification(title, options)
 *  - clearNotificationCooldown()
 */

export type NotificationPermissionLike = NotificationPermission | "unsupported";

interface CustomNotificationOptions extends NotificationOptions {
  /** Collapse older notifications with the same tag */
  tag?: string;
  /** Show even if the page is visible */
  forceWhenVisible?: boolean;
  /** Allow multiple notifications even with same tag */
  stacking?: boolean;
  /** Optional Android category/channel hint (treated as a tag on web) */
  categoryId?: string;
}

const COOLDOWN_KEY = "sta_notification_cooldown_until";

// ---- Platform detection (robust; never throws) -----------------------------

type Platform = "android" | "ios" | "web";

const getPlatform = (): Platform => {
  try {
    const ua = (typeof navigator !== "undefined" && navigator.userAgent) ? navigator.userAgent.toLowerCase() : "";
    if (/android/.test(ua)) return "android";
    if (/(iphone|ipad|ipod|ios)/.test(ua)) return "ios";
    return "web";
  } catch {
    return "web";
  }
};

// Optional per-platform categories/channels. On the open web this is mostly
// advisory; we degrade to tags. We ALWAYS guard lookups.
const PLATFORM_CHANNELS: Record<Platform, { defaultCategory: string; categories: Record<string, string> }> = {
  android: {
    defaultCategory: "general",
    categories: {
      general: "General",
      alerts: "Alerts",
      aurora: "Aurora",
      solar: "Solar",
      system: "System",
    },
  },
  ios: {
    defaultCategory: "general",
    categories: {
      general: "General",
      alerts: "Alerts",
      aurora: "Aurora",
      solar: "Solar",
      system: "System",
    },
  },
  web: {
    defaultCategory: "general",
    categories: {
      general: "General",
      alerts: "Alerts",
      aurora: "Aurora",
      solar: "Solar",
      system: "System",
    },
  },
};

const currentPlatform: Platform = getPlatform();
const CHANNELS = PLATFORM_CHANNELS[currentPlatform] ?? PLATFORM_CHANNELS.web;

// ---- Permission helpers ----------------------------------------------------

export const requestNotificationPermission = async (): Promise<NotificationPermissionLike> => {
  if (typeof window === "undefined" || !("Notification" in window)) {
    console.warn("Notifications are not supported by this environment.");
    return "unsupported";
  }
  try {
    // If already granted/denied, just return it.
    if (Notification.permission === "granted" || Notification.permission === "denied") {
      return Notification.permission;
    }
    const perm = await Notification.requestPermission();
    return perm;
  } catch (err) {
    console.error("Error requesting notification permission:", err);
    return "denied";
  }
};

export const canSendNotification = async (): Promise<boolean> => {
  const perm = await requestNotificationPermission();
  return perm === "granted";
};

// ---- Cooldown management (optional) ----------------------------------------

export const clearNotificationCooldown = (): void => {
  try {
    localStorage.removeItem(COOLDOWN_KEY);
  } catch {
    // ignore
  }
};

const isAppVisible = (): boolean =>
  typeof document !== "undefined" && document.visibilityState === "visible";

const withinCooldown = (): boolean => {
  try {
    const until = localStorage.getItem(COOLDOWN_KEY);
    if (!until) return false;
    const t = Number(until);
    return Number.isFinite(t) && Date.now() < t;
  } catch {
    return false;
  }
};

const setCooldownMs = (ms: number): void => {
  try {
    localStorage.setItem(COOLDOWN_KEY, String(Date.now() + Math.max(0, ms)));
  } catch {
    // ignore
  }
};

// ---- Show Notification (via SW if possible) --------------------------------

export const sendNotification = async (
  title: string,
  options: CustomNotificationOptions = {}
): Promise<boolean> => {
  // Guard: environment support
  if (typeof window === "undefined" || !("Notification" in window)) {
    console.warn("Notifications not supported in this environment.");
    return false;
  }

  // Permission
  if (!(await canSendNotification())) return false;

  // Respect visibility unless forced
  if (!options.forceWhenVisible && isAppVisible()) {
    // If we don't want to spam while visible, silently skip.
    return false;
  }

  // Prevent message storms (tune as desired, or remove)
  if (withinCooldown()) {
    return false;
  }

  // Derive effective tag: Prefer options.tag; else category; else platform default
  const categoryId = (options.categoryId && CHANNELS.categories[options.categoryId])
    ? options.categoryId
    : CHANNELS.defaultCategory;

  const effectiveTag = options.tag || `sta:${categoryId}`;

  // SW first (better control & works when tab is hidden)
  try {
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.ready;
      if (reg?.showNotification) {
        // Prepare options safely; avoid mutating caller-provided object
        const opts: NotificationOptions = {
          ...options,
          tag: effectiveTag,
        };

        // Browsers ignore undefined; keep clean
        delete (opts as any).forceWhenVisible;
        delete (opts as any).stacking;
        delete (opts as any).categoryId;

        await reg.showNotification(title, opts);
        // Example cooldown: 20s; adjust to your taste or wire to category
        setCooldownMs(20_000);
        return true;
      }
    }
  } catch (err) {
    console.error("Service worker notification failed; falling back to window.Notification:", err);
  }

  // Fallback: direct Notification
  try {
    const n = new Notification(title, { ...options, tag: effectiveTag });
    // Basic autoclose to avoid clutter
    setTimeout(() => n.close?.(), 8000);
    setCooldownMs(20_000);
    return true;
  } catch (err) {
    console.error("Direct Notification failed:", err);
    return false;
  }
};

// ---- Export platform info (optional for UI) --------------------------------

export const getNotificationPlatform = (): Platform => currentPlatform;
export const getNotificationCategories = (): { id: string; label: string }[] =>
  Object.entries(CHANNELS.categories).map(([id, label]) => ({ id, label }));

// --- END OF FILE src/utils/notifications.ts ---
