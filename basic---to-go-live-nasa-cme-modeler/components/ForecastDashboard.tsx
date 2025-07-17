import React, { useState } from "react";
import MetricCard from "./MetricCard";
import DataChart from "./DataChart";
import CaretIcon from "./icons/CaretIcon";

// ---- Types ----
type MetricKey = "aurora" | "hemisphericPower" | "btbz"; // Add more if you want

interface MagneticFieldEntry {
  timestamp: number;
  bt?: number;
  bz?: number;
  hemisphericPower?: number;
  baseScore?: number;
  finalScore?: number;
}

interface ForecastData {
  currentForecast: {
    spotTheAuroraForecast: number;
    baseScore: number;
    lastUpdated: number;
    inputs: {
      hemisphericPower: number;
      magneticField: { bt: number; bz: number };
      moonReduction: number;
      owmDataLastFetched: number;
    };
    moon: {
      rise: number;
      set: number;
      illumination: number;
    };
    sun: {
      rise: number;
      set: number;
    };
  };
  historicalData: MagneticFieldEntry[];
}

// ---- Props ----
interface ForecastDashboardProps {
  forecastData: ForecastData;
}

const METRICS = [
  { key: "aurora", label: "Aurora Forecast", unit: "%", show: true },
  { key: "hemisphericPower", label: "Hemispheric Power", unit: "GW", show: true },
  { key: "btbz", label: "IMF Bt/Bz", unit: "nT", show: true },
  // add more metrics here if needed!
  // { key: "moon", label: "Moon", unit: "", show: false }, // Excluded
];

const ForecastDashboard: React.FC<ForecastDashboardProps> = ({ forecastData }) => {
  const [expandedMetric, setExpandedMetric] = useState<null | MetricKey>(null);

  // ---- Build current/live values ----
  const liveValues: Record<MetricKey, number | string> = {
    aurora: forecastData.currentForecast.spotTheAuroraForecast,
    hemisphericPower: forecastData.currentForecast.inputs.hemisphericPower,
    btbz: `${forecastData.currentForecast.inputs.magneticField.bt?.toFixed(1)}, ${forecastData.currentForecast.inputs.magneticField.bz?.toFixed(1)}`,
  };

  // ---- Chart Data builder for each metric ----
  function getChartData(metricKey: MetricKey, hours: number) {
    const now = Date.now();
    const cutoff = now - hours * 60 * 60 * 1000;
    if (metricKey === "aurora") {
      // Use "finalScore" from historicalData for Aurora
      return forecastData.historicalData
        .filter(d => d.timestamp > cutoff && typeof d.finalScore === "number")
        .map(d => ({ x: d.timestamp, y: d.finalScore }));
    }
    if (metricKey === "hemisphericPower") {
      return forecastData.historicalData
        .filter(d => d.timestamp > cutoff && typeof d.hemisphericPower === "number")
        .map(d => ({ x: d.timestamp, y: d.hemisphericPower }));
    }
    if (metricKey === "btbz") {
      // Show both Bt/Bz lines
      return forecastData.historicalData
        .filter(
          d =>
            d.timestamp > cutoff &&
            typeof d.bt === "number" &&
            typeof d.bz === "number"
        )
        .map(d => ({ x: d.timestamp, bt: d.bt, bz: d.bz }));
    }
    return [];
  }

  // ---- Main Render ----
  return (
    <section className="w-full max-w-3xl mx-auto py-4 px-2">
      <h2 className="text-2xl font-bold mb-3 text-aurora-400 drop-shadow">Aurora Dashboard</h2>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {METRICS.filter(m => m.show).map(metric => {
          // Expanded box is full-width and overlays others
          const isExpanded = expandedMetric === metric.key;
          const cardContent = (
            <div
              className={`
                relative rounded-xl border border-neutral-700 bg-neutral-900 p-4 shadow 
                flex items-center justify-between cursor-pointer
                transition-all duration-300
                focus-within:ring-2 focus-within:ring-aurora-400
                ${isExpanded ? "z-20 col-span-full" : ""}
              `}
              tabIndex={0}
              aria-expanded={isExpanded}
              aria-label={isExpanded
                ? `Collapse ${metric.label} graph`
                : `Expand ${metric.label} graph`}
              onClick={() =>
                setExpandedMetric(isExpanded ? null : (metric.key as MetricKey))
              }
              onKeyDown={e => {
                if (e.key === "Enter" || e.key === " ") {
                  setExpandedMetric(isExpanded ? null : (metric.key as MetricKey));
                }
                if (e.key === "Escape") {
                  setExpandedMetric(null);
                }
              }}
            >
              <div>
                <div className="text-lg font-bold text-neutral-200">{metric.label}</div>
                <div className="text-2xl font-mono mt-1 text-aurora-200">
                  {liveValues[metric.key]}
                  <span className="ml-1 text-base text-neutral-400">{metric.unit}</span>
                </div>
              </div>
              <CaretIcon
                className={`w-7 h-7 ml-2 transition-transform ${
                  isExpanded ? "rotate-180 text-aurora-400" : "text-neutral-400"
                }`}
                aria-hidden
              />
            </div>
          );

          return (
            <div
              key={metric.key}
              className={isExpanded ? "col-span-full w-full" : ""}
              style={isExpanded ? { gridColumn: "1 / -1" } : {}}
            >
              {cardContent}
              {isExpanded && (
                <div className="mt-2 bg-neutral-950 border border-neutral-700 rounded-xl p-4 shadow-2xl">
                  <DataChart
                    data={getChartData(
                      metric.key as MetricKey,
                      2 // Default to 2h, DataChart has window switcher
                    )}
                    metricKey={metric.key}
                    unit={metric.unit}
                    isBtBz={metric.key === "btbz"}
                  />
                  <div className="mt-1 text-sm text-neutral-500">
                    Showing last 2–24 hours. Switch time window above chart.
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
};

export default ForecastDashboard;
