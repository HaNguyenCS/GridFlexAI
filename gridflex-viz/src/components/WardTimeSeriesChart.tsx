import { useMemo } from "react";
import type { ZoneTimePoint } from "../lib/types";
import { MAX_HISTORY_POINTS } from "../lib/history";

const COLORS = {
  demand: "#f59e0b",
  baseline_demand: "#78716c",
  supply: "#22d3ee",
  effective_capacity: "#6366f1",
  owned_capacity: "#64748b",
};

const PAD = { top: 16, right: 12, bottom: 28, left: 44 };

interface Props {
  zoneId: string | null;
  wardName?: string;
  points: ZoneTimePoint[];
}

interface Series {
  key: keyof typeof COLORS;
  label: string;
  dashed?: boolean;
  values: (number | undefined)[];
}

function niceMax(value: number): number {
  if (value <= 0) return 100;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
}

export function WardTimeSeriesChart({ zoneId, wardName, points }: Props) {
  const chart = useMemo(() => {
    if (!points.length) return null;

    const series: Series[] = [
      {
        key: "demand",
        label: "Demand",
        values: points.map((p) => p.demand),
      },
      {
        key: "baseline_demand",
        label: "Baseline",
        dashed: true,
        values: points.map((p) => p.baseline_demand),
      },
      {
        key: "effective_capacity",
        label: "Effective capacity",
        values: points.map((p) => p.effective_capacity),
      },
      {
        key: "owned_capacity",
        label: "Owned capacity",
        dashed: true,
        values: points.map((p) => p.owned_capacity),
      },
      {
        key: "supply",
        label: "Supply",
        values: points.map((p) => p.supply),
      },
    ];

    const allValues = series.flatMap((s) =>
      s.values.filter((v): v is number => v != null && !Number.isNaN(v))
    );
    const maxY = niceMax(Math.max(...allValues, 1));
    const width = 640;
    const height = 200;
    const innerW = width - PAD.left - PAD.right;
    const innerH = height - PAD.top - PAD.bottom;

    const xAt = (index: number) =>
      PAD.left + (index / Math.max(points.length - 1, 1)) * innerW;
    const yAt = (value: number) => PAD.top + innerH - (value / maxY) * innerH;

    const paths = series.map((s) => {
      const segments: string[] = [];
      let segment: string[] = [];

      s.values.forEach((value, index) => {
        if (value == null || Number.isNaN(value)) {
          if (segment.length) {
            segments.push(segment.join(" "));
            segment = [];
          }
          return;
        }
        segment.push(`${segment.length ? "L" : "M"} ${xAt(index).toFixed(1)} ${yAt(value).toFixed(1)}`);
      });
      if (segment.length) segments.push(segment.join(" "));

      return { ...s, d: segments.join(" ") };
    });

    const yTicks = [0, maxY * 0.5, maxY];
    const xLabels = [
      {
        index: 0,
        label: formatAxisTime(points[0]),
      },
      {
        index: points.length - 1,
        label: formatAxisTime(points[points.length - 1]),
      },
    ];

    return { width, height, maxY, paths, yTicks, xLabels, xAt, yAt, innerH };
  }, [points]);

  if (!zoneId) {
    return (
      <section className="chart-panel panel flex h-full items-center justify-center">
        <p className="text-sm text-slate-500">
          Click a ward — chart uses simulated grid time (fast-forward).
        </p>
      </section>
    );
  }

  if (!chart || points.length < 2) {
    return (
      <section className="chart-panel panel flex h-full flex-col justify-center gap-2 px-4">
        <h2 className="panel-title">{zoneId}</h2>
        <p className="text-sm text-slate-500">
          Collecting samples… ({points.length}/{MAX_HISTORY_POINTS} max)
        </p>
      </section>
    );
  }

  return (
    <section className="chart-panel panel flex h-full flex-col gap-2">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="panel-title">Ward time series</h2>
          <p className="text-sm font-medium text-slate-200">
            {zoneId}
            {wardName ? ` · ${wardName}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-slate-400">
          {chart.paths.map((s) => (
            <span key={s.key} className="legend-item">
              <i
                style={{
                  background: COLORS[s.key],
                  opacity: s.dashed ? 0.55 : 1,
                }}
              />
              {s.label}
            </span>
          ))}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-x-auto">
        <svg
          viewBox={`0 0 ${chart.width} ${chart.height}`}
          className="h-full w-full min-w-[420px]"
          role="img"
          aria-label={`Demand and capacity time series for ${zoneId}`}
        >
          {chart.yTicks.map((tick) => {
            const y = chart.yAt(tick);
            return (
              <g key={tick}>
                <line
                  x1={PAD.left}
                  x2={chart.width - PAD.right}
                  y1={y}
                  y2={y}
                  stroke="rgba(255,255,255,0.06)"
                />
                <text
                  x={PAD.left - 8}
                  y={y + 4}
                  textAnchor="end"
                  fill="#64748b"
                  fontSize="10"
                >
                  {Math.round(tick)}
                </text>
              </g>
            );
          })}

          {chart.paths.map((s) =>
            s.d ? (
              <path
                key={s.key}
                d={s.d}
                fill="none"
                stroke={COLORS[s.key]}
                strokeWidth={
                  s.key === "owned_capacity" || s.key === "baseline_demand"
                    ? 1.5
                    : 2.25
                }
                strokeDasharray={s.dashed ? "5 4" : undefined}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={s.dashed ? 0.75 : 1}
              />
            ) : null
          )}

          {chart.xLabels.map(({ index, label }) => (
            <text
              key={index}
              x={chart.xAt(index)}
              y={chart.height - 8}
              textAnchor={index === 0 ? "start" : "end"}
              fill="#64748b"
              fontSize="10"
            >
              {label}
            </text>
          ))}
        </svg>
      </div>
    </section>
  );
}

function formatAxisTime(point?: ZoneTimePoint): string {
  if (!point) return "—";
  if (point.sim_time) return point.sim_time;
  if (!point.ts) return "—";
  return new Date(point.ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}
