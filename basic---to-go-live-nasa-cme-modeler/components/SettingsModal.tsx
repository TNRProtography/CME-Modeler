// --- START OF FILE src/components/SettingsModal.tsx ---

import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import CloseIcon from './icons/CloseIcon';
import ToggleSwitch from './ToggleSwitch';
import {
  getNotificationPreference,
  setNotificationPreference,
  getOvernightMode,
  setOvernightMode,
  type OvernightMode,
  requestNotificationPermission,
  sendTestNotification,
  sendServerSelfTest,
  subscribeUserToPush,
  updatePushSubscriptionPreferences // IMPORT THE NEW FUNCTION
} from '../utils/notifications.ts';
import { PageViewStats } from '../utils/pageViews';
import {
  NOTIFICATION_PRESETS,
  NOTIFICATION_TEMPLATE_KEY,
  detectPresetFromPrefs,
  getPresetById,
  recordPresetSelection,
} from '../utils/notificationPresets';
import type { PresetId } from '../utils/notificationPresets';

interface InfoModalProps { isOpen: boolean; onClose: () => void; title: string; content: string | React.ReactNode; }
const InfoModal: React.FC<InfoModalProps> = ({ isOpen, onClose, title, content }) => {
  if (!isOpen) return null;
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[9999] flex justify-center items-center p-4" onClick={onClose}>
      <div className="relative bg-neutral-950/95 border border-neutral-800/90 rounded-lg shadow-2xl w-full max-w-lg max-h-[85vh] text-neutral-300 flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center p-4 border-b border-neutral-700/80">
          <h3 className="text-xl font-bold text-neutral-200">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-full text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"><CloseIcon className="w-6 h-6" /></button>
        </div>
        <div className="overflow-y-auto p-5 styled-scrollbar pr-4 text-sm leading-relaxed">
          {typeof content === 'string' ? (<div dangerouslySetInnerHTML={{ __html: content }} />) : (content)}
        </div>
      </div>
    </div>,
    document.body
  );
};

// ── IndexedDB notification history ───────────────────────────────────────────
interface NotificationHistoryEntry {
  id: number;
  title: string;
  body: string;
  tag: string;
  timestamp: number;
  url: string;
  category: string;
}

async function openNotificationDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('sta-notifications', 1);
    req.onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result);
    req.onerror   = (e) => reject((e.target as IDBOpenDBRequest).error);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('history')) {
        const store = db.createObjectStore('history', { keyPath: 'id', autoIncrement: true });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
  });
}

async function getNotificationHistory(): Promise<NotificationHistoryEntry[]> {
  try {
    const db = await openNotificationDb();
    return new Promise((resolve, reject) => {
      const tx    = db.transaction('history', 'readonly');
      const store = tx.objectStore('history');
      const req   = store.index('timestamp').getAll();
      req.onsuccess = () => { db.close(); resolve((req.result as NotificationHistoryEntry[]).reverse()); };
      req.onerror   = () => { db.close(); reject(req.error); };
    });
  } catch { return []; }
}

async function clearNotificationHistory(): Promise<void> {
  try {
    const db = await openNotificationDb();
    await new Promise<void>((resolve, reject) => {
      const tx  = db.transaction('history', 'readwrite');
      const req = tx.objectStore('history').clear();
      req.onsuccess = () => { db.close(); resolve(); };
      req.onerror   = () => { db.close(); reject(req.error); };
    });
  } catch { /* silent */ }
}

async function deleteNotificationEntry(id: number): Promise<void> {
  try {
    const db = await openNotificationDb();
    await new Promise<void>((resolve, reject) => {
      const tx  = db.transaction('history', 'readwrite');
      const req = tx.objectStore('history').delete(id);
      req.onsuccess = () => { db.close(); resolve(); };
      req.onerror   = () => { db.close(); reject(req.error); };
    });
  } catch { /* silent */ }
}

function formatHistoryTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - ts;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 2)   return 'Just now';
  if (diffMins < 60)  return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7)   return `${diffDays}d ago`;
  return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', timeZone: 'Pacific/Auckland' });
}

const CATEGORY_EMOJI: Record<string, string> = {
  'visibility-naked':  '👁️',
  'visibility-phone':  '📱',
  'visibility-dslr':   '📷',
  'overnight-watch':   '🌌',
  'flare-event':       '☀️',
  'flare-M1':          '☀️',
  'flare-M5':          '☀️',
  'flare-X1':          '☀️',
  'flare-X5':          '☀️',
  'flare-X10':         '☀️',
  'flare-peak':        '☀️',
  'shock-ff':          '💥',
  'shock-sf':          '💥',
  'shock-fr':          '💥',
  'shock-sr':          '💥',
  'shock-imf':         '🧲',
  'substorm-forecast': '⚡',
  'admin-broadcast':   '📢',
};
const AURORA_RE = /^aurora-(\d+)percent$/;

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  appVersion: string;
  onOpenDocumentation?: () => void;
  onShowTutorial: () => void;
  defaultMainPage: 'forecast' | 'solar-activity' | 'modeler';
  defaultForecastView: 'simple' | 'advanced';
  onDefaultMainPageChange: (page: 'forecast' | 'solar-activity' | 'modeler') => void;
  onDefaultForecastViewChange: (view: 'simple' | 'advanced') => void;
  pageViewStats: PageViewStats;
  pageViewStorageMode: 'server' | 'local';
}

const SHOCK_NOTIFICATION_IDS = new Set(['shock-ff', 'shock-sf', 'shock-fr', 'shock-sr', 'shock-imf']);

