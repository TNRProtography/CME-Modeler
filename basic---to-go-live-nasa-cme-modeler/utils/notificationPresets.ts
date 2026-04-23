// utils/notificationPresets.ts
//
// Shared source of truth for notification "templates" (a.k.a. presets).
//
// Both the onboarding banner (shown to first-time users who haven't yet
// granted notification permission) and the Settings → Push Notifications
// screen use these. Keeping them in one file means the two surfaces can
// never drift out of sync — if you add a new preset here, both UIs pick
// it up automatically.

import type { OvernightMode } from './notifications';
import { trackPresetSelected, type PromptLocation } from './analytics';

export type PresetId = 'naked' | 'phone' | 'dslr' | 'everything' | 'custom';

export interface NotificationPreset {
  id: PresetId;
  emoji: string;
  title: string;
  tagline: string;
  description: string;
  /** Notification IDs that should be ENABLED when this preset is applied.
   *  All other IDs (except shocks, which are always off) are disabled. */
  prefs: string[];
  /** Overnight-watch mode paired with this preset. */
  overnightMode: OvernightMode;
}

/** Shock notifications are "coming soon" — always excluded from every
 *  preset's prefs list and forced off regardless of what's applied. */
export const SHOCK_IDS = new Set<string>([
  'shock-ff',
  'shock-sf',
  'shock-fr',
  'shock-sr',
  'shock-imf',
]);

export const NOTIFICATION_PRESETS: NotificationPreset[] = [
  {
    id: 'naked',
    emoji: '👁️',
    title: 'Naked-eye only',
    tagline: 'The big ones',
    description:
      'Minimal alerts — only when aurora should be visible to the naked eye from your location, plus very strong flares and announcements.',
    prefs: ['visibility-naked', 'overnight-watch', 'flare-X1', 'flare-X5', 'flare-X10', 'admin-broadcast'],
    overnightMode: 'eye',
  },
  {
    id: 'phone',
    emoji: '📱',
    title: 'Phone camera',
    tagline: 'A practical middle ground',
    description:
      'Alerts when aurora is bright enough for a phone camera or better, plus meaningful flare activity (M5+) and nightly watch.',
    prefs: ['visibility-phone', 'visibility-naked', 'overnight-watch', 'flare-M5', 'flare-X1', 'flare-X5', 'flare-X10', 'admin-broadcast'],
    overnightMode: 'phone',
  },
  {
    id: 'dslr',
    emoji: '📷',
    title: 'DSLR / early warning',
    tagline: 'Maximum lead time',
    description:
      'Catch aurora as soon as it becomes camera-detectable, with broader flare coverage (M1+). Best if you want time to drive somewhere dark.',
    prefs: ['visibility-dslr', 'visibility-phone', 'visibility-naked', 'overnight-watch', 'flare-M1', 'flare-M5', 'flare-X1', 'flare-X5', 'flare-X10', 'admin-broadcast'],
    overnightMode: 'camera',
  },
  {
    id: 'everything',
    emoji: '🔔',
    title: 'Everything',
    tagline: 'Full firehose',
    description:
      'Every alert we currently send — all visibility thresholds, all flare classes, and announcements. Best for enthusiasts who want nothing missed.',
    prefs: ['visibility-dslr', 'visibility-phone', 'visibility-naked', 'overnight-watch', 'flare-M1', 'flare-M5', 'flare-X1', 'flare-X5', 'flare-X10', 'admin-broadcast'],
    overnightMode: 'camera',
  },
  {
    id: 'custom',
    emoji: '⚙️',
    title: 'Custom',
    tagline: 'Pick individually',
    description: 'Skip the preset and choose each alert yourself.',
    prefs: [],
    overnightMode: 'phone',
  },
];

/** localStorage key: which preset (if any) did the user most recently pick? */
export const NOTIFICATION_TEMPLATE_KEY = 'sta_notification_template';

/**
 * Look up a preset by id. Returns `null` for 'custom' or unknown ids so
 * callers can easily branch on "is this an auto-apply preset or not".
 */
export function getPresetById(id: PresetId | null): NotificationPreset | null {
  if (!id || id === 'custom') return null;
  return NOTIFICATION_PRESETS.find(p => p.id === id) ?? null;
}

/**
 * Given the user's current preference map, work out which preset (if any)
 * it exactly matches. Used on Settings open so we can preselect the right
 * template when the user hasn't explicitly chosen one.
 *
 * - Ignores shock ids entirely (they're always off).
 * - An exact match means: every id in preset.prefs is enabled, and every
 *   other non-shock id is disabled.
 */
export function detectPresetFromPrefs(
  prefs: Record<string, boolean>,
): PresetId | null {
  // Try each non-custom preset; first exact match wins.
  for (const preset of NOTIFICATION_PRESETS) {
    if (preset.id === 'custom') continue;
    const presetSet = new Set(preset.prefs);
    let matches = true;
    for (const [id, enabled] of Object.entries(prefs)) {
      if (SHOCK_IDS.has(id)) continue;
      const shouldBeOn = presetSet.has(id);
      if (shouldBeOn !== !!enabled) { matches = false; break; }
    }
    if (matches) return preset.id;
  }
  return null;
}

/**
 * Persist the user's chosen preset AND fire an analytics event.
 *
 * Call this anywhere you'd otherwise write to NOTIFICATION_TEMPLATE_KEY
 * directly — it keeps both the banner and settings modal reporting
 * preset selections consistently. `is_first_setup` is derived from
 * whether a previous value exists, so the caller doesn't need to know.
 */
export function recordPresetSelection(
  presetId: PresetId,
  location: PromptLocation,
): void {
  let isFirstSetup = false;
  try {
    isFirstSetup = !localStorage.getItem(NOTIFICATION_TEMPLATE_KEY);
    localStorage.setItem(NOTIFICATION_TEMPLATE_KEY, presetId);
  } catch {
    /* no-op */
  }
  trackPresetSelected(presetId, isFirstSetup, location);
}