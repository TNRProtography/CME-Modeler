// The part of a page a link asks for: /solar-dashboard#goes-xray-flux-section.
//
// Notifications open the app this way, at the panel that shows what they were
// about. Read when the app starts, because the app tidies its address as it
// settles on a page and the #section can go with it.

const SECTION_ID = /^[A-Za-z][A-Za-z0-9_-]{0,80}$/;

export const initialSectionId: string | null = (() => {
  try {
    const id = decodeURIComponent(window.location.hash.slice(1));
    return SECTION_ID.test(id) ? id : null;
  } catch {
    return null;
  }
})();

/**
 * Scroll to a section once it exists and give it a brief outline, so it is
 * clear which panel the link meant. Panels load lazily and charts grow as
 * their data arrives, so it waits for the element and scrolls once more after
 * the page has settled. Returns a function that stops it.
 */
export function focusSection(id: string, { timeoutMs = 20000 } = {}): () => void {
  let stopped = false;
  const timers: number[] = [];
  const started = Date.now();
  const show = (el: HTMLElement) => {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const prev = { outline: el.style.outline, offset: el.style.outlineOffset, transition: el.style.transition };
    el.style.transition = 'outline-color 600ms ease';
    el.style.outline = '2px solid rgba(56, 189, 248, 0.9)';
    el.style.outlineOffset = '4px';
    timers.push(window.setTimeout(() => { el.style.outline = 'transparent solid 2px'; }, 2600));
    timers.push(window.setTimeout(() => {
      el.style.outline = prev.outline; el.style.outlineOffset = prev.offset; el.style.transition = prev.transition;
    }, 3400));
    // Charts above it fill in and push it down: scroll again once they have.
    timers.push(window.setTimeout(() => { if (!stopped) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 1800));
  };
  const look = () => {
    if (stopped) return;
    const el = document.getElementById(id);
    if (el) { show(el); return; }
    if (Date.now() - started < timeoutMs) timers.push(window.setTimeout(look, 300));
  };
  look();
  return () => { stopped = true; timers.forEach((t) => window.clearTimeout(t)); };
}
