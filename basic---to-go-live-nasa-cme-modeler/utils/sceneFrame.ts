// The 3D scene's own frames, for things that follow it on the page.
//
// The planet and sunspot labels used to run an animation loop each - a dozen
// loops, every one moving its label on every display refresh, 120 times a
// second on a ProMotion Mac, and still going while the scene was paused
// behind a window. They follow the scene instead: SimulationCanvas announces
// each frame it draws, after drawing it, and a label moves then. When the
// scene is capped or paused, so are they.

type Listener = () => void;
const listeners = new Set<Listener>();

/** Run `fn` after each frame the scene draws. Returns the unsubscribe. */
export function onSceneFrame(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Called by the scene after it draws a frame. */
export function emitSceneFrame(): void {
  for (const fn of listeners) {
    try { fn(); } catch { /* one label failing must not stop the scene */ }
  }
}
