// --- START OF FILE components/CombinedForecastPanel.tsx ---
import React, { useMemo } from "react";
import { SubstormForecast } from "../types";

/**
 * CombinedForecastPanel
 * Consolidates your main "Forecast" score and "Substorm Forecast" into a single, tidy card.
 *
 * Import in ForecastDashboard with:
 *   import { CombinedForecastPanel } from './CombinedForecastPanel';
 */

type GaugeKey = "gray" | "yellow" | "orange" | "red" | "purple" | "pink";

export interface CombinedForecastPanelProps {
  // Left (Forecast score)
  score: number | null | undefined;
  blurb: string | undefined;
  lastUpdated: string | undefined;
  locationBlurb: string | undefined;
  getGaugeStyle: (
    v: number | null,
    type: "power" | "speed" | "density" | "bt" | "bz"
  ) => { color: string; emoji: string; percentage: number };
  getScoreColorKey: (score: number) => GaugeKey;
  getAuroraEmoji: (score: number | null) => string;
  gaugeColors: Record<GaugeKey, { solid: string }>;

  // Right (Substorm)
  forecast?: SubstormForecast | null;

  // Help modals
  onOpenModal: (id: string) => void;
}

const clampPct = (n: number | undefined | null) =>
  Math.min(100, Math.max(0, Math.round(Number.isFinite(Number(n)) ? Number(n) : 0)));

const visibilityMeaning = (score: number | null | undefined) => {
  const s = clampPct(score ?? 0);
  if (s < 10)
    return {
      emoji: "😞",
      title: "Little to no auroral activity",
      advice: "Low chance right now. Monitor updates.",
    };
  if (s < 25)
    return {
      emoji: "😐",
      title: "Minimal activity likely",
      advice: "Maybe a very faint glow. Dark skies help.",
    };
  if (s < 40)
    return {
      emoji: "😊",
      title: "Camera-clear; sometimes naked-eye",
      advice: "Check a dark southern horizon; look for subtle motion.",
    };
  if (s < 50)
    return {
      emoji: "🙂",
      title: "Faint naked-eye glow possible",
      advice: "Be patient; let eyes adapt 5–10 minutes.",
    };
  if (s < 80)
    return {
      emoji: "😀",
      title: "Good chance of visible color",
      advice: "Head darker; waves/brightenings likely.",
    };
  return {
    emoji: "🤩",
    title: "High probability of significant substorms",
    advice: "Watch mid-sky to high south; dynamic activity likely.",
  };
};

const likelihoodGradient = (likelihood: number) => {
  if (likelihood >= 80) return "from-emerald-400 to-green-600";
  if (likelihood >= 50) return "from-amber-400 to-orange-500";
  if (likelihood >= 25) return "from-yellow-300 to-amber-400";
  return "from-neutral-600 to-neutral-700";
};

function CombinedForecastPanel({
  score,
  blurb,
  lastUpdated,
  locationBlurb,
  getGaugeStyle,
  getScoreColorKey,
  getAuroraEmoji,
  gaugeColors,
  forecast,
  onOpenModal,
}: CombinedForecastPanelProps) {
  // Safe fallback for forecast on first render
  const {
    status = "QUIET",
    action = "Stand by and monitor conditions.",
    windowLabel = "—",
    likelihood = 0,
  } = forecast ?? ({} as SubstormForecast);

  const meaning = useMemo(() => visibilityMeaning(score), [score]);

  // Gauge + bar styling with guards
  const numericScore = typeof score === "number" ? score : null;
  const gauge = numericScore != null ? getGaugeStyle(numericScore, "power") : null;
  const barWidth = gauge ? `${gauge.percentage}%` : "0%";
  const colorKey = numericScore != null ? getScoreColorKey(numericScore) : "gray";
  const barColor = (gaugeColors[colorKey] ?? gaugeColors.gray).solid;

  const isDaylight = (blurb || "").includes("The sun is currently up");
  const statusLabel =
    typeof status === "string" ? status.replace(/_/g, " ") : "—";
  const likePct = clampPct(likelihood);

  return (
    <div className="col-span-12 card bg-neutral-950/80 p-6 space-y-6">
      {/* Header */}
      <div className="flex justify-center items-center gap-2">
        <h2 className="text-2xl font-bold text-white">Forecast &amp; Substorm</h2>
        <button
          onClick={() => onOpenModal("forecast")}
          className="p-1 rounded-full text-neutral-400 hover:bg-neutral-700"
          title="About the forecast"
          aria-label="About the forecast"
          type="button"
        >
          ?
        </button>
        <button
          onClick={() => onOpenModal("substorm-forecast")}
          className="p-1 rounded-full text-neutral-400 hover:bg-neutral-700"
          title="About the substorm forecast"
          aria-label="About the substorm forecast"
          type="button"
        >
          ?
        </button>
      </div>

      {/* Content */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Forecast (compact) */}
        <div className="bg-black/30 border border-neutral-700/30 rounded-xl p-5">
          <div className="flex items-center justify-between">
            <div className="text-6xl font-extrabold text-white">
              {numericScore !== null ? `${numericScore.toFixed(1)}%` : "..."}{" "}
              <span className="text-5xl">{getAuroraEmoji(numericScore)}</span>
            </div>
            <div className="text-right">
              <div className="text-sm text-neutral-400">
                {lastUpdated || "Updating…"}
              </div>
              <div className="text-xs text-neutral-500 mt-1 italic h-4">
                {locationBlurb || ""}
              </div>
            </div>
          </div>

          <div className="w-full bg-neutral-700 rounded-full h-3 mt-4 overflow-hidden">
            <div
              className="h-3 rounded-full transition-all"
              style={{
                width: barWidth,
                backgroundColor: barColor,
              }}
            />
          </div>

          <p className="text-neutral-300 mt-4">
            {isDaylight
              ? "The sun is currently up. Aurora visibility is not possible until after sunset. Check back later for an updated forecast!"
              : blurb || "Forecast updates hourly based on real-time space weather."}
          </p>
        </div>

        {/* Right: Substorm quick status */}
        <div className="space-y-4">
          <div className="rounded-xl bg-black/30 border border-neutral-700/30 p-4">
            <div className="text-sm text-neutral-300">Suggested action</div>
            <div className="text-base mt-1">{action}</div>
            <div className="text-xs text-neutral-500 mt-1">
              Status: {statusLabel}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <div className="text-sm text-neutral-300">Expected window</div>
              <div className="text-2xl font-semibold">{windowLabel}</div>
            </div>
            <div>
              <div className="flex justify-between items-end">
                <div className="text-sm text-neutral-300">
                  Likelihood (next hour)
                </div>
                <div className="text-lg font-semibold">{likePct}%</div>
              </div>
              <div className="mt-2 h-2.5 w-full rounded-full bg-neutral-800 overflow-hidden">
                <div
                  className={`h-full bg-gradient-to-r ${likelihoodGradient(
                    likePct
                  )}`}
                  style={{ width: `${likePct}%` }}
                />
              </div>
            </div>
          </div>

          <div>
            <div className="text-sm text-neutral-300 mb-1">
              Expected visibility (based on Spot The Aurora score)
            </div>
            <div className="rounded-lg bg-black/30 border border-neutral-700/30 p-3">
              <div className="text-base">
                <span className="mr-2">{meaning.emoji}</span>
                <span className="font-medium">{meaning.title}</span>
              </div>
              <div className="text-xs text-neutral-400 mt-1">{meaning.advice}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Support both default and named exports
export default CombinedForecastPanel;
export { CombinedForecastPanel };

// --- END OF FILE components/CombinedForecastPanel.tsx ---
