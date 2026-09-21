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
