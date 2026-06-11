// utils/analytics.ts
//
// Thin wrapper around gtag.js — lives at the utility layer so analytics calls
// sit next to the business logic that owns them, not in UI components.
//
// Rules:
//  - All gtag access goes through `trackEvent`. Never call gtag directly from
//    elsewhere in the codebase.
//  - Failures are silent. Analytics must never break the app.
//  - No PII. Never pass subscription endpoints, GPS coords, or user-typed text.

type GtagFn = (command: 'event', action: string, params?: Record<string, unknown>) => void;

declare global {
  interface Window {
    gtag?: GtagFn;
    dataLayer?: unknown[];
  }
}

const DEBUG = (() => {
  try {
    return localStorage.getItem('debug_analytics') === '1';
  } catch {
    return false;
  }
})();

/**
 * Fire a GA4 event. Safe to call before gtag loads (queues onto dataLayer).
 * Never throws.
 */
export const trackEvent = (eventName: string, params?: Record<string, unknown>): void => {
  try {
    if (typeof window === 'undefined') return;

    if (typeof window.gtag === 'function') {
      window.gtag('event', eventName, params);
    } else if (Array.isArray(window.dataLayer)) {
      // Fallback: queue for when gtag loads
      window.dataLayer.push(['event', eventName, params]);
    }

    if (DEBUG) {
      console.log('[analytics]', eventName, params);
    }
  } catch (e) {
    if (DEBUG) console.warn('[analytics] trackEvent failed:', e);
  }
};

/**
 * Track a feature-usage event. Thin wrapper over trackEvent that exists to
 * make call sites read clearly ("trackFeatureUsage('cme_viz_opened_controls')").
 * Prefer this for any app-level event that isn't notification-specific.
 */
export const trackFeatureUsage = (
  eventName: string,
  params?: Record<string, unknown>,
): void => {
  trackEvent(eventName, params);
};

// --- Notification-specific events ------------------------------------------

export type PromptLocation = 'onboarding_banner' | 'settings_modal' | 'unknown';
export type PermissionState = 'granted' | 'denied' | 'default' | 'unsupported';
export type PresetId = 'naked' | 'phone' | 'dslr' | 'everything' | 'custom';
export type DisableMethod =
  | 'preset_changed'
  | 'category_toggled_off'
  | 'all_categories_off'
  | 'permission_revoked';

/** Fired when we actually show the OS permission prompt. Your denominator. */
export const trackPermissionPromptShown = (location: PromptLocation): void => {
  trackEvent('notification_prompt_shown', { prompt_location: location });
};

/** Fired with the result of a permission request. The real opt-in metric. */
export const trackPermissionResult = (
  state: PermissionState,
  location: PromptLocation,
): void => {
  trackEvent('notification_permission_result', {
    permission_state: state,
    prompt_location: location,
  });
};

/**
 * Fired when a user picks a preset (naked / phone / dslr / everything / custom).
 * `isFirstSetup` distinguishes "chose on signup" from "changed later".
 */
export const trackPresetSelected = (
  preset: PresetId,
  isFirstSetup: boolean,
  location: PromptLocation,
): void => {
  trackEvent('notification_preset_selected', {
    preset,
    is_first_setup: isFirstSetup,
    prompt_location: location,
  });
};

/**
 * Fired when a user disables notifications (any method).
 * `daysSinceEnabled` tells us how long they stuck with it before turning off.
 */
export const trackNotificationDisabled = (
  method: DisableMethod,
  daysSinceEnabled: number | null,
): void => {
  trackEvent('notification_disabled', {
    disable_method: method,
    days_since_enabled: daysSinceEnabled ?? -1, // -1 = unknown
  });
};

/** Fired on successful push subscription creation. Confirms the full flow worked. */
export const trackSubscriptionCreated = (location: PromptLocation): void => {
  trackEvent('notification_subscribed', { prompt_location: location });
};

// --- Page / navigation events ----------------------------------------------

export type MainPage = 'forecast' | 'solar-activity' | 'modeler';

/** Fired whenever the main page changes. Skips repeats of the same page. */
export const trackPageView = (page: MainPage, slug: string | null): void => {
  const eventMap: Record<MainPage, string> = {
    'forecast': 'page_view_forecast',
    'solar-activity': 'page_view_solar_dashboard',
    'modeler': 'page_view_cme_viz',
  };
  trackEvent(eventMap[page], slug ? { slug } : undefined);
};

export const trackForecastViewSwitched = (
  from: 'simple' | 'advanced',
  to: 'simple' | 'advanced',
): void => {
  trackEvent('forecast_view_switched', { from, to });
};

