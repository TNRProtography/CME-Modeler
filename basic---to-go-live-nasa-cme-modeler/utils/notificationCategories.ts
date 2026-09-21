// utils/notificationCategories.ts
//
// THE source of truth for notification categories.
//
// Before this file, a topic id had to be written out correctly in five
// separate places - the worker's ALL_TOPICS, the app's NOTIFICATION_CATEGORIES,
// DEFAULT_ON_CATEGORIES, the settings screen's NOTIFICATION_GROUPS and the
// preset definitions - and nothing checked that they agreed. They did not:
//
//   shock-imf          the worker sends it; the app never offered it, so the
//                      preference was written false for everyone and the alert
//                      reached nobody at all
//   flare-event        live on the worker, default on, no toggle anywhere
//   flare-peak         same
//   substorm-forecast  same
//   aurora-*percent    the app still stores these; nothing sends them any more
//
// Every one of those was invisible. Declaring each topic once, here, with what
// sends it and whether a user can see it, makes that class of bug impossible
// to introduce silently - `npm run test:topics` fails the moment the worker
// and this file disagree.
//
// Adding a topic: add it here, run `npm run sync:topics` to update the
// worker's ALL_TOPICS, and give it a `ui` of 'toggle' unless you have a
// specific reason not to. A topic with no toggle is one no user can turn off.

export type CategoryGroup = 'visibility' | 'forecast' | 'solar' | 'announcements';

export type CategoryUi =
  /** Has a switch in Settings. The normal case. */
  | 'toggle'
  /** Live on the worker but with no switch. Users cannot opt out. */
  | 'hidden'
  /** Deliberately dormant - shown greyed out, forced off. */
  | 'coming-soon'
  /** Nothing sends this any more. Kept so old stored prefs still parse. */
  | 'retired';

export interface NotificationCategory {
  id: string;
  ui: CategoryUi;
  /** What a brand-new subscriber gets before touching anything. */
  defaultOn: boolean;
  /** Which worker detector emits it. 'nothing' means retired. Checked by the drift test. */
  sentBy: string;
  /** The full-colour image shown in the notification body. 192x192 or larger. */
  icon: string;
  /**
   * The small status-bar icon Android draws beside the clock. It is masked to
   * a silhouette, so it must be white-on-transparent - a colour image comes
   * out as a white blob. Defaults to the app mark.
   */
  badge?: string;
  group?: CategoryGroup;
  label?: string;
  description?: string;
  tooltip?: string;
  /** Anything a future reader needs to know about this topic's odd status. */
  note?: string;
}

/**
 * The status-bar badge, used for every category unless one overrides it.
 *
 * Android masks this to a silhouette and ignores colour entirely, so there is
 * little point drawing a different one per category - it is the app mark, and
 * it must be white shapes on transparency or it renders as a solid blob.
 */
export const DEFAULT_BADGE = '/icons/icon-badge.png';

export const CATEGORY_GROUPS: Record<CategoryGroup, { title: string; description: string }> = {
  visibility: {
    title: 'Aurora Visibility',
    description: 'Location-aware alerts sent when the aurora oval reaches your area. Requires GPS for accuracy.',
  },
  forecast: {
    title: 'Forecast',
    description: 'Advance planning alerts to help you prepare for a potential display tonight.',
  },
  solar: {
    title: 'Solar Events',
    description: 'Space weather events that may affect aurora conditions in the hours ahead.',
  },
  announcements: {
    title: 'Announcements',
    description: 'Direct messages from Spot The Aurora - aurora event alerts, tips, and important updates.',
  },
};