// Notification categories shown in the UI — grouped for clarity.
// Legacy topic IDs (aurora-Xpercent, substorm-forecast etc) are intentionally
// NOT shown here — they still run on the worker but users manage them by
// turning off the new equivalent notifications instead.
const NOTIFICATION_GROUPS = [
  {
    group: 'Aurora Visibility',
    description: 'Location-aware alerts sent when the aurora oval reaches your area. Requires GPS for accuracy.',
    items: [
      {
        id: 'visibility-dslr',
        label: 'DSLR camera visible',
        description: 'Aurora detectable with a DSLR on a tripod — furthest early warning.',
        tooltip: 'The earliest warning — sent when aurora is just becoming detectable from your location using a DSLR camera on a tripod with a long exposure (5–15 seconds). This is the first sign conditions are developing toward something worth watching. Great if you want maximum lead time to get to a dark spot.',
      },
      {
        id: 'visibility-phone',
        label: 'Phone camera visible',
        description: 'Aurora bright enough for a modern smartphone night mode.',
        tooltip: 'Sent when aurora is bright enough to show up on a modern smartphone camera using night mode. You may not see it with the naked eye yet, but pointing your phone south should reveal green or pink hues. A good middle-ground alert for most users.',
      },
      {
        id: 'visibility-naked',
        label: 'Naked eye visible',
        description: 'Aurora visible to the naked eye from your location.',
        tooltip: 'Sent when aurora should be visible to the naked eye from your location — no camera needed. Go outside, look south, and you should see it directly. This is the strongest visibility threshold and the most exciting alert.',
      },
    ],
  },
  {
    group: 'Forecast',
    description: 'Advance planning alerts to help you prepare for a potential display tonight.',
    items: [
      {
        id: 'overnight-watch',
        label: 'Worth watching tonight',
        description: 'Sent around sunset when solar wind conditions are elevated.',
        tooltip: 'Sent once per day around sunset (6–9 PM NZST) when solar wind conditions are elevated enough to be worth monitoring tonight. Includes Bz direction, solar wind speed, and moon illumination so you can decide whether to head out. Not sent on quiet nights.',
      },
    ],
  },
  {
    group: 'Solar Events',
    description: 'Space weather events that may affect aurora conditions in the hours ahead.',
    items: [
      {
        id: 'flare-M1',
        label: 'Solar flare M1+',
        description: 'Early flare heads-up for moderate events and above.',
        tooltip: 'Sent when a flare reaches at least M1.0. This is the broadest flare alert and gives the earliest warning that activity is ramping up.',
      },
      {
        id: 'flare-M5',
        label: 'Solar flare M5+',
        description: 'Stronger M-class flare threshold.',
        tooltip: 'Sent only when a flare reaches at least M5.0. Useful if you want fewer alerts and only stronger M-class events.',
      },
      {
        id: 'flare-X1',
        label: 'Solar flare X1+',
        description: 'Major flare threshold.',
        tooltip: 'Sent when a flare reaches X1.0 or stronger. X-class flares are major events and often associated with significant space-weather impacts.',
      },
      {
        id: 'flare-X5',
        label: 'Solar flare X5+',
        description: 'Extreme flare threshold.',
        tooltip: 'Sent only for very strong X5.0+ flares. High signal, very low noise.',
      },
      {
        id: 'flare-X10',
        label: 'Solar flare X10+',
        description: 'Rare extreme-event threshold.',
        tooltip: 'Sent only for rare, exceptional X10+ flares. Best for users who only want top-tier extreme events.',
      },
      {
        id: 'shock-ff',
        label: 'Fast forward shock — CME hit the satellites',
        description: 'A CME or solar wind stream has slammed into the L1 satellites. Aurora conditions may change within 45–60 minutes.',
        tooltip: 'A fast forward shock (FF) is the most common and impactful type of interplanetary shock. It happens when a fast-moving CME or solar wind stream ploughs into slower wind ahead of it, compressing everything — speed, density, temperature, and magnetic field all jump up simultaneously. This is the classic "CME has arrived" signature and is one of the most actionable alerts. Conditions on Earth can shift from quiet to active within an hour.',
      },
      {
        id: 'shock-sf',
        label: 'Slow forward shock — compression wave arriving',
        description: 'A gentler compression wave has been detected. Speed and density are rising but the magnetic field dipped — often a SIR or weak CME edge.',
        tooltip: 'A slow forward shock (SF) is a compression where speed, density, and temperature all increase, but the magnetic field strength drops across the shock boundary. This often marks the leading edge of a stream interaction region (SIR) or a weak CME flank. It can still enhance aurora conditions, but usually less dramatically than a fast forward shock.',
      },
      {
        id: 'shock-fr',
        label: 'Fast reverse shock — CME trailing edge passing',
        description: 'The back end of a CME or high-speed stream is sweeping past. Density and temperature are dropping while speed is still elevated.',
        tooltip: 'A fast reverse shock (FR) occurs at the trailing edge of a CME or high-speed solar wind stream as it outruns the slower wind behind it. Density, temperature, and magnetic field all drop, but speed remains elevated. This usually means the strongest part of the event has passed, but residual aurora activity can continue for hours.',
      },
      {
        id: 'shock-sr',
        label: 'Slow reverse shock — trailing rarefaction',
        description: 'A rarefaction wave is passing — density and temperature falling with a magnetic field uptick. The tail end of a solar wind event.',
        tooltip: 'A slow reverse shock (SR) is a rarefaction where density and temperature decrease, speed stays up, but the magnetic field actually increases across the boundary. This is relatively uncommon and typically marks the very tail end of a complex solar wind structure. Aurora activity is usually winding down by this point.',
      },
      {
        id: 'shock-imf',
        label: 'IMF shift — magnetic field changed suddenly',
        description: 'A sharp change in the interplanetary magnetic field without a major plasma shock. Can swing aurora conditions quickly.',
        tooltip: 'An IMF enhancement or discontinuity is a sudden, large shift in the magnetic field (Bt or Bz) without the corresponding plasma jumps you see in a true shock. These can be sector boundary crossings, current sheet encounters, or magnetic structures embedded in the solar wind. If Bz swings strongly southward, aurora activity can ramp up quickly — even without a speed or density increase.',
      },
    ],
  },
  {
    group: 'Announcements',
    description: 'Direct messages from Spot The Aurora — aurora event alerts, tips, and important updates.',
    items: [
      { id: 'admin-broadcast', label: 'Announcements', description: 'Occasional messages sent directly by Spot The Aurora about aurora events, tips, or updates.', tooltip: 'Occasional direct messages from the Spot The Aurora team — sent manually when there is something genuinely worth knowing. This might be a heads-up about an active aurora event happening right now, a tip about upcoming conditions, or an important app update. We send these sparingly, only when it matters.' },
    ],
  },
];

// Flat list for preference loading
const ALL_NOTIFICATION_IDS = NOTIFICATION_GROUPS.flatMap(g => g.items.map(i => i.id));

const LOCATION_PREF_KEY = 'location_preference_use_gps_autodetect';

// --- Local Icon Components for this file ---
const GuideIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
  </svg>
);

const MailIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
  </svg>
);

const DownloadIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
  </svg>
);

const HeartIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.015-4.5-4.5-4.5S12 5.765 12 8.25c0-2.485-2.015-4.5-4.5-4.5S3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
    </svg>
);

// ── Tooltip helpers (module scope — avoids TypeScript inference stall inside component) ─
function buildStatTooltip(title: string, whatItIs: string, auroraEffect: string, advanced: string): string {
  return `<div class='space-y-3 text-left'><p><strong>${title}</strong></p><p><strong>What this is:</strong> ${whatItIs}</p><p><strong>Why it matters for aurora:</strong> ${auroraEffect}</p><p class='text-xs text-neutral-400'><strong>Advanced:</strong> ${advanced}</p></div>`;
}

interface NotifTooltipEntry { title: string; whatItIs: string; auroraEffect: string; advanced: string; }

const NOTIF_TOOLTIP_CONTENT: Record<string, NotifTooltipEntry> = {
  'visibility-dslr': {
    title: 'DSLR Camera Visible Alert',
    whatItIs: 'The earliest aurora alert — sent when conditions are just sufficient for a DSLR camera on a tripod with a long exposure (5–15 seconds) to capture aurora from your location.',
    auroraEffect: 'This is the first signal that aurora activity is developing toward something worth heading out for. Great for maximum lead time to reach a dark sky site.',
    advanced: 'Triggered by the aurora oval reaching your geomagnetic latitude at low-activity threshold. May not be visible to the naked eye — a camera will show it before you can see it directly.',
  },
  'visibility-phone': {
    title: 'Phone Camera Visible Alert',
    whatItIs: 'Sent when aurora is bright enough to appear on a modern smartphone using night mode. A middle-ground threshold between faint DSLR detection and full naked-eye visibility.',
    auroraEffect: 'You may not see aurora with your naked eye yet, but pointing your phone south will reveal green or pink hues. A good balance between early warning and avoiding false alarms.',
    advanced: 'Corresponds to moderate oval expansion and activity. The aurora oval boundary has moved closer to your location, lifting expected brightness above camera-detection threshold.',
  },
  'visibility-naked': {
    title: 'Naked Eye Visible Alert',
    whatItIs: 'Sent when aurora should be directly visible to the naked eye from your location — no camera needed.',
    auroraEffect: 'Go outside, look south, and you should see it directly. This is the strongest visibility threshold and the most exciting alert — conditions are genuinely significant.',
    advanced: 'Requires the oval to have expanded substantially equatorward. Combined with sufficient Kp or substorm index, this represents a high-confidence aurora event for your latitude.',
  },
  'overnight-watch': {
    title: 'Worth Watching Tonight Alert',
    whatItIs: 'A once-daily alert sent around sunset (6–9 PM NZST) when solar wind conditions are elevated enough to be worth monitoring tonight.',
    auroraEffect: 'Includes Bz direction, solar wind speed, and moon illumination so you can decide whether to head out to a dark location. Not sent on quiet nights — only when there is something worth watching.',
    advanced: 'Uses a composite of live Bz, solar wind speed, Newell coupling, and short-range forecast confidence to decide whether conditions justify an alert. Sent once per evening window.',
  },
  'flare-M1': {
    title: 'Solar Flare M1+ Alert',
    whatItIs: 'Sent when a solar flare reaches at least M1.0 class — the earliest and broadest flare warning threshold.',
    auroraEffect: 'M1+ flares signal ramping solar activity. While not all flares produce Earth-directed CMEs, frequent M-class activity raises the probability of aurora-supporting disturbances in the 1–4 days following.',
    advanced: 'Flare class scales logarithmically: M1 = 10× a C1. Geoeffectiveness depends on whether the flare is associated with a CME, the CME speed, and source longitude on the solar disk.',
  },
  'flare-M5': {
    title: 'Solar Flare M5+ Alert',
    whatItIs: 'A higher threshold flare alert — only sent for M5.0 and above.',
    auroraEffect: 'M5+ flares have a stronger association with major CME launches and elevated space weather. Fewer false alarms than M1+ while still providing useful lead time.',
    advanced: 'M5 is approximately 5× an M1 in X-ray flux. These events often have associated type II/IV radio bursts and proton events that support CME confirmation.',
  },
  'flare-X1': {
    title: 'Solar Flare X1+ Alert',
    whatItIs: 'Sent only for major X-class flares (X1.0 and above) — the strongest category of solar flare.',
    auroraEffect: 'X-class flares are major solar events with a high association with fast, geoeffective CMEs. An X1+ alert often precedes significant space weather and aurora activity within 1–4 days.',
    advanced: 'X-class flares are 10× stronger than M-class. Above X5, radio blackouts and SEP events are common. Source longitude on the disk strongly influences whether the associated CME is Earth-directed.',
  },
  'flare-X5': {
    title: 'Solar Flare X5+ Alert',
    whatItIs: 'High-priority alert for very strong X5+ flares only.',
    auroraEffect: 'X5+ flares represent extreme solar output and are often followed by the most significant geomagnetic storms and wide-latitude aurora events. Very high signal-to-noise ratio.',
    advanced: 'These events frequently trigger NOAA G3–G5 geomagnetic storm watches. If Earth-directed, CME speeds commonly exceed 1500 km/s with strong compressed IMF fields on arrival.',
  },
  'flare-X10': {
    title: 'Solar Flare X10+ Alert',
    whatItIs: 'Reserved for rare, exceptional X10+ flares — the most extreme solar eruption threshold.',
    auroraEffect: 'X10+ flares are historically associated with the strongest geomagnetic storms on record. If you only want one flare alert, this is the highest-confidence aurora trigger available.',
    advanced: 'X10+ events are rare — typically a few per solar cycle. The X28 event in 2003 saturated monitoring instruments. These events can cause aurora visible from the tropics.',
  },
  'shock-ff': {
    title: 'Fast Forward Shock Alert',
    whatItIs: 'A fast-moving CME or solar wind stream has slammed into the L1 satellites. Speed, density, temperature, and magnetic field all jump simultaneously — the classic CME arrival signature.',
    auroraEffect: 'The most actionable aurora alert. Conditions on Earth can shift from quiet to active within 30–60 minutes. If the following IMF orientation is southward (Bz negative), significant aurora is likely.',
    advanced: 'Fast Forward shocks compress the entire solar wind structure. Aurora strength depends on the sheath and magnetic cloud Bz that follows — check the Solar Wind Quick View panel immediately.',
  },
  'shock-sf': {
    title: 'Slow Forward Shock Alert',
    whatItIs: 'A compression wave where speed, density, and temperature rise but the magnetic field drops — often the leading edge of a stream interaction region (SIR) or a weak CME flank.',
    auroraEffect: 'Can enhance aurora conditions but typically less dramatically than a fast forward shock. Watch for Bz turning southward in the following hours for the best aurora window.',
    advanced: 'SIR-driven slow forward shocks are recurring events tied to fast solar wind streams from coronal holes. They lack strong magnetic cloud structures but can still drive moderate geomagnetic activity.',
  },
  'shock-fr': {
    title: 'Fast Reverse Shock Alert',
    whatItIs: 'The trailing edge of a CME or high-speed stream is sweeping past. Density and temperature drop but speed stays elevated — the event is winding down.',
    auroraEffect: 'The strongest part of the solar wind disturbance has typically already passed. Residual aurora activity may continue for hours but is usually declining.',
    advanced: 'Fast reverse shocks occur when fast solar wind outruns the slower wind behind it, creating a rarefaction region at the trailing boundary.',
  },
  'shock-sr': {
    title: 'Slow Reverse Shock Alert',
    whatItIs: 'A rarefaction wave at the tail end of a solar wind structure — density and temperature decrease while the magnetic field slightly increases.',
    auroraEffect: 'Aurora activity is usually winding down at this point. This alert marks the very end of a complex solar wind event and confirms conditions are returning to baseline.',
    advanced: 'Slow reverse shocks are relatively uncommon and typically low-impact from an aurora perspective.',
  },
  'shock-imf': {
    title: 'IMF Shift / Discontinuity Alert',
    whatItIs: 'A sudden large shift in the interplanetary magnetic field (Bt or Bz) without the plasma jumps seen in a true shock — sector boundary crossings, current sheet encounters, or embedded magnetic structures.',
    auroraEffect: 'If Bz swings strongly southward, aurora activity can ramp up quickly — even without a speed or density increase. One of the fastest-acting triggers and easy to miss without real-time monitoring.',
    advanced: 'IMF discontinuities often signal heliospheric current sheet crossings or flux ropes embedded in the solar wind. Aurora response depends almost entirely on the Bz direction and duration that follows.',
  },
  'admin-broadcast': {
    title: 'Spot The Aurora Announcements',
    whatItIs: 'Occasional direct messages sent manually by the Spot The Aurora team — aurora event alerts, tips about upcoming conditions, or important app updates.',
    auroraEffect: 'Sent sparingly and only when there is something genuinely worth knowing — an active aurora event right now, an unusually strong incoming CME, or a significant app update.',
    advanced: 'These are not automated — a human decides to send them. Frequency is low by design. If you receive one during the night, it is worth checking conditions immediately.',
  },
};

