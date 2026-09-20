/**
 * Service worker registration, and the update discipline around it.
 *
 * Registering is the easy half. The half that has bitten this app is what
 * happens *afterwards*: a browser only checks for a new /sw.js when a page in
 * scope navigates, and an installed PWA that someone leaves open on a windowsill
 * all night never navigates. So the version that was current when the app was
 * opened is the version that stays, for as long as the session lasts - which for
 * this app can be days.
 *
 * Three things close that:
 *
 *   1. Ask for an update check on a timer, when the tab comes back to the
 *      foreground, and when the network returns. Those are the moments a device
 *      has both a reason and the connectivity to notice a new build.
 *   2. Push a waiting worker through with SKIP_WAITING. sw.js already calls
 *      skipWaiting() itself, so this should never be needed - but "should never
 *      be needed" is how a worker ends up waiting behind a tab forever, and the
 *      message costs nothing.
 *   3. Reload the page once the new worker takes control, so the running app and
 *      the worker controlling it are from the same build. The reload waits until
 *      the page is hidden, so nobody loses a half-typed report or a camera view
 *      to it.
 *
 * None of this caches anything or serves anything - sw.js has no fetch handler.
 * The app's own assets are versioned by Vite's content hashes and governed by
 * public/_headers, and that is deliberately the only thing deciding what HTML
 * and JS a device runs.
 */

/** How often to ask the browser to re-check /sw.js during a long session. */
const UPDATE_INTERVAL_MS = 30 * 60 * 1000;

/** Don't re-check more than once a minute, however many events arrive at once. */
const MIN_CHECK_GAP_MS = 60 * 1000;

let lastCheck = 0;
let reloadPending = false;

/** The version sw.js last reported, for the debug panel. */
export let activeServiceWorkerVersion: string | null = null;

function checkForUpdate(reg: ServiceWorkerRegistration, why: string): void {
  const now = Date.now();
  if (now - lastCheck < MIN_CHECK_GAP_MS) return;
  lastCheck = now;
  reg.update().catch((err) => {
    // Offline, or the request failed. Not worth surfacing - the next trigger
    // will try again.
    console.debug(`[SW] Update check (${why}) failed:`, err);
  });
}

/**
 * Reload so the page and its controller are the same build.
 *
 * Only once, and only while the page is out of sight. A hidden page reloading
 * is invisible; a visible one reloading under someone's hands is the kind of
 * thing that makes an app feel broken, and there is nothing urgent enough here
 * to justify it - the new worker is already in charge either way.
 */
function reloadWhenHidden(): void {
  if (reloadPending) return;
  reloadPending = true;

  if (document.visibilityState === 'hidden') {
    window.location.reload();
    return;
  }
  const onHide = () => {
    if (document.visibilityState === 'hidden') {
      document.removeEventListener('visibilitychange', onHide);
      window.location.reload();
    }
  };
  document.addEventListener('visibilitychange', onHide);
}

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) {
    console.log('[SW] Not supported in this browser.');
    return;
  }

  // Whether anything was already controlling this page when it loaded. On a
  // first-ever visit there is no controller, and sw.js's clients.claim() will
  // fire controllerchange for the very first worker - which is not an update
  // and must not trigger a reload.
  const hadController = !!navigator.serviceWorker.controller;

  navigator.serviceWorker.addEventListener('message', (event) => {
    const data = event.data;
    if (data?.type === 'SW_ACTIVATED' || data?.type === 'SW_VERSION') {
      activeServiceWorkerVersion = data.version ?? null;
      console.log('[SW] Active version:', activeServiceWorkerVersion);
    }
  });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) {
      console.log('[SW] First worker took control.');
      return;
    }
    console.log('[SW] A new version took control; reloading when the page is next hidden.');
    reloadWhenHidden();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then((reg) => {
        console.log('[SW] Registered. Scope:', reg.scope, 'State:', reg.active?.state ?? 'installing');

        // Ask the controller what it is. If the answer is an old version, that
        // is now visible in the console rather than being guessed at.
        navigator.serviceWorker.controller?.postMessage({ type: 'GET_VERSION' });

        // A worker already sitting in `waiting` means a previous session
        // downloaded an update and never got to use it. Push it through.
        if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });

        reg.addEventListener('updatefound', () => {
          const installing = reg.installing;
          if (!installing) return;
          console.log('[SW] New version downloading.');
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && reg.waiting) {
              reg.waiting.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });

        // Check now - registering an unchanged worker does not itself do this
        // reliably across browsers - and then on the three triggers that mean a
        // long-lived session has a reason to look again.
        checkForUpdate(reg, 'startup');
        window.setInterval(() => checkForUpdate(reg, 'timer'), UPDATE_INTERVAL_MS);
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') checkForUpdate(reg, 'foreground');
        });
        window.addEventListener('online', () => checkForUpdate(reg, 'online'));
      })
      .catch((err) => {
        console.error('[SW] Registration failed:', err);
      });
  });
}

/**
 * Ask the controlling worker which version it is.
 *
 * Resolves to null if nothing is controlling the page, or if the worker does
 * not answer - which is itself the answer, because a version old enough to
 * predate the message handler is exactly the one worth knowing about.
 */
export function getServiceWorkerVersion(timeoutMs = 2000): Promise<string | null> {
  return new Promise((resolve) => {
    const sw = navigator.serviceWorker?.controller;
    if (!sw) { resolve(null); return; }

    const channel = new MessageChannel();
    const timer = window.setTimeout(() => resolve(activeServiceWorkerVersion ?? 'pre-2.3.0'), timeoutMs);
    channel.port1.onmessage = (event) => {
      window.clearTimeout(timer);
      const version = event.data?.version ?? null;
      if (version) activeServiceWorkerVersion = version;
      resolve(version);
    };
    try {
      sw.postMessage({ type: 'GET_VERSION' }, [channel.port2]);
    } catch {
      window.clearTimeout(timer);
      resolve(null);
    }
  });
}