export const NOTIFICATION_CATEGORIES: NotificationCategory[] = [
  // ── Aurora visibility ────────────────────────────────────────────────────
  {
    id: 'visibility-dslr',
    ui: 'toggle', defaultOn: true, group: 'visibility',
    sentBy: 'checkVisibilityNotifications',
    icon: '/icons/icon-visibility-dslr.png',
    badge: '/icons/icon-badge-dslr.png',
    label: 'DSLR camera visible',
    description: 'Aurora detectable with a DSLR on a tripod - furthest early warning.',
    tooltip: 'The earliest warning - sent when aurora is just becoming detectable from your location using a DSLR camera on a tripod with a long exposure (5-15 seconds). This is the first sign conditions are developing toward something worth watching. Great if you want maximum lead time to get to a dark spot.',
  },
  {
    id: 'visibility-phone',
    ui: 'toggle', defaultOn: true, group: 'visibility',
    sentBy: 'checkVisibilityNotifications',
    icon: '/icons/icon-visibility-phone.png',
    badge: '/icons/icon-badge-phone.png',
    label: 'Phone camera visible',
    description: 'Aurora bright enough for a modern smartphone night mode.',
    tooltip: 'Sent when aurora is bright enough to show up on a modern smartphone camera using night mode. You may not see it with the naked eye yet, but pointing your phone south should reveal green or pink hues. A good middle-ground alert for most users.',
  },
  {
    id: 'visibility-naked',
    ui: 'toggle', defaultOn: true, group: 'visibility',
    sentBy: 'checkVisibilityNotifications',
    icon: '/icons/icon-visibility-naked.png',
    badge: '/icons/icon-badge-naked.png',
    label: 'Naked eye visible',
    description: 'Aurora visible to the naked eye from your location.',
    tooltip: 'Sent when aurora should be visible to the naked eye from your location - no camera needed. Go outside, look south, and you should see it directly. This is the strongest visibility threshold and the most exciting alert.',
  },

  // ── Forecast ─────────────────────────────────────────────────────────────
  {
    id: 'overnight-watch',
    ui: 'toggle', defaultOn: true, group: 'forecast',
    sentBy: 'checkOvernightWatch',
    icon: '/icons/icon-overnight-watch.png',
    badge: '/icons/icon-badge-moon.png',
    label: 'Worth watching tonight',
    description: 'Sent around sunset when solar wind conditions are elevated.',
    tooltip: 'Sent once per day around sunset (6-9 PM NZST) when solar wind conditions are elevated enough to be worth monitoring tonight. Includes Bz direction, solar wind speed, and moon illumination so you can decide whether to head out. Not sent on quiet nights.',
  },

  // ── Solar events ─────────────────────────────────────────────────────────
  {
    id: 'flare-M1',
    ui: 'toggle', defaultOn: true, group: 'solar',
    sentBy: 'checkSolarFlares',
    icon: '/icons/icon-flare-event.png',
    badge: '/icons/icon-badge-flare.png',
    label: 'Solar flare M1+',
    description: 'Early flare heads-up for moderate events and above.',
    tooltip: 'Sent when a flare reaches at least M1.0. This is the broadest flare alert and gives the earliest warning that activity is ramping up.',
  },
  {
    id: 'flare-M5',
    ui: 'toggle', defaultOn: true, group: 'solar',
    sentBy: 'checkSolarFlares',
    icon: '/icons/icon-flare-event.png',
    badge: '/icons/icon-badge-flare.png',
    label: 'Solar flare M5+',
    description: 'Stronger M-class flare threshold.',
    tooltip: 'Sent only when a flare reaches at least M5.0. Useful if you want fewer alerts and only stronger M-class events.',
  },
  {
    id: 'flare-X1',
    ui: 'toggle', defaultOn: true, group: 'solar',
    sentBy: 'checkSolarFlares',
    icon: '/icons/icon-flare-event.png',
    badge: '/icons/icon-badge-flare.png',
    label: 'Solar flare X1+',
    description: 'Major flare threshold.',
    tooltip: 'Sent when a flare reaches X1.0 or stronger. X-class flares are major events and often associated with significant space-weather impacts.',
  },
  {
    id: 'flare-X5',
    ui: 'toggle', defaultOn: true, group: 'solar',
    sentBy: 'checkSolarFlares',
    icon: '/icons/icon-flare-event.png',
    badge: '/icons/icon-badge-flare.png',
    label: 'Solar flare X5+',
    description: 'Extreme flare threshold.',
    tooltip: 'Sent only for very strong X5.0+ flares. High signal, very low noise.',
  },
  {
    id: 'flare-X10',
    ui: 'toggle', defaultOn: true, group: 'solar',
    sentBy: 'checkSolarFlares',
    icon: '/icons/icon-flare-event.png',
    badge: '/icons/icon-badge-flare.png',
    label: 'Solar flare X10+',
    description: 'Rare extreme-event threshold.',
    tooltip: 'Sent only for rare, exceptional X10+ flares. Best for users who only want top-tier extreme events.',
  },
  {
    id: 'cme-earth-directed',
    ui: 'toggle', defaultOn: true, group: 'solar',
    sentBy: 'checkEarthDirectedCMEs',
    icon: '/icons/icon-cme-sheath.png',
    badge: '/icons/icon-badge-shock.png',
    label: 'Earth-directed CME launched',
    description: 'A CME has left the Sun heading our way, above the speed you choose.',
    tooltip: 'Sent when NASA DONKI publishes a CME aimed within 45 degrees of the Sun-Earth line - the same test the app uses to colour a CME as Earth-directed - and its speed is at or above the threshold you set. Speeds are described as slow (below 500 km/s, usually a glancing effect), medium (500-800 km/s, which can still cause a good storm) or fast (above 800 km/s). This is the launch, not the arrival: a CME typically takes one to three days to cross, so treat it as a heads-up rather than a call to go outside. The shock alert is what tells you it has actually arrived.',
    note: 'Per-subscriber speed floor, stored as cme_speed_min on the subscription record rather than in the preference map.',
  },
  {
    id: 'shock-ff',
    ui: 'toggle', defaultOn: true, group: 'solar',
    sentBy: 'checkShockDetection',
    icon: '/icons/icon-shock-detection.png',
    badge: '/icons/icon-badge-shock.png',
    label: 'CME arrival - fast forward shock',
    description: 'A CME or solar wind stream has slammed into the L1 satellites. Aurora conditions may change within 45-60 minutes.',
    tooltip: 'A fast forward shock (FF) is the most common and impactful type of interplanetary shock. It happens when a fast-moving CME or solar wind stream ploughs into slower wind ahead of it, compressing everything - speed, density, temperature, and magnetic field all jump up simultaneously. This is the classic "CME has arrived" signature and is one of the most actionable alerts. Conditions on Earth can shift from quiet to active within an hour.',
  },

  // ── Announcements ────────────────────────────────────────────────────────
  {
    id: 'admin-broadcast',
    ui: 'toggle', defaultOn: true, group: 'announcements',
    sentBy: 'handleSendBroadcast',
    icon: '/icons/icon-default.png',
    label: 'Announcements',
    description: 'Occasional messages sent directly by Spot The Aurora about aurora events, tips, or updates.',
    tooltip: 'Occasional direct messages from the Spot The Aurora team - sent manually when there is something genuinely worth knowing. This might be a heads-up about an active aurora event happening right now, a tip about upcoming conditions, or an important app update. We send these sparingly, only when it matters.',
  },

  // ── Live, but with no switch ─────────────────────────────────────────────
  // These three are on for everyone and cannot be turned off from the app.
  // Left as they are on purpose; declared here so that stays a decision
  // somebody made rather than something nobody noticed.
  {
    id: 'flare-event',
    ui: 'hidden', defaultOn: true,
    sentBy: 'checkSolarFlares',
    icon: '/icons/icon-flare-event.png',
    badge: '/icons/icon-badge-flare.png',
    label: 'Solar flare summary',
    note: 'Sent once a flare has peaked. Turning off the M/X toggles does not turn this off - it has its own stored preference and no UI. The companion flare-peak notification does have a toggle, so anyone who wants only one notification per flare turns that one off.',
  },
  {
    id: 'flare-peak',
    ui: 'toggle', defaultOn: true, group: 'solar',
    sentBy: 'checkSolarFlares',
    icon: '/icons/icon-flare-peak.png',
    badge: '/icons/icon-badge-flare.png',
    label: 'Solar flare peaked',
    description: 'When a flare tops out and starts fading.',
    tooltip: 'Sent once a flare has clearly turned the corner - the X-ray flux has fallen for two readings in a row - and says what class it reached. This arrives alongside the flare summary, so turn it off if one notification per flare is enough.',
  },
  {
    id: 'substorm-forecast',
    ui: 'hidden', defaultOn: true,
    sentBy: 'checkSubstormActivity',
    icon: '/icons/icon-substorm.png',
    badge: '/icons/icon-badge-shock.png',
    label: 'Substorm expected',
    note: 'Only sent to subscribers whose latitude is in a plausible aurora zone. No toggle.',
  },
  {
    id: 'shock-imf',
    ui: 'hidden', defaultOn: false,
    sentBy: 'checkShockDetection',
    icon: '/icons/icon-shock-detection.png',
    badge: '/icons/icon-badge-shock.png',
    label: 'Sudden IMF shift',
    note: 'The worker can fire this, but it has never been offered in the app, so every stored preference is false and it reaches nobody. Give it a toggle or retire it - it should not stay in this state.',
  },

  // ── Deliberately dormant ─────────────────────────────────────────────────
  {
    id: 'shock-sf',
    ui: 'coming-soon', defaultOn: false, group: 'solar',
    sentBy: 'checkShockDetection',
    icon: '/icons/icon-shock-detection.png',
    badge: '/icons/icon-badge-shock.png',
    label: 'CME arrival - slow forward shock',
    description: 'Coming soon.',
  },
  {
    id: 'shock-fr',
    ui: 'coming-soon', defaultOn: false, group: 'solar',
    sentBy: 'checkShockDetection',
    icon: '/icons/icon-shock-detection.png',
    badge: '/icons/icon-badge-shock.png',
    label: 'CME arrival - fast reverse shock',
    description: 'Coming soon.',
  },
  {
    id: 'shock-sr',
    ui: 'coming-soon', defaultOn: false, group: 'solar',
    sentBy: 'checkShockDetection',
    icon: '/icons/icon-shock-detection.png',
    badge: '/icons/icon-badge-shock.png',
    label: 'CME arrival - slow reverse shock',
    description: 'Coming soon.',
  },

  // ── Retired ──────────────────────────────────────────────────────────────
  // Nothing on the worker sends these. Kept so preferences saved by old app
  // versions still round-trip instead of being dropped on the floor.
  { id: 'aurora-40percent', ui: 'retired', defaultOn: true, sentBy: 'nothing', icon: '/icons/icon_aurora.png' },
  { id: 'aurora-50percent', ui: 'retired', defaultOn: true, sentBy: 'nothing', icon: '/icons/icon_aurora.png' },
  { id: 'aurora-60percent', ui: 'retired', defaultOn: true, sentBy: 'nothing', icon: '/icons/icon_aurora.png' },
  { id: 'aurora-80percent', ui: 'retired', defaultOn: true, sentBy: 'nothing', icon: '/icons/icon_aurora.png' },
];

// ── Derived views ──────────────────────────────────────────────────────────
// Everything downstream reads one of these rather than writing its own list.

const byId = new Map(NOTIFICATION_CATEGORIES.map(c => [c.id, c]));

export const getCategory = (id: string): NotificationCategory | undefined => byId.get(id);

/** Every id we know about, retired ones included. */
export const ALL_CATEGORY_IDS: string[] = NOTIFICATION_CATEGORIES.map(c => c.id);

/** Ids the worker may actually send. This is what ALL_TOPICS is generated from. */
export const LIVE_TOPIC_IDS: string[] = NOTIFICATION_CATEGORIES
  .filter(c => c.ui !== 'retired')
  .map(c => c.id);

/** Ids a user can see and control. */
export const TOGGLEABLE_IDS: string[] = NOTIFICATION_CATEGORIES
  .filter(c => c.ui === 'toggle')
  .map(c => c.id);

/** Shown greyed out and forced off. */
export const COMING_SOON_IDS: Set<string> = new Set(
  NOTIFICATION_CATEGORIES.filter(c => c.ui === 'coming-soon').map(c => c.id),
);

/** Live but with no switch - on for everyone, no way to opt out. */
export const HIDDEN_IDS: Set<string> = new Set(
  NOTIFICATION_CATEGORIES.filter(c => c.ui === 'hidden').map(c => c.id),
);

/** What a brand-new subscriber gets. */
export const DEFAULT_ON_IDS: Set<string> = new Set(
  NOTIFICATION_CATEGORIES.filter(c => c.defaultOn).map(c => c.id),
);

/** Mirrors the icon map the service worker uses to pick a notification icon. */
export const TOPIC_ICONS: Record<string, string> = Object.fromEntries(
  NOTIFICATION_CATEGORIES.map(c => [c.id, c.icon]),
);

/** The status-bar badge per topic. */
export const TOPIC_BADGES: Record<string, string> = Object.fromEntries(
  NOTIFICATION_CATEGORIES.map(c => [c.id, c.badge ?? DEFAULT_BADGE]),
);

/**
 * The settings screen's sections, in display order.
 *
 * Toggles only. The coming-soon shocks carry a group so they are easy to slot
 * in when they go live, but they are not rendered today - showing three greyed
 * out rows that never do anything is worse than not showing them.
 */
export const GROUPED_FOR_UI = (['visibility', 'forecast', 'solar', 'announcements'] as CategoryGroup[])
  .map(group => ({
    group,
    title: CATEGORY_GROUPS[group].title,
    description: CATEGORY_GROUPS[group].description,
    items: NOTIFICATION_CATEGORIES.filter(c => c.group === group && c.ui === 'toggle'),
  }))
  .filter(g => g.items.length > 0);
