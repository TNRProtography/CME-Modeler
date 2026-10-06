// How often an animation is drawn, at most.
//
// A browser asks for a frame on every display refresh: 60 times a second on
// most screens, 120 on a ProMotion Mac or recent iPhone, 144 or more on a
// gaming monitor. The app's animations look no smoother past 60, so each one
// skips the extra refreshes rather than doubling its work on a fast screen.
// Just under 60 Hz's 16.7 ms, so a 60 Hz screen's slightly early frames are
// never dropped.
export const MIN_FRAME_MS = 1000 / 60 - 2;
