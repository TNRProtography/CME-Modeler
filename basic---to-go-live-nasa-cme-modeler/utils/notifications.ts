// src/utils/notifications.ts

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

// Function to send a notification
export const sendNotification = (title: string, body: string, options?: CustomNotificationOptions) => {
  // Ensure notifications are supported and permission is granted
  if (!('Notification' in window)) {
    console.warn('Notifications are not supported by this browser.');
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

    new Notification(title, notificationOptions);
    console.log('Notification sent:', title, body);
  } else {
    console.warn('Notification not sent. Permission:', Notification.permission);
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