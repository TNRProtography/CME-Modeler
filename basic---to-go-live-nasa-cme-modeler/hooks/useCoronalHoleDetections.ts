// The shared coronal hole detections, as React state.
//
// Any number of panels can call this. The work happens once, in the store,
// and each panel gets told when it changes.

import { useEffect, useState } from 'react';
import {
  ensureChDetections, getChState, subscribeToChDetections,
  type ChStoreState, type FrameRef,
} from '../utils/chDetectionStore';

export function useCoronalHoleDetections(frames: FrameRef[], enabled = true): ChStoreState {
  const [state, setState] = useState<ChStoreState>(() => getChState());

  useEffect(() => subscribeToChDetections(setState), []);

  // A key rather than the array itself: the frame list is rebuilt on every
  // poll, and a new array with identical contents must not start a new pass.
  const key = enabled
    ? frames.map((f) => f.url).sort().join('|')
    : '';

  useEffect(() => {
    if (!enabled || frames.length === 0) return;
    void ensureChDetections(frames);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  return state;
}