const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  appVersion,
  onOpenDocumentation,
  onShowTutorial,
  defaultMainPage,
  defaultForecastView,
  onDefaultMainPageChange,
  onDefaultForecastViewChange,
  pageViewStats,
  pageViewStorageMode,
}) => {
  const [notificationStatus, setNotificationStatus] = useState<NotificationPermission | 'unsupported'>('default');
  const [isSubscribing, setIsSubscribing] = useState(false);
  const [notificationSettings, setNotificationSettings] = useState<Record<string, boolean>>({});
  const [overnightMode, setOvernightModeState] = useState<OvernightMode>(() => getOvernightMode());
  const [notifHistory, setNotifHistory] = useState<NotificationHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  // Which notification template the user currently has selected. Drives
  // whether the full per-notification list is shown (only for 'custom').
  // Persisted across sessions in localStorage (same key written by the
  // onboarding banner) so the two surfaces stay in sync.
  const [selectedTemplate, setSelectedTemplate] = useState<PresetId>('custom');

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    const entries = await getNotificationHistory();
    setNotifHistory(entries);
    setHistoryLoading(false);
  }, []);

  const handleClearHistory = useCallback(async () => {
    await clearNotificationHistory();
    setNotifHistory([]);
  }, []);

  const handleDeleteEntry = useCallback(async (id: number) => {
    await deleteNotificationEntry(id);
    setNotifHistory(prev => prev.filter(e => e.id !== id));
  }, []);
  const [useGpsAutoDetect, setUseGpsAutoDetect] = useState<boolean>(true);
  const [diagRunning, setDiagRunning] = useState<boolean>(false);
  const [notifModalState, setNotifModalState] = useState<{ title: string; content: string } | null>(null);

  const openNotifModal = useCallback((itemId: string) => {
    const data = NOTIF_TOOLTIP_CONTENT[itemId];
    if (data) {
      setNotifModalState({
        title: `About: ${data.title}`,
        content: buildStatTooltip(data.title, data.whatItIs, data.auroraEffect, data.advanced),
      });
    }
  }, []);
  const [diagResults, setDiagResults] = useState<{
    step: string;
    status: 'pass' | 'fail' | 'warn' | 'running';
    detail: string;
  }[]>([]);
  const [serverTestRunning, setServerTestRunning] = useState<boolean>(false);
  const [serverTestResult, setServerTestResult] = useState<string | null>(null);
  const [unsubscribeRunning, setUnsubscribeRunning] = useState<boolean>(false);
  const [unsubscribeResult, setUnsubscribeResult] = useState<string | null>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isAppInstallable, setIsAppInstallable] = useState<boolean>(false);
  const [isAppInstalled, setIsAppInstalled] = useState<boolean>(false);

  const primaryActionClass = 'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-500 text-white font-semibold shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all active:scale-95';
  const subtleActionClass = 'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-neutral-200 font-semibold hover:bg-white/10 transition-all active:scale-95';
  const chipActionClass = 'flex-shrink-0 px-3 py-1.5 text-xs rounded-full bg-white/10 border border-white/15 text-sky-200 hover:bg-white/20 transition-colors';

  useEffect(() => {
    if (isOpen) {
      if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
        setNotificationStatus('unsupported');
      } else {
        setNotificationStatus(Notification.permission);
      }
      const loadedNotificationSettings: Record<string, boolean> = {};
      let shockPrefChanged = false;
      ALL_NOTIFICATION_IDS.forEach(id => {
        if (SHOCK_NOTIFICATION_IDS.has(id)) {
          // Shock notifications are "coming soon" — always force off in the UI,
          // and persist false locally so any previously-enabled subscribers get
          // cleared out. We also sync with the server below.
          loadedNotificationSettings[id] = false;
          if (getNotificationPreference(id) !== false) {
            setNotificationPreference(id, false);
            shockPrefChanged = true;
          }
        } else {
          loadedNotificationSettings[id] = getNotificationPreference(id);
        }
      });
      setNotificationSettings(loadedNotificationSettings);
      if (shockPrefChanged) {
        // Sync the forced-off shock prefs with the push worker.
        updatePushSubscriptionPreferences();
      }
      // Pick an initial template for the selector. Priority order:
      //   1. Whatever the user explicitly saved (from onboarding or a previous
      //      settings visit) — this honours their declared intent.
      //   2. Otherwise, see if their current prefs happen to match one of the
      //      presets exactly — handy for returning users who onboarded before
      //      we started persisting the template choice.
      //   3. Fallback: 'custom' so the full list is visible and nothing's hidden.
      let initialTemplate: PresetId = 'custom';
      try {
        const stored = localStorage.getItem(NOTIFICATION_TEMPLATE_KEY) as PresetId | null;
        if (stored && NOTIFICATION_PRESETS.some(p => p.id === stored)) {
          initialTemplate = stored;
        } else {
          const detected = detectPresetFromPrefs(loadedNotificationSettings);
          if (detected) initialTemplate = detected;
        }
      } catch { /* localStorage blocked — stick with 'custom' */ }
      setSelectedTemplate(initialTemplate);
      const storedGpsPref = localStorage.getItem(LOCATION_PREF_KEY);
      setUseGpsAutoDetect(storedGpsPref === null ? true : JSON.parse(storedGpsPref));
      checkAppInstallationStatus();
    }
  }, [isOpen]);

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setIsAppInstallable(true);
    };
    const handleAppInstalled = () => {
      setIsAppInstalled(true);
      setIsAppInstallable(false);
      setDeferredPrompt(null);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const checkAppInstallationStatus = useCallback(() => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    const isPWA = (window.navigator as any).standalone === true;
    setIsAppInstalled(isStandalone || isPWA);
  }, []);
  
  const handleEnableNotifications = useCallback(async () => {
    setIsSubscribing(true);
    const permission = await requestNotificationPermission('settings_modal');
    setNotificationStatus(permission);

    if (permission === 'granted') {
      // First-time install: if no preferences saved yet, default everything to ON
      const hasAnyPref = ALL_NOTIFICATION_IDS.some(
        id => localStorage.getItem('notification_pref_' + id) !== null
      );
      if (!hasAnyPref) {
        const defaultOn: Record<string, boolean> = {};
        ALL_NOTIFICATION_IDS.forEach(id => {
          // Shock notifications are "coming soon" — always default them OFF,
          // even on first-time subscribe, because the user can't turn them off.
          const enabled = !SHOCK_NOTIFICATION_IDS.has(id);
          setNotificationPreference(id, enabled);
          defaultOn[id] = enabled;
        });
        setNotificationSettings(defaultOn);
        // "Everything on (except shocks)" matches the 'everything' preset
        // exactly — surface that to the user so the picker reflects their
        // actual state rather than falling back to 'custom'.
        setSelectedTemplate('everything');
        recordPresetSelection('everything', 'settings_modal');
      }
      const subscription = await subscribeUserToPush('settings_modal');
      if (subscription) {
        console.log("Successfully subscribed to push notifications.");
      } else {
        console.error("Failed to get a push subscription.");
      }
    }
    setIsSubscribing(false);
  }, []);

  const handleNotificationToggle = useCallback((id: string, checked: boolean) => {
    setNotificationSettings(prev => ({ ...prev, [id]: checked }));
    setNotificationPreference(id, checked);
    // If the user manually tweaks a toggle, they're no longer following a
    // preset. Switch to 'custom' so the list stays visible and reflects
    // their actual preferences rather than a drifted preset label.
    setSelectedTemplate('custom');
    recordPresetSelection('custom', 'settings_modal');
    // THIS IS THE FIX: Call the new function to sync changes with the server.
    updatePushSubscriptionPreferences();
  }, []);

  const handleGpsToggle = useCallback((checked: boolean) => {
    setUseGpsAutoDetect(checked);
    localStorage.setItem(LOCATION_PREF_KEY, JSON.stringify(checked));
  }, []);

  const runDiagnostics = useCallback(async () => {
    setDiagRunning(true);
    setDiagResults([]);
    const results: { step: string; status: 'pass' | 'fail' | 'warn' | 'running'; detail: string }[] = [];
    const push = (step: string, status: 'pass'|'fail'|'warn'|'running', detail: string) => {
      results.push({ step, status, detail });
      setDiagResults([...results]);
    };

    // Step 1 — Service worker registered?
    push('Service worker', 'running', 'Checking...');
    if (!('serviceWorker' in navigator)) {
      results[results.length-1] = { step: 'Service worker', status: 'fail', detail: 'Service workers not supported by this browser.' };
      setDiagResults([...results]); setDiagRunning(false); return;
    }
    const reg = await navigator.serviceWorker.ready.catch(() => null);
    if (!reg) {
      results[results.length-1] = { step: 'Service worker', status: 'fail', detail: 'Service worker not ready. Try reloading the app.' };
      setDiagResults([...results]); setDiagRunning(false); return;
    }
    results[results.length-1] = { step: 'Service worker', status: 'pass', detail: `Active — scope: ${reg.scope}` };
    setDiagResults([...results]);

    // Step 2 — Push subscription exists in browser?
    push('Push subscription', 'running', 'Checking...');
    const sub = await reg.pushManager.getSubscription().catch(() => null);
    if (!sub) {
      results[results.length-1] = { step: 'Push subscription', status: 'fail', detail: 'No push subscription found in this browser. Try clicking Enable Notifications.' };
      setDiagResults([...results]); setDiagRunning(false); return;
    }
    const endpointShort = sub.endpoint.slice(-28);
    results[results.length-1] = { step: 'Push subscription', status: 'pass', detail: `Found — endpoint: ...${endpointShort}` };
    setDiagResults([...results]);

    // Step 3 — Subscription saved in worker KV?
    push('Saved on server', 'running', 'Checking worker KV...');
    try {
      const checkResp = await fetch('https://push-notification-worker.thenamesrock.workers.dev/check-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
      const checkData = await checkResp.json();
      if (checkData.saved) {
        const loc = checkData.locationSource === 'gps'
          ? `GPS (${Number(checkData.latitude).toFixed(2)}, ${Number(checkData.longitude).toFixed(2)})`
          : checkData.locationSource === 'ip' ? 'IP geolocation' : 'Unknown';
        results[results.length-1] = { step: 'Saved on server', status: 'pass', detail: `Subscription found in KV · Location: ${loc} · ${checkData.preferenceCount} preferences stored` };
      } else {
        results[results.length-1] = { step: 'Saved on server', status: 'fail', detail: 'Subscription NOT found in worker KV. The save request may have failed — try re-enabling notifications.' };
      }
    } catch (e: any) {
      results[results.length-1] = { step: 'Saved on server', status: 'fail', detail: `Could not reach worker: ${e.message}` };
    }
    setDiagResults([...results]);

    // Step 4 — Worker health
    push('Worker health', 'running', 'Checking...');
    try {
      const healthResp = await fetch('https://push-notification-worker.thenamesrock.workers.dev/health');
      const health = await healthResp.json();
      if (health.ok) {
        const ageMin = health.ageMs ? Math.round(health.ageMs / 60000) : null;
        results[results.length-1] = { step: 'Worker health', status: 'pass', detail: `Cron running — last run ${ageMin != null ? `${ageMin} min ago` : 'recently'}` };
      } else {
        results[results.length-1] = { step: 'Worker health', status: 'warn', detail: `Worker cron hasn't run recently (last: ${health.lastRun ? new Date(health.lastRun).toLocaleTimeString() : 'never'})` };
      }
    } catch (e: any) {
      results[results.length-1] = { step: 'Worker health', status: 'fail', detail: `Could not reach worker: ${e.message}` };
    }
    setDiagResults([...results]);
    setDiagRunning(false);
  }, []);

  const runServerTest = useCallback(async () => {
    setServerTestRunning(true);
    setServerTestResult(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) { setServerTestResult('❌ No push subscription found — enable notifications first.'); setServerTestRunning(false); return; }
      const resp = await fetch('https://push-notification-worker.thenamesrock.workers.dev/trigger-test-push-for-me', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON(), category: 'aurora-60percent' }),
      });
      const data = await resp.json();
      if (resp.ok && data.success) {
        setServerTestResult('✅ Server push sent! You should receive a notification on this device within a few seconds.');
      } else {
        setServerTestResult(`❌ Server responded with an error: ${data.message ?? resp.status}`);
      }
    } catch (e: any) {
      setServerTestResult(`❌ Network error: ${e.message}`);
    }
    setServerTestRunning(false);
  }, []);

  const handleUnsubscribe = useCallback(async () => {
    if (!window.confirm('This will remove your subscription from the server and disable all push notifications. Are you sure?')) return;
    setUnsubscribeRunning(true);
    setUnsubscribeResult(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) {
        setUnsubscribeResult('❌ No active subscription found in this browser.');
        setUnsubscribeRunning(false);
        return;
      }
      // Delete from server KV first
      const resp = await fetch('https://push-notification-worker.thenamesrock.workers.dev/delete-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
      const data = await resp.json();
      if (!data.deleted) {
        setUnsubscribeResult(`❌ Server error: ${data.error ?? 'Unknown error'}`);
        setUnsubscribeRunning(false);
        return;
      }
      // Then unsubscribe in the browser
      await sub.unsubscribe();
      setUnsubscribeResult('✅ Successfully unsubscribed. You will no longer receive push notifications.');
    } catch (e: any) {
      setUnsubscribeResult(`❌ Error: ${e.message}`);
    }
    setUnsubscribeRunning(false);
  }, []);

  const handleInstallApp = useCallback(async () => {
    if (!deferredPrompt) return;
    try {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') console.log('User accepted the install prompt');
      else console.log('User dismissed the install prompt');
      setDeferredPrompt(null);
      setIsAppInstallable(false);
    } catch (error) {
      console.error('Error during app installation:', error);
    }
  }, [deferredPrompt]);
  
  const handleOvernightModeChange = useCallback(async (mode: OvernightMode) => {
    setOvernightModeState(mode);
    setOvernightMode(mode);
    // Overnight mode is part of the preset definition, so a manual override
    // means the user is no longer strictly on a preset.
    setSelectedTemplate('custom');
    recordPresetSelection('custom', 'settings_modal');
    await updatePushSubscriptionPreferences();
  }, []);

  /**
   * User picked a template card. For non-custom presets, rewrite all the
   * per-notification prefs and the overnight-watch mode in one go so the
   * full preset takes effect immediately. For 'custom', we just reveal the
   * list — the user's current selections are left alone so they can start
   * tweaking without losing what they had.
   */
  const handleTemplateSelect = useCallback(async (id: PresetId) => {
    setSelectedTemplate(id);
    recordPresetSelection(id, 'settings_modal');

    const preset = getPresetById(id);
    if (!preset) {
      // 'custom' or unknown → no bulk rewrite, just reveal the list.
      return;
    }

    // Build a new prefs object: every id off, then switch on the preset's
    // list. Shocks stay force-off regardless (they're "coming soon").
    const enabledSet = new Set(preset.prefs);
    const nextPrefs: Record<string, boolean> = {};
    ALL_NOTIFICATION_IDS.forEach(notifId => {
      if (SHOCK_NOTIFICATION_IDS.has(notifId)) { nextPrefs[notifId] = false; return; }
      nextPrefs[notifId] = enabledSet.has(notifId);
    });

    // Persist locally and update UI state
    Object.entries(nextPrefs).forEach(([notifId, enabled]) => setNotificationPreference(notifId, enabled));
    setNotificationSettings(nextPrefs);

    // Apply the preset's overnight mode
    setOvernightModeState(preset.overnightMode);
    setOvernightMode(preset.overnightMode);

    // Push the full set of changes to the server in a single sync. Not strictly
    // required but avoids N tiny requests when a preset touches many toggles.
    await updatePushSubscriptionPreferences();
  }, []);

  const handleTestCategory = useCallback(async (categoryId: string) => {
    await sendServerSelfTest(categoryId);
  }, []);


  if (!isOpen) return null;

  return (
    <>
    <InfoModal isOpen={!!notifModalState} onClose={() => setNotifModalState(null)} title={notifModalState?.title ?? ''} content={notifModalState?.content ?? ''} />
    <div 
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[3000] flex justify-center items-center p-4" 
      onClick={onClose}
    >
      <div 
        className="relative bg-neutral-950/95 border border-neutral-800/90 rounded-lg shadow-2xl w-full max-w-2xl max-h-[85vh] text-neutral-300 flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-between items-center p-4 border-b border-neutral-700/80">
          <h2 className={`text-2xl font-bold text-neutral-200`}>App Settings</h2>
          <button onClick={onClose} className="p-1 rounded-full text-neutral-400 hover:text-white hover:bg-white/10 transition-colors">
            <CloseIcon className="w-6 h-6" />
          </button>
        </div>
        
        <div className="overflow-y-auto p-5 styled-scrollbar pr-4 space-y-8 flex-1">
          <section>
            <h3 className="text-xl font-semibold text-neutral-300 mb-3">Support the Project</h3>
            <div className="text-sm text-neutral-400 mb-4 space-y-3">
                <p>
                    This application is a passion project, built and maintained by one person with over <strong>600+ hours</strong> of development time invested. To provide the best user experience, this app will <strong>always be ad-free</strong>.
                </p>
                <p>
                    However, there are real costs for server hosting, domain registration, and API services. If you find this tool useful and appreciate the ad-free experience, please consider supporting its continued development and operational costs.
                </p>
            </div>
            <a 
              href="https://buymeacoffee.com/spottheaurora"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-3 w-full px-4 py-3 bg-yellow-500/20 border border-yellow-400/50 rounded-lg text-yellow-200 hover:bg-yellow-500/30 hover:border-yellow-300 transition-colors font-semibold"
            >
              <HeartIcon className="w-6 h-6 text-yellow-300" />
              <span>Support on Buy Me a Coffee</span>
            </a>
          </section>

          <section>
            <h3 className="text-xl font-semibold text-neutral-300 mb-3">App Installation</h3>
            {isAppInstalled ? (
              <div className="bg-green-900/30 border border-green-700/50 rounded-md p-3 text-sm">
                <p className="text-green-300 flex items-center">
                  <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                  App has been installed to your device!
                </p>
              </div>
            ) : isAppInstallable ? (
              <div className="space-y-3">
                <p className="text-sm text-neutral-400">Install this app for quick home-screen access and notifications.</p>
                <button onClick={handleInstallApp} className={primaryActionClass}>
                  <DownloadIcon className="w-4 h-4" />
                  <span>Install App</span>
                </button>
              </div>
            ) : (
              <div className="bg-neutral-800/50 border border-neutral-700/50 rounded-md p-3 text-sm">
                <p className="text-neutral-400">App installation is not currently available.</p>
              </div>
            )}
          </section>

          <section>
            <h3 className="text-xl font-semibold text-neutral-300 mb-3">Default start view</h3>
            <p className="text-sm text-neutral-400 mb-4">
              Choose the page the app opens to by default and which forecast layout loads first when you visit Spot the Aurora.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-semibold text-neutral-300" htmlFor="default-main-page">
                  Landing page
                </label>
                <select
                  id="default-main-page"
                  className="w-full bg-neutral-900 border border-neutral-800 rounded-md px-3 py-2 text-neutral-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  value={defaultMainPage}
                  onChange={e => onDefaultMainPageChange(e.target.value as 'forecast' | 'solar-activity' | 'modeler')}
                >
                  <option value="forecast">Spot the Aurora Forecast</option>
                  <option value="solar-activity">Solar Activity</option>
                  <option value="modeler">CME Visualization</option>
                </select>
                <p className="text-xs text-neutral-500">
                  Your default landing page is stored on this device so it opens straight to your preferred view.
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold text-neutral-300" htmlFor="default-forecast-view">
                  Forecast view mode
                </label>
                <select
                  id="default-forecast-view"
                  className="w-full bg-neutral-900 border border-neutral-800 rounded-md px-3 py-2 text-neutral-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  value={defaultForecastView}
                  onChange={e => onDefaultForecastViewChange(e.target.value as 'simple' | 'advanced')}
                >
                  <option value="simple">Simple view (at-a-glance)</option>
                  <option value="advanced">Advanced view (full detail)</option>
                </select>
                <p className="text-xs text-neutral-500">
                  The selected layout is saved locally and applied whenever you load the forecast page without a shared link.
                </p>
              </div>
            </div>
          </section>


          <section>
            <h3 className="text-xl font-semibold text-neutral-300 mb-3">Your page views</h3>
            <p className="text-sm text-neutral-400 mb-4">
              {pageViewStorageMode === 'server'
                ? 'These numbers are stored on the server so they stay in sync across devices.'
                : 'These numbers are stored only on this device so you can see how often you check in.'}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[{ label: 'Today', value: pageViewStats.daily }, { label: 'This week', value: pageViewStats.weekly }, { label: 'This year', value: pageViewStats.yearly }, { label: 'Lifetime', value: pageViewStats.lifetime }].map(stat => (
                <div key={stat.label} className="bg-neutral-900/60 border border-neutral-800 rounded-lg p-3 text-center shadow-inner">
                  <p className="text-xs uppercase tracking-wide text-neutral-500">{stat.label}</p>
                  <p className="text-2xl font-bold text-white mt-1">{stat.value}</p>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h3 className="text-xl font-semibold text-neutral-300 mb-3">Push Notifications</h3>
            {notificationStatus === 'unsupported' && <p className="text-red-400 text-sm mb-4">Your browser or device does not support push notifications.</p>}
            
            {notificationStatus === 'denied' && (
              <div className="bg-red-900/30 border border-red-700/50 rounded-md p-3 mb-4 text-sm">
                <p className="text-red-300">Notification permission was denied. You must enable them in your browser or system settings to receive alerts.</p>
              </div>
            )}

            {notificationStatus === 'default' && (
              <div className="bg-orange-900/30 border border-orange-700/50 rounded-md p-3 mb-4 text-sm">
                <p className="text-orange-300 mb-3">Enable push notifications to be alerted of major space weather events, even when the app is closed.</p>
                <button
                  onClick={handleEnableNotifications}
                  disabled={isSubscribing}
                  className={`${primaryActionClass} disabled:opacity-50 disabled:cursor-wait`}
                >
                  {isSubscribing ? 'Subscribing...' : 'Enable Notifications'}
                </button>
              </div>
            )}
            
            {notificationStatus === 'granted' && (
              <div className="space-y-4">
                <div className="bg-green-900/30 border border-green-700/50 rounded-md p-3 text-sm">
                    <p className="text-green-300">Push notifications are enabled! You can now customize your alerts below.</p>
                </div>

                {/* Template picker — pick a preset or "Custom" to choose individually. */}
                <div className="bg-neutral-900/50 border border-neutral-700/60 rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-neutral-300 mb-1">Alert template</h4>
                  <p className="text-xs text-neutral-500 mb-3">
                    Pick a template to apply a sensible bundle of alerts at once. Choose <span className="text-neutral-300">Custom</span> to set every notification individually.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {NOTIFICATION_PRESETS.map(preset => {
                      const active = selectedTemplate === preset.id;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => handleTemplateSelect(preset.id)}
                          className={`text-left p-3 rounded-lg border transition-colors ${
                            active
                              ? 'bg-sky-500/15 border-sky-500/50 ring-1 ring-sky-500/40'
                              : 'bg-neutral-800/40 border-neutral-700/50 hover:bg-neutral-800/70 hover:border-neutral-600/60'
                          }`}
                          aria-pressed={active}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-lg leading-none" aria-hidden="true">{preset.emoji}</span>
                            <span className={`text-sm font-semibold ${active ? 'text-sky-200' : 'text-neutral-200'}`}>{preset.title}</span>
                            {active && (
                              <span className="ml-auto text-[10px] font-bold uppercase tracking-wide text-sky-300 bg-sky-500/20 px-1.5 py-0.5 rounded">Selected</span>
                            )}
                          </div>
                          <p className="text-[11px] text-neutral-400 leading-relaxed">{preset.description}</p>
                        </button>
                      );
                    })}
                  </div>
                  {selectedTemplate !== 'custom' && (
                    <p className="text-[11px] text-neutral-500 mt-3">
                      Individual alert toggles are hidden while a template is selected. Pick <span className="text-neutral-300">Custom</span> above to show them.
                    </p>
                  )}
                </div>

                {/* Per-alert list — only shown when the user has chosen to customise.
                    Any manual toggle automatically flips selectedTemplate to 'custom',
                    which is also why this stays visible after the first edit. */}
                {selectedTemplate === 'custom' && (
                <div className="space-y-4">
                  {NOTIFICATION_GROUPS.map(group => (
                    <div key={group.group} className="bg-neutral-900/50 border border-neutral-700/60 rounded-lg p-4">
                      <h4 className="text-sm font-semibold text-neutral-300 mb-1">{group.group}</h4>
                      <p className="text-xs text-neutral-500 mb-3">{group.description}</p>
                      <div className="space-y-3">
                        {group.items.map(item => {
                          const isShock = SHOCK_NOTIFICATION_IDS.has(item.id);
                          return (
                          <div key={item.id}>
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                                <ToggleSwitch
                                  label={item.label}
                                  checked={isShock ? false : (notificationSettings[item.id] ?? false)}
                                  onChange={(checked) => handleNotificationToggle(item.id, checked)}
                                  disabled={isShock}
                                />
                                {isShock && (
                                  <span className="flex-shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide bg-sky-500/15 text-sky-300 border border-sky-500/30">
                                    <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                                    COMING SOON
                                  </span>
                                )}
                                {'tooltip' in item && (
                                  <button
                                    onClick={() => openNotifModal(item.id)}
                                    className="flex-shrink-0 p-1 rounded-full text-neutral-400 hover:bg-neutral-700 hover:text-white transition-colors"
                                    title="About this alert"
                                  >?</button>
                                )}
                              </div>
                              {!isShock && (
                                <button
                                  onClick={() => handleTestCategory(item.id)}
                                  className={chipActionClass}
                                >
                                  Test
                                </button>
                              )}
                            </div>
                            <p className={`text-xs mt-1 ml-1 ${isShock ? 'text-neutral-700' : 'text-neutral-600'}`}>{item.description}</p>
                            {/* Mode selector — only for overnight-watch */}
                            {item.id === 'overnight-watch' && notificationSettings[item.id] && (
                              <div className="mt-3 ml-1 p-3 bg-neutral-800/60 border border-neutral-700/50 rounded-lg">
                                <p className="text-xs font-semibold text-neutral-300 mb-2">Send when…</p>
                                <div className="space-y-2">
                                  {([
                                    { value: 'every-night', label: 'Every night', desc: 'Always send a nightly summary at sunset, even if conditions are quiet.' },
                                    { value: 'camera',      label: 'Camera may detect aurora', desc: 'Only when conditions are elevated enough for a DSLR to capture aurora.' },
                                    { value: 'phone',       label: 'Phone camera may show aurora', desc: 'Only when aurora should be visible on a smartphone camera.' },
                                    { value: 'eye',         label: 'Naked eye aurora likely', desc: 'Only when aurora may be visible to the naked eye — significant events only.' },
                                  ] as { value: OvernightMode; label: string; desc: string }[]).map(opt => (
                                    <label key={opt.value} className={`flex items-start gap-2.5 cursor-pointer p-2 rounded-lg transition-colors ${overnightMode === opt.value ? 'bg-sky-500/15 border border-sky-500/30' : 'hover:bg-neutral-700/40'}`}>
                                      <input
                                        type="radio"
                                        name="overnight-mode"
                                        value={opt.value}
                                        checked={overnightMode === opt.value}
                                        onChange={() => handleOvernightModeChange(opt.value)}
                                        className="mt-0.5 accent-sky-500 flex-shrink-0"
                                      />
                                      <div>
                                        <p className="text-xs font-medium text-neutral-200">{opt.label}</p>
                                        <p className="text-[11px] text-neutral-500 leading-relaxed mt-0.5">{opt.desc}</p>
                                      </div>
                                    </label>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
                )}
                <div className="mt-4 space-y-4">
                  {/* Diagnostics */}
                  <div className="bg-neutral-900/50 border border-neutral-700/60 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="text-sm font-semibold text-neutral-300">Connection Diagnostics</p>
                        <p className="text-xs text-neutral-500 mt-0.5">Checks service worker, push subscription, and server registration</p>
                      </div>
                      <button onClick={runDiagnostics} disabled={diagRunning} className={`${chipActionClass} disabled:opacity-50`}>
                        {diagRunning ? 'Running...' : 'Run check'}
                      </button>
                    </div>
                    {diagResults.length > 0 && (
                      <div className="space-y-2">
                        {diagResults.map((r, i) => (
                          <div key={i} className="flex items-start gap-2.5 text-xs">
                            <span className="flex-shrink-0 mt-0.5">
                              {r.status === 'pass' ? '✅' : r.status === 'fail' ? '❌' : r.status === 'warn' ? '⚠️' : '⏳'}
                            </span>
                            <div>
                              <span className="font-semibold text-neutral-300">{r.step}</span>
                              <span className="text-neutral-500 ml-1">— {r.detail}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Server push test */}
                  <div className="bg-neutral-900/50 border border-neutral-700/60 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <p className="text-sm font-semibold text-neutral-300">Server Push Test</p>
                        <p className="text-xs text-neutral-500 mt-0.5">Sends a real push notification from the server to this device</p>
                      </div>
                      <button onClick={runServerTest} disabled={serverTestRunning} className={`${chipActionClass} disabled:opacity-50`}>
                        {serverTestRunning ? 'Sending...' : 'Send test'}
                      </button>
                    </div>
                    {serverTestResult && (
                      <p className="text-xs text-neutral-400 mt-2">{serverTestResult}</p>
                    )}
                  </div>

                  {/* Local test */}
                  <div className="flex justify-center">
                    <button onClick={() => sendTestNotification()} className={subtleActionClass}>
                      Send Local Test Notification
                    </button>
                  </div>

                  {/* Unsubscribe */}
                  <div className="border-t border-neutral-800/60 pt-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-neutral-300">Remove Subscription</p>
                        <p className="text-xs text-neutral-500 mt-0.5">Deletes your subscription from the server and disables all push notifications</p>
                      </div>
                      <button
                        onClick={handleUnsubscribe}
                        disabled={unsubscribeRunning}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-900/40 border border-red-700/50 text-red-400 hover:bg-red-900/60 transition-colors disabled:opacity-50"
                      >
                        {unsubscribeRunning ? 'Removing...' : 'Unsubscribe'}
                      </button>
                    </div>
                    {unsubscribeResult && (
                      <p className="text-xs text-neutral-400 mt-2">{unsubscribeResult}</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>

          <section>
            <h3 className="text-xl font-semibold text-neutral-300 mb-3">Location Settings</h3>
            <p className="text-sm text-neutral-400 mb-4">Control how your location is determined for features like the Aurora Sighting Map.</p>
            <ToggleSwitch label="Auto-detect Location (GPS)" checked={useGpsAutoDetect} onChange={handleGpsToggle} />
            <p className="text-xs text-neutral-500 mt-2">When enabled, the app will try to use your device's GPS. If disabled, you will be prompted to place your location manually on the map.</p>
          </section>

          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xl font-semibold text-neutral-300">Notification History</h3>
              <div className="flex gap-2">
                <button
                  onClick={() => { setShowHistory(v => { if (!v) loadHistory(); return !v; }); }}
                  className="text-xs px-3 py-1.5 rounded-lg bg-neutral-700 hover:bg-neutral-600 text-neutral-300 transition-colors"
                >
                  {showHistory ? 'Hide' : 'Show history'}
                </button>
                {showHistory && notifHistory.length > 0 && (
                  <button
                    onClick={handleClearHistory}
                    className="text-xs px-3 py-1.5 rounded-lg bg-red-900/40 hover:bg-red-800/50 text-red-400 border border-red-700/40 transition-colors"
                  >
                    Clear all
                  </button>
                )}
              </div>
            </div>
            <p className="text-sm text-neutral-500 mb-3">Every notification sent to this device is saved here. Stored locally — cleared only if you clear the app cache or delete entries manually.</p>
            {showHistory && (
              <div className="space-y-2 max-h-80 overflow-y-auto styled-scrollbar pr-1">
                {historyLoading ? (
                  <p className="text-sm text-neutral-500 text-center py-4">Loading...</p>
                ) : notifHistory.length === 0 ? (
                  <p className="text-sm text-neutral-500 text-center py-6">No notifications received yet. They will appear here as they arrive.</p>
                ) : (
                  notifHistory.map(entry => {
                    const emoji = CATEGORY_EMOJI[entry.category]
                      ?? (AURORA_RE.test(entry.category) ? '🌌' : '🔔');
                    return (
                      <div
                        key={entry.id}
                        className="flex items-start gap-3 p-3 rounded-xl bg-neutral-800/60 border border-neutral-700/40 group"
                      >
                        <span className="text-xl flex-shrink-0 mt-0.5">{emoji}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-semibold text-neutral-200 leading-snug">{entry.title}</p>
                            <span className="text-xs text-neutral-500 flex-shrink-0 mt-0.5">{formatHistoryTime(entry.timestamp)}</span>
                          </div>
                          {entry.body && (
                            <p className="text-xs text-neutral-400 mt-1 leading-relaxed whitespace-pre-line line-clamp-3">{entry.body}</p>
                          )}
                        </div>
                        <button
                          onClick={() => handleDeleteEntry(entry.id)}
                          className="flex-shrink-0 opacity-0 group-hover:opacity-100 text-neutral-600 hover:text-red-400 transition-all p-1 rounded"
                          title="Delete this entry"
                        >
                          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </section>

          <section>
            <h3 className="text-xl font-semibold text-neutral-300 mb-3">Help & Support</h3>
            <p className="text-sm text-neutral-400 mb-4">
              Have feedback, a feature request, or need support? Restart the welcome tutorial or send an email.
            </p>
            <div className="flex flex-wrap items-center gap-4">
              <button
                onClick={onShowTutorial}
                className={subtleActionClass}
              >
                <GuideIcon className="w-5 h-5" />
                <span>Show App Tutorial</span>
              </button>
              <a
                href="mailto:help@spottheaurora.co.nz?subject=Spot%20The%20Aurora%20Support"
                className={`${subtleActionClass} no-underline`}
              >
                <MailIcon className="w-5 h-5" />
                <span>Email for Support</span>
              </a>
              <button
                onClick={() => { if (onOpenDocumentation) { onOpenDocumentation(); } }}
                className={subtleActionClass}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span>How It Works</span>
              </button>
            </div>
          </section>
        </div>
        
        <div className="flex justify-between items-center p-4 border-t border-neutral-700/80 text-xs text-neutral-500">
          <span>Version: {appVersion}</span>
          <a 
            href="https://www.tnrprotography.co.nz/spot-the-aurora---change-log" 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-sky-400 hover:underline hover:text-sky-300 transition-colors"
          >
            View Changelog
          </a>
        </div>
      </div>
    </div>
    </>
  );
};

export default SettingsModal;
// --- END OF FILE src/components/SettingsModal.tsx ---