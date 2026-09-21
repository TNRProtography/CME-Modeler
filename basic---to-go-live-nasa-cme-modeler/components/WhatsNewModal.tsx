import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  getNotificationPreference,
  setNotificationPreference,
  updatePushSubscriptionPreferences,
  getCmeSpeedMin,
  setCmeSpeedMin,
} from '../utils/notifications';
import {
  CME_SPEED_PRESETS, CME_SPEED_MIN, CME_SPEED_MAX, CME_SPEED_STEP,
  CME_SPEED_BANDS, cmeSpeedBand, clampCmeSpeed,
} from '../utils/cmeAnalysis';
import { markWhatsNewSeen } from '../utils/whatsNew';
import ToggleSwitch from './ToggleSwitch';
import CloseIcon from './icons/CloseIcon';

/**
 * A one-time note about two new alerts, for people who already had the app.
 *
 * It exists instead of turning things on for them. The CME arrival alert has
 * been off for every existing subscriber since it shipped - not because they
 * declined it, but because it defaulted off and nobody ever saw it - and the
 * alternative to this modal was flipping that stored `false` to `true` on
 * their behalf. This asks instead.
 *
 * Only shown to people who already have notifications set up; see
 * shouldShowWhatsNew(). Everything here writes through immediately, so closing
 * it keeps whatever was changed.
 */
interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const WhatsNewModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const [cmeOn, setCmeOn]   = useState(false);
  const [shockOn, setShockOn] = useState(false);
  const [speed, setSpeed]   = useState(700);

  // Read the live values when it opens rather than at mount, so it never shows
  // a stale switch if the user changed something in Settings first.
  useEffect(() => {
    if (!isOpen) return;
    setCmeOn(getNotificationPreference('cme-earth-directed'));
    setShockOn(getNotificationPreference('shock-ff'));
    setSpeed(getCmeSpeedMin());
  }, [isOpen]);

  const toggle = useCallback((id: string, on: boolean) => {
    setNotificationPreference(id, on);
    if (id === 'cme-earth-directed') setCmeOn(on);
    if (id === 'shock-ff') setShockOn(on);
    void updatePushSubscriptionPreferences();
  }, []);

  const changeSpeed = useCallback((value: number) => {
    const clamped = clampCmeSpeed(value);
    setSpeed(clamped);
    setCmeSpeedMin(clamped);
    void updatePushSubscriptionPreferences();
  }, []);

  const close = useCallback(() => {
    markWhatsNewSeen();
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, close]);

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="whats-new-title"
      onClick={close}
    >
      <div
        className="w-full sm:max-w-md bg-neutral-950 border border-neutral-800 rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[88vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 p-4 pb-2">
          <div>
            <p className="text-[10px] font-semibold tracking-widest text-sky-400 uppercase">New</p>
            <h2 id="whats-new-title" className="text-lg font-semibold text-white leading-tight mt-0.5">
              Two new CME alerts
            </h2>
          </div>
          <button
            onClick={close}
            className="p-1.5 rounded-full text-neutral-400 hover:bg-neutral-800 hover:text-white transition-colors flex-shrink-0"
            aria-label="Close"
          >
            <CloseIcon className="w-4 h-4" />
          </button>
        </div>

        <p className="px-4 text-xs text-neutral-400 leading-relaxed">
          You can now be told when a CME leaves the Sun heading our way, and again
          when it actually arrives. Both are off or new for existing users, so
          they are yours to switch on.
        </p>

        <div className="p-4 space-y-3">
          {/* Departure */}
          <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-3">
            <ToggleSwitch
              label="Earth-directed CME launched"
              checked={cmeOn}
              onChange={(v) => toggle('cme-earth-directed', v)}
            />
            <p className="text-[11px] text-neutral-500 leading-relaxed mt-1.5">
              Sent when NASA catalogues a CME pointed at us — one to three days of
              warning, with a forecast arrival time from the same model the 3D
              visualisation uses.
            </p>

            {cmeOn && (
              <div className="mt-3 pt-3 border-t border-neutral-800">
                <p className="text-xs font-semibold text-neutral-300 mb-2">Only if it is faster than…</p>
                <div className="flex flex-wrap gap-1.5 mb-2.5">
                  {CME_SPEED_PRESETS.map(p => (
                    <button
                      key={p.speed}
                      onClick={() => changeSpeed(p.speed)}
                      title={p.note}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
                        speed === p.speed
                          ? 'bg-sky-500/15 border-sky-500/40 text-sky-200'
                          : 'bg-neutral-900 border-neutral-700/60 text-neutral-400 hover:text-neutral-200'}`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    inputMode="numeric"
                    min={CME_SPEED_MIN}
                    max={CME_SPEED_MAX}
                    step={CME_SPEED_STEP}
                    value={speed}
                    onChange={(e) => setSpeed(Number(e.target.value))}
                    onBlur={(e) => changeSpeed(Number(e.target.value))}
                    className="w-24 px-2 py-1.5 rounded-lg bg-neutral-900 border border-neutral-700 text-sm text-neutral-100 focus:outline-none focus:border-sky-500"
                    aria-label="Minimum CME speed in kilometres per second"
                  />
                  <span className="text-xs text-neutral-400">km/s</span>
                  <span className="text-[11px] text-sky-300 ml-1">
                    {CME_SPEED_BANDS[cmeSpeedBand(speed)].label}
                  </span>
                </div>
                <p className="text-[11px] text-neutral-500 leading-relaxed mt-2">
                  {CME_SPEED_BANDS[cmeSpeedBand(speed)].detail}
                </p>
              </div>
            )}
          </div>

          {/* Arrival */}
          <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-3">
            <ToggleSwitch
              label="CME arrival — fast forward shock"
              checked={shockOn}
              onChange={(v) => toggle('shock-ff', v)}
            />
            <p className="text-[11px] text-neutral-500 leading-relaxed mt-1.5">
              The moment it hits the satellites at L1, about 45 to 60 minutes
              upstream of us. This is the most actionable alert the app sends —
              conditions can go from quiet to active within the hour.
            </p>
          </div>
        </div>

        <div className="px-4 pb-4 pt-0 flex items-center justify-between gap-3">
          <p className="text-[11px] text-neutral-600">Change these any time in Settings.</p>
          <button
            onClick={close}
            className="px-4 py-2 rounded-lg bg-sky-500/15 border border-sky-500/40 text-sky-200 text-sm font-medium hover:bg-sky-500/25 transition-colors flex-shrink-0"
          >
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default WhatsNewModal;