/** Modeler (CME viz) overlay opened — one event, slug param identifies which. */
export const trackCmeVizOverlayOpened = (slug: string): void => {
  // Map common slugs to specific events for easier GA4 dashboards, fall back
  // to a generic event+slug for everything else.
  const known: Record<string, string> = {
    'controls-panel':       'cme_viz_opened_controls',
    'cme-list':             'cme_viz_opened_cme_list',
    'forecast-models':      'cme_viz_opened_forecast_models',
    'impact-graph':         'cme_viz_opened_impact_graph',
    'solar-surfer-game':    'solar_surfer_game_opened',
    'first-visit-tutorial': 'first_visit_tutorial_started',
    'cme-modeler-tutorial': 'cme_modeler_tutorial_opened',
  };
  const eventName = known[slug] ?? 'cme_viz_overlay_opened';
  trackEvent(eventName, eventName === 'cme_viz_overlay_opened' ? { slug } : undefined);
};

/** Solar dashboard modal opened — one event per session, slug varies. */
export const trackSolarDashboardModalOpened = (slug: string): void => {
  trackEvent('solar_dashboard_modal_opened', { slug });
};

export const trackTutorialOpened = (): void => {
  trackEvent('tutorial_opened');
};

export const trackSettingsOpened = (): void => {
  trackEvent('settings_opened');
};

// --- Tutorial / onboarding flow -------------------------------------------

export const trackFirstVisitTutorialCompleted = (): void => {
  trackEvent('first_visit_tutorial_completed');
};

export const trackFirstVisitTutorialSkipped = (step: number, totalSteps: number): void => {
  trackEvent('first_visit_tutorial_skipped', { step, total_steps: totalSteps });
};

export const trackOnboardingBannerShown = (): void => {
  trackEvent('onboarding_banner_shown');
};

export const trackOnboardingBannerDismissed = (): void => {
  trackEvent('onboarding_banner_dismissed');
};

// --- CME Visualization interactions ---------------------------------------

export type CmeVizToggle =
  | 'labels'
  | 'extra_planets'
  | 'moon_l1'
  | 'flux_rope'
  | 'hss';

export const trackCmeVizToggle = (toggle: CmeVizToggle, enabled: boolean): void => {
  trackEvent('cme_viz_toggle_changed', { toggle, enabled });
};

export const trackCmeVizViewChanged = (view: string): void => {
  trackEvent('cme_viz_view_changed', { view });
};

export const trackCmeVizFocusChanged = (focus: string): void => {
  trackEvent('cme_viz_focus_changed', { focus });
};

export const trackCmeVizDateRangeChanged = (range: string): void => {
  trackEvent('cme_viz_date_range_changed', { range });
};

export const trackCmeVizFilterChanged = (filter: string): void => {
  trackEvent('cme_viz_filter_changed', { filter });
};

export const trackCmeSelected = (): void => {
  // Don't pass CME id — they rotate quickly and add no value as a dimension.
  trackEvent('cme_viz_cme_selected');
};

export const trackCmeUrlShared = (): void => {
  trackEvent('cme_viz_url_shared');
};

// --- Sighting reports -----------------------------------------------------

export type SightingStatus = string;

export const trackSightingSubmitted = (status: SightingStatus): void => {
  trackEvent('sighting_submitted', { status });
};

export const trackSightingSubmitFailed = (reason: string): void => {
  trackEvent('sighting_submit_failed', { reason });
};

// --- PWA install ----------------------------------------------------------

export const trackPwaInstallPrompted = (): void => {
  trackEvent('pwa_install_prompted');
};

export const trackPwaInstalled = (): void => {
  trackEvent('pwa_installed');
};

// --- Settings changes (sparse — only things worth knowing) ----------------

export const trackDefaultPageChanged = (page: MainPage): void => {
  trackEvent('default_page_changed', { page });
};

// --- Enabled-timestamp helpers (for days_since_enabled calculation) --------

const ENABLED_AT_KEY = 'sta_notifications_enabled_at';

export const markNotificationsEnabled = (): void => {
  try {
    // Only set if not already set — we want first-enable time, not last.
    if (!localStorage.getItem(ENABLED_AT_KEY)) {
      localStorage.setItem(ENABLED_AT_KEY, String(Date.now()));
    }
  } catch {
    /* no-op */
  }
};

export const getDaysSinceEnabled = (): number | null => {
  try {
    const raw = localStorage.getItem(ENABLED_AT_KEY);
    if (!raw) return null;
    const enabledAt = Number(raw);
    if (!Number.isFinite(enabledAt)) return null;
    const ms = Date.now() - enabledAt;
    return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
  } catch {
    return null;
  }
};

export const clearNotificationsEnabledMarker = (): void => {
  try {
    localStorage.removeItem(ENABLED_AT_KEY);
  } catch {
    /* no-op */
  }
};