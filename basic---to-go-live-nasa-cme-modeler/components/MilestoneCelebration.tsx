// components/MilestoneCelebration.tsx
// Full-screen celebration for a page-view milestone (utils/milestones decides
// who sees it). 'personal' is for the visitor whose view made the number -
// every 100,000 up to and including the million. 'everyone' is the million,
// shown once to everybody else: the app hit it, not them.
// The aurora sits quiet while the counter climbs, then flares like a substorm onset at 100,000.
// "Share my celebration card" makes a 1080x1350 PNG and hands it to the phone's share sheet;
// where files can't be shared it downloads the card and points people at the Facebook page.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { drawAuroraScene } from '../utils/auroraScene';

const FB_PAGE = 'https://www.facebook.com/spot.the.aurora';
const SITE = 'https://spottheaurora.co.nz';

interface Props {
  /** The milestone being celebrated. */
  target: number;
  mode: 'personal' | 'everyone';
  onClose: () => void;
}

// Shrinks a line on the share card until it fits the width.
function fitText(x: CanvasRenderingContext2D, text: string, weight: number, size: number, font: string, maxW: number): void {
  let s = size;
  x.font = `${weight} ${s}px ${font}`;
  while (s > 24 && x.measureText(text).width > maxW) { s -= 4; x.font = `${weight} ${s}px ${font}`; }
}

const MilestoneCelebration: React.FC<Props> = ({ target, mode, onClose }) => {
  const personal = mode === 'personal';
  const nth = target.toLocaleString('en-NZ');
  const short = target >= 1000000 ? `${target / 1000000}m` : `${target / 1000}k`;
  const shareText = personal
    ? `I just became the ${nth}th viewer of Spot The Aurora! @spot.the.aurora ${SITE}`
    : `Spot The Aurora just hit ${nth} views! @spot.the.aurora ${SITE}`;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const logoRef = useRef<HTMLImageElement | null>(null);
  const t0 = useRef(performance.now());
  const onsetAt = useRef<number | null>(null);
  const [shown, setShown] = useState(false);
  const [count, setCount] = useState(target - 50);
  const [onset, setOnset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);

  // Lock the page behind while the celebration is up (iOS otherwise scrolls the app underneath).
  useEffect(() => {
    const html = document.documentElement, prev = html.style.overflow;
    html.style.overflow = 'hidden';
    return () => { html.style.overflow = prev; };
  }, []);

  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const logo = new Image(); logo.src = '/icons/android-chrome-192x192.png'; logoRef.current = logo;
    const tm = setTimeout(() => setShown(true), 150);
    const countStart = performance.now() + (reduce ? 0 : 700), countDur = reduce ? 1 : 2600, from = target - 50;
    let raf = 0, last = -1;
    const loop = (now: number) => {
      const c = canvasRef.current;
      if (c) {
        const dpr = Math.min(1.5, window.devicePixelRatio || 1);
        const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
        if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
        const t = reduce ? 3 : (now - t0.current) / 1000;
        const p = Math.min(1, Math.max(0, (now - countStart) / countDur)), e = 1 - Math.pow(1 - p, 3);
        const n = Math.round(from + (target - from) * e);
        if (n !== last) { last = n; setCount(n); }
        if (p >= 1 && onsetAt.current == null) { onsetAt.current = now; setOnset(true); }
        let I = 0.25 + 0.15 * e;
        if (onsetAt.current != null) { const s = (now - onsetAt.current) / 1000; I = 0.8 + 0.6 * Math.exp(-s * 0.9) + 0.06 * Math.sin(t * 0.7); }
        const ctx = c.getContext('2d');
        if (ctx) drawAuroraScene(ctx, w, h, t, I, { horizon: w > h ? 0.74 : 0.7 });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); clearTimeout(tm); };
  }, [target]);

  useEffect(() => () => { if (fallbackUrl) URL.revokeObjectURL(fallbackUrl); }, [fallbackUrl]);

  const makeCard = useCallback(async (): Promise<Blob> => {
    try { await (document as any).fonts?.ready; } catch { /* fine */ }
    const W = 1080, H = 1350, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const x = cv.getContext('2d')!;
    drawAuroraScene(x, W, H, (performance.now() - t0.current) / 1000, 1.25, { horizon: 0.74 });
    const top = x.createLinearGradient(0, 0, 0, 640); top.addColorStop(0, 'rgba(1,3,10,0.85)'); top.addColorStop(1, 'rgba(1,3,10,0)');
    x.fillStyle = top; x.fillRect(0, 0, W, 640);
    const logo = logoRef.current;
    if (logo?.complete) { x.save(); x.beginPath(); (x as any).roundRect(80, 80, 120, 120, 28); x.clip(); x.drawImage(logo, 80, 80, 120, 120); x.restore(); }
    const font = 'Inter, system-ui, sans-serif';
    x.fillStyle = '#fff'; x.font = `800 40px ${font}`; x.textBaseline = 'middle'; x.fillText('Spot The Aurora', 228, 140);
    x.textBaseline = 'alphabetic';
    x.fillStyle = '#6ee7b7'; x.font = `800 34px ${font}`; x.fillText(personal ? 'CONGRATULATIONS!' : 'WE DID IT!', 80, 310);
    x.fillStyle = '#fff';
    const lines = personal ? [`I'm the ${nth}th`, 'viewer of', 'Spot The Aurora'] : ['Spot The Aurora', 'just hit a', 'million views'];
    lines.forEach((l, i) => { fitText(x, l, 900, 84, font, W - 160); x.fillText(l, 80, 410 + i * 92); });
    x.shadowColor = 'rgba(110,231,183,0.6)'; x.shadowBlur = 40; fitText(x, nth, 900, 150, font, W - 150);
    x.fillText(nth, 72, 800); x.shadowBlur = 0;
    const bot = x.createLinearGradient(0, H - 260, 0, H); bot.addColorStop(0, 'rgba(1,3,10,0)'); bot.addColorStop(1, 'rgba(1,3,10,0.9)');
    x.fillStyle = bot; x.fillRect(0, H - 260, W, 260);
    x.fillStyle = '#fff'; x.font = `800 44px ${font}`; x.fillText('spottheaurora.co.nz', 80, H - 120);
    x.fillStyle = '#7dd3fc'; x.font = `700 34px ${font}`; x.fillText('@spot.the.aurora', 80, H - 68);
    return new Promise((res, rej) => cv.toBlob(b => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'));
  }, [target, nth, personal]);

  const share = useCallback(async () => {
    if (busy) return; setBusy(true);
    try {
      const blob = await makeCard();
      const file = new File([blob], `spot-the-aurora-${short}.png`, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        try { await navigator.share({ files: [file], title: 'Spot The Aurora', text: shareText }); return; }
        catch (e: any) { if (e?.name === 'AbortError') return; }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
      try { await navigator.clipboard.writeText(shareText); } catch { /* blocked */ }
      setFallbackUrl(url);
    } finally { setBusy(false); }
  }, [busy, makeCard, short, shareText]);

  const close = () => { setShown(false); setTimeout(onClose, 700); };
  const chip = onset ? { text: `Substorm onset: ${nth} views`, color: '#f472b6', border: 'rgba(244,114,182,0.6)' }
                     : { text: 'Energy building...', color: '#6ee7b7', border: 'rgba(110,231,183,0.4)' };
  const fade = `transition-all duration-700 ease-out ${shown ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`;

  return (
    <div className="fixed inset-0 z-[100005] flex min-h-[100dvh] flex-col items-center overflow-y-auto overscroll-contain bg-[#01030a] px-5"
      style={{ paddingTop: 'max(24px, env(safe-area-inset-top))', paddingBottom: 'max(16px, env(safe-area-inset-bottom))', paddingLeft: 'max(20px, env(safe-area-inset-left))', paddingRight: 'max(20px, env(safe-area-inset-right))' }} role="dialog" aria-modal="true" aria-label={`${nth} views celebration`}>
      <canvas ref={canvasRef} className="pointer-events-none fixed inset-0 h-full w-full" />
      <div className={`relative z-10 flex w-full max-w-[380px] flex-col items-center gap-[18px] text-center [@media(max-height:700px)]:gap-3 ${fade}`}>
        <div className="flex items-center gap-2 rounded-full bg-neutral-950/70 py-1.5 pl-2 pr-3 text-xs font-bold transition-all duration-500" style={{ color: chip.color, border: `1px solid ${chip.border}` }}>
          <span className="h-2 w-2 rounded-full" style={{ background: chip.color, boxShadow: `0 0 10px ${chip.color}` }} />
          <span>{chip.text}</span>
        </div>
        <img src="/icons/android-chrome-192x192.png" alt="" className="h-[84px] w-[84px] rounded-[20px] [@media(max-height:700px)]:h-16 [@media(max-height:700px)]:w-16 [@media(max-height:700px)]:rounded-2xl shadow-[0_14px_34px_rgba(0,0,0,0.7)]" />
        <div className="flex flex-col gap-1.5">
          <div className="text-[13px] font-extrabold uppercase tracking-[0.18em] text-emerald-300">{personal ? 'Congratulations!' : 'We did it!'}</div>
          <h2 className="text-[clamp(22px,7vw,28px)] font-black leading-[1.1] tracking-tight text-white [text-shadow:0_2px_18px_rgba(0,0,0,0.8)]" style={{ textWrap: 'balance' as any }}>
            {personal ? <>You're the {nth}th viewer of Spot The Aurora</> : <>Spot The Aurora just hit {nth} views</>}
          </h2>
        </div>
        <div className="text-[clamp(44px,15vw,58px)] font-black leading-none [@media(max-height:700px)]:text-[44px] tracking-tight text-white tabular-nums [text-shadow:0_0_28px_rgba(110,231,183,0.55),0_2px_10px_rgba(0,0,0,0.8)]">
          {count.toLocaleString('en-NZ')}
        </div>
        <p className="max-w-[340px] text-[15px] leading-relaxed [@media(max-height:620px)]:text-[13px] text-neutral-200 [text-shadow:0_1px_8px_#000]">
          {personal
            ? "Thank you for standing out in the cold with us, refreshing the forecast and looking south. Every one of those nights helped build this. Here's to many more clear skies."
            : "A million times, someone opened this app and looked south. Thank you for every one of those cold nights with us, you got us here. Here's to many more clear skies."}
        </p>
      </div>
      <div className="min-h-6 flex-1" />
      <div className={`relative z-10 flex w-full max-w-[380px] flex-col gap-2.5 ${shown ? 'opacity-100' : 'opacity-0'} transition-opacity delay-300 duration-700`}>
        <p className="text-center text-sm leading-relaxed text-neutral-200 [text-shadow:0_1px_8px_#000]">
          Share your celebration card and tag{' '}
          <a href={FB_PAGE} target="_blank" rel="noopener noreferrer" className="font-bold text-sky-300 no-underline hover:text-sky-200">@spot.the.aurora</a> on Facebook
        </p>
        <button onClick={share} disabled={busy} className="flex min-h-[54px] w-full items-center justify-center gap-2.5 rounded-[14px] bg-sky-500 text-[17px] font-extrabold text-white shadow-[0_12px_28px_-10px_rgba(14,165,233,0.8)] transition hover:bg-sky-600 active:scale-[0.98] disabled:opacity-80">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" /><path d="M16 6l-4-4-4 4" /><path d="M12 2v14" /></svg>
          {busy ? 'Creating your card...' : 'Share my celebration card'}
        </button>
        {fallbackUrl && (
          <div className="flex items-center gap-3 rounded-[14px] border border-neutral-800 bg-neutral-950/85 p-3">
            <img src={fallbackUrl} alt="Your celebration card" className="h-20 w-16 flex-none rounded-lg bg-neutral-900 object-cover" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <p className="text-left text-[13px] leading-snug text-neutral-300">Image saved. Post it to Facebook and tag @spot.the.aurora.</p>
              <a href={FB_PAGE} target="_blank" rel="noopener noreferrer" className="flex min-h-[40px] items-center justify-center rounded-[10px] bg-[#1877f2] text-sm font-bold text-white no-underline">Open Spot The Aurora on Facebook</a>
            </div>
          </div>
        )}
        <button onClick={close} className="min-h-[44px] rounded-xl text-sm font-semibold text-neutral-300 transition hover:text-white [text-shadow:0_1px_6px_#000]">Continue to the forecast</button>
      </div>
    </div>
  );
};

export default MilestoneCelebration;
