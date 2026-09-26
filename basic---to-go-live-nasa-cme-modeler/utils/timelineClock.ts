// Where the CME Visualization's timeline is, 0 to 1000, while it plays.
//
// Playback used to keep this in the App's React state and move it every
// animation frame, which re-rendered the whole app sixty times a second -
// and the 3D scene ran a clock of its own as well, so the two pulled the
// position back and forth a frame apart. Now the scene is the one clock: it
// moves the position here each frame, and only the timeline bar, which has
// to show it, listens. The App takes the position back into its state when
// playback stops.

type Listener = () => void;

let value = 0;
const listeners = new Set<Listener>();

export const timelineClock = {
  get: (): number => value,
  set(next: number): void {
    if (!Number.isFinite(next) || next === value) return;
    value = next;
    for (const listener of listeners) listener();
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
};
