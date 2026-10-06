// One-time announcements for people who already had the app.
//
// A new notification category reaches existing subscribers in one of two ways.
// Either the worker's preference fill-in turns it on for them - which it only
// does for keys nobody has set, so it cannot override a choice - or they turn
// it on themselves, which they can only do if they know it exists.
//
// This is the second half. It shows once per device, to people who already
// have notifications set up, and it exists because the alternative considered
// was flipping a stored `false` to `true` on everyone's behalf. Telling people
// and letting them choose is the honest version of that.

/**
 * Bump this when there is something new worth interrupting someone for.
 *
 * The value is the storage key, so a new id shows the announcement again to
 * everybody. That is the point - but it is also why this should change rarely.
 */
export const WHATS_NEW_ID = 'whats_new_seen_2026_09_cme_alerts';

export function hasSeenWhatsNew(): boolean {
  try {
    return localStorage.getItem(WHATS_NEW_ID) === '1';
  } catch {
    // Private mode, blocked storage. Treat as seen rather than showing it on
    // every single load - an announcement that will not stay dismissed is
    // worse than one that is missed.
    return true;
  }
}

export function markWhatsNewSeen(): void {
  try {
    localStorage.setItem(WHATS_NEW_ID, '1');
  } catch {
    /* nothing to do - see above */
  }
}

/**
 * Whether to show the announcement on this load.
 *
 * Only to people who already have a push subscription. Someone who has never
 * turned notifications on does not need to hear about two new kinds of them -
 * the onboarding banner is their path in, and a brand-new subscriber gets
 * both of these on by default anyway. Showing it to them would be an
 * interruption that asks nothing of them.
 */
export async function shouldShowWhatsNew(): Promise<boolean> {
  if (hasSeenWhatsNew()) return false;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return !!sub;
  } catch {
    return false;
  }
}

// ── Release notes: what changed in this version, once, for people who used
// the version before ─────────────────────────────────────────────────────────

/** Bump with each release that has notes worth showing. */
export const RELEASE_ID = 'v2.0';
const RELEASE_SEEN_KEY = 'sta_release_notes_seen';

/**
 * Whether this browser had used the app before this version. Read once, when
 * the app starts, because starting the app writes some of these keys itself
 * (and removes the old page-view count once the server has it).
 */
const usedBefore: boolean = (() => {
  try {
    const keys = ['hasSeenNavigationTutorial_v1', 'hasSeenCmeTutorial_v1', 'sta_page_view_lifetime_v1',
      'sta_page_view_events_v1', 'sta_default_main_page', 'sta_default_forecast_view', WHATS_NEW_ID];
    if (keys.some((k) => localStorage.getItem(k) != null)) return true;
    for (let i = 0; i < localStorage.length; i++) {
      if ((localStorage.key(i) ?? '').startsWith('notification_pref_')) return true;
    }
    return false;
  } catch {
    return false;
  }
})();

function releaseSeen(): boolean {
  try { return localStorage.getItem(RELEASE_SEEN_KEY) === RELEASE_ID; } catch { return true; }
}

export function markReleaseSeen(): void {
  try { localStorage.setItem(RELEASE_SEEN_KEY, RELEASE_ID); } catch { /* blocked */ }
}

/**
 * Show the release notes on this load? Only to someone who used an earlier
 * version and has not seen these notes. Someone new is marked as having seen
 * them: they get the full tutorial instead, and everything is new to them.
 * `?whats-new` on the address shows them regardless, for a look.
 */
export function shouldShowReleaseNotes(): boolean {
  try { if (/[?&]whats-new\b/.test(window.location.search)) return true; } catch { /* no window */ }
  if (releaseSeen()) return false;
  if (!usedBefore) { markReleaseSeen(); return false; }
  return true;
}
