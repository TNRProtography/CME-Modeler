// The what's-new tour for 2.0: the guided tutorial's machinery, walking
// through what changed, with each step saying what the feature shows right
// now (utils/releaseTourLive) where the data is to hand.

import type { TutorialStep } from '../components/AppTutorial';
import type { ReleaseTourLive } from './releaseTourLive';
import { aboutLink } from './aboutSite';

const nz = (ms: number) => new Date(ms).toLocaleString('en-NZ', {
  timeZone: 'Pacific/Auckland', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
});

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function buildReleaseTourSteps(live: ReleaseTourLive, opts: { onShowCme?: (id: string) => void } = {}): TutorialStep[] {
  const steps: TutorialStep[] = [];

  steps.push({
    id: 'release-welcome', section: 'Welcome', emoji: '✨',
    title: 'A tour of what is new in 2.0',
    content: 'A quick walk through the biggest changes, using what the Sun and the solar wind are doing right now. It takes about a minute, and you can stop at any time.',
    action: {}, placement: 'bottom',
  });

  steps.push({
    id: 'release-3day', section: 'Forecast', emoji: '📅',
    title: 'The app\'s own three day forecast',
    content: 'NOAA\'s Kp forecast is gone. Every hour for the next three days now shows what you could see from where you are: a <strong>full block for naked eye</strong>, two thirds for a phone, a third for a camera. It allows for daylight, twilight and the Moon, and marks when a coronal hole stream or a CME is due.',
    action: { closeSettings: true, page: 'forecast', forecastView: 'simple', scrollTo: 'kp-forecast-section', highlightId: 'kp-forecast-section' },
    placement: 'top',
  });

  const sub = live.substorm;
  steps.push({
    id: 'release-substorm', section: 'Forecast', emoji: '⚡',
    title: 'Substorms, stage by stage',
    content: (sub
      ? `Right now the substorm index is <strong>${sub.score}${sub.level ? ` (${sub.level})` : ''}</strong>. `
      : '')
      + 'Substorm alerts now come in four stages, energy building, likely, imminent and under way, each with its own switch. The bars under each alert icon count up through the stages, so you can tell from the lock screen how close the next eruption is.',
    action: { page: 'forecast', forecastView: 'advanced', scrollTo: 'substorm-index-section', highlightId: 'substorm-index-section' },
    placement: 'top',
  });

  steps.push({
    id: 'release-magnetotail', section: 'Forecast', emoji: '🌀',
    title: 'Magnetotail, live',
    content: 'A live scene of how aurora is born, driven by the solar wind being measured right now: watch the tail load up, stretch and snap. Tap <strong>How aurora forms</strong> for a 3D explainer.',
    action: { page: 'forecast', forecastView: 'advanced', scrollTo: 'magnetotail-section', highlightId: 'magnetotail-section' },
    placement: 'top',
  });

  steps.push({
    id: 'release-solarwind', section: 'Forecast', emoji: '🌬️',
    title: 'When a CME hits',
    content: 'Speed, density and the magnetic field, stacked so a shock stands out. A CME arrival alert now opens straight here, and shock alerts are reliable again: each one is sent once, when it happens.',
    action: { page: 'forecast', forecastView: 'advanced', scrollTo: 'solar-wind-quick-view-section', highlightId: 'solar-wind-quick-view-section' },
    placement: 'top',
  });

  const reg = live.regions;
  const big = reg?.biggest;
  steps.push({
    id: 'release-sunspots', section: 'Solar Activity', emoji: '☀️',
    title: 'The sunspot tracker remembers',
    content: (reg && big
      ? `There ${reg.count === 1 ? 'is' : 'are'} <strong>${plural(reg.count, 'numbered region')}</strong> on the Sun right now. The biggest, <strong>AR${big.id}</strong>, covers ${big.area} millionths of the hemisphere${big.spots != null ? ` with ${plural(big.spots, 'spot')}` : ''}${big.mChance != null ? `, and has a ${big.mChance}% chance of an M-class flare` : ''}. `
      : '')
      + 'Every region\'s changes are now kept for two weeks. Scrub back through a week of imagery and regions appear and fade when they really did, and tap one for charts of its flare chances, size, spots and magnetic field.',
    action: { page: 'solar-activity', scrollTo: 'active-sunspots-section', highlightId: 'active-sunspots-section' },
    placement: 'top',
  });

  const h = live.holes;
  steps.push({
    id: 'release-holes', section: 'Solar Activity', emoji: '🕳️',
    title: 'Coronal Hole Tracker',
    content: (h != null
      ? `The latest scan found <strong>${plural(h, 'coronal hole')}</strong> on the Sun. `
      : '')
      + 'Every hole is found live in the SUVI imagery, with its size, polarity, stream speed and when that stream reaches Earth. Each keeps its number for life, its history is kept for 90 days, and the week of imagery now plays smoothly at up to 20x.',
    action: { page: 'solar-activity', scrollTo: 'coronal-hole-tracker-section', highlightId: 'coronal-hole-tracker-section' },
    placement: 'top',
  });

  const c = live.cmes;
  const f = c?.fastest;
  steps.push({
    id: 'release-cme', section: '3D View', emoji: '🌞',
    title: 'Coronal holes, streams and CMEs in 3D',
    content: (c
      ? (c.earthDirected && f
        ? `<strong>${plural(c.earthDirected, 'CME')} ${c.earthDirected === 1 ? 'is' : 'are'} heading for Earth</strong>. The fastest, at ${f.speed} km/s, is now selected${f.arrivalMs ? `, due around ${nz(f.arrivalMs)}` : ''}. `
        : `${plural(c.total, 'CME')} in view, none aimed at Earth right now. `)
      : '')
      + 'Coronal holes sit on the Sun in their real shape, their high speed streams grow over time, and every CME is drawn tilted the way it actually left the Sun. Tap a CME alert and it opens here, on that CME.',
    action: {
      page: 'modeler',
      run: f && opts.onShowCme ? () => opts.onShowCme!(f.id) : undefined,
    },
    placement: 'bottom',
  });

  steps.push({
    id: 'release-alerts', section: 'Alerts', emoji: '🔔',
    title: 'Notifications that work',
    content: 'Alerts now reach everyone, each has its own icon, and tapping one opens the app at what it is about. Flares come once per level you choose and once at the peak, and there is a new alert for an Earth-directed CME, with a minimum speed you set.',
    action: { openSettings: true, scrollTo: 'settings-notifications-section', highlightId: 'settings-notifications-section' },
    placement: 'top',
  });

  steps.push({
    id: 'release-done', section: 'All Done', emoji: '✅',
    title: 'That\'s the tour',
    content: `There is a lot more in 2.0. The <a href="${aboutLink('changelog')}" target="_blank" rel="noopener noreferrer" class="text-sky-400 underline">full change log</a> has every change, and the full app tutorial is in Settings any time.`,
    action: { closeSettings: true },
    placement: 'bottom',
  });

  return steps;
}
