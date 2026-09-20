// --- START OF FILE src/components/game/TransitStage.tsx ---
// The bit in between, which is the part people have no feel for.
//
// This is not a drawing of the CME visualisation, it is the CME visualisation:
// the app's own SimulationCanvas, handed the cloud the player just built as if
// it were any other event in NASA's catalogue. So the shape, the shading, the
// particles and the way it decelerates are the same here as on the 3D Lab page,
// because they are literally the same code.

import React, { useCallback, useMemo, useRef, useState } from 'react';
import SimulationCanvas from '../SimulationCanvas';
import { FocusTarget, InteractionMode, ViewMode } from '../../types';
import type { PlanetLabelInfo, ProcessedCME } from '../../types';
import { formatNZ, type StormInput, type StormResult } from './stormModel';

interface Props { input: StormInput; result: StormResult; onDone: () => void; }

// The transit plays in about this many seconds however long it really took.
const PLAY_SECONDS = 11;

const TransitStage: React.FC<Props> = ({ input, result, onDone }) => {
  const [scrub, setScrub] = useState(0);
  const [focus, setFocus] = useState<FocusTarget | null>(null);
  const doneRef = useRef(false);
  const clockStart = useRef(performance.now());

  // The player's storm, in the shape the visualisation already understands.
  const cmeData = useMemo<ProcessedCME[]>(() => [{
    id: 'storm-builder',
    startTime: new Date(input.launchMs),
    speed: input.speedKms,
    longitude: input.lonDeg,
    latitude: input.latDeg,
    isEarthDirected: result.hits,
    note: 'Built in Storm Builder',
    predictedArrivalTime: result.hits ? new Date(result.arrivalMs) : null,
    link: '',
    instruments: 'Storm Builder',
    sourceLocation: `${input.lonDeg.toFixed(0)}°, ${input.latDeg.toFixed(0)}°`,
    halfAngle: input.halfWidthDeg,
  }], [input, result]);

  // The window runs from launch to a little past arrival, so the cloud is seen
  // leaving, crossing and getting here rather than appearing halfway out.
  const minDate = input.launchMs - 3 * 3_600_000;
  const maxDate = input.launchMs + (result.transitHours + 4) * 3_600_000;
  const spanHours = (maxDate - minDate) / 3_600_000;
  // SimulationCanvas advances the scrubber by 3 * speed hours per second.
  const timelineSpeed = spanHours / (3 * PLAY_SECONDS);

  const getClockElapsedTime = useCallback(() => (performance.now() - clockStart.current) / 1000, []);
  const resetClock = useCallback(() => { clockStart.current = performance.now(); }, []);
  const noop = useCallback(() => {}, []);
  const setLabels = useCallback((_: PlanetLabelInfo[]) => {}, []);
  const setDom = useCallback((_: HTMLCanvasElement | null) => {}, []);

  // Looking down on the whole inner system from above, centred on the Sun.
  // The point of this screen is the crossing, so you have to be able to see
  // both ends of it; sitting behind Earth puts you inside the cloud when it
  // arrives and you never see it come.
  const handleCameraReady = useCallback(() => {
    setFocus(f => (f === FocusTarget.SUN ? f : FocusTarget.SUN));
  }, []);

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone();
  }, [onDone]);

  const hoursIn = (scrub / 1000) * spanHours - 3;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-shrink-0 px-4 py-3 text-center">
        <p className="text-xs uppercase tracking-wider text-neutral-500">On its way</p>
        <p className="text-3xl font-bold text-sky-300 font-mono tabular-nums">
          {Math.max(0, Math.min(result.transitHours, hoursIn)).toFixed(0)}
          <span className="text-lg text-neutral-500"> / {result.transitHours.toFixed(0)} hours</span>
        </p>
        <p className="text-xs text-neutral-400 mt-0.5">
          {result.hits
            ? `Arriving ${formatNZ(result.arrivalMs)} New Zealand time`
            : 'This one is going to miss'}
        </p>
      </div>

      <div className="flex-1 min-h-0">
        <SimulationCanvas
          cmeData={cmeData}
          activeView={ViewMode.TOP}
          focusTarget={focus}
          currentlyModeledCMEId={null}
          onCMEClick={noop as any}
          timelineActive={true}
          timelinePlaying={true}
          timelineSpeed={timelineSpeed}
          timelineValue={scrub}
          timelineMinDate={minDate}
          timelineMaxDate={maxDate}
          setPlanetMeshesForLabels={setLabels}
          setRendererDomElement={setDom}
          onCameraReady={handleCameraReady}
          getClockElapsedTime={getClockElapsedTime}
          resetClock={resetClock}
          onScrubberChangeByAnim={setScrub}
          onTimelineEnd={finish}
          showExtraPlanets={false}
          showMoonL1={false}
          showFluxRope={false}
          showHss={false}
          coronalHoles={[]}
          chDetectedAtMs={null}
          chEvolutions={[]}
          dataVersion={1}
          interactionMode={InteractionMode.MOVE}
          bzSouth={result.minBz < 0}
          measuredWindSpeedKms={400}
        />
      </div>

      <div className="flex-shrink-0 p-3">
        <button onClick={finish}
          className="w-full py-2 rounded-lg text-sm text-neutral-400 border border-neutral-700/80 active:scale-[0.99]">
          Skip ahead
        </button>
      </div>
    </div>
  );
};

export default TransitStage;
// --- END OF FILE src/components/game/TransitStage.tsx ---
