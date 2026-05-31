// IesoEnergyPanel — floating panel showing Ontario grid generation by fuel type.
//
// Displays real-time IESO hourly generator output data with:
//   - Current hour total output with stacked fuel bar
//   - 24-hour stacked bar chart (latest day)
//   - Per-fuel breakdown with share percentages
//   - Aggregate summary statistics
//
// Collapsible to a compact pill when not in focus.

import { useMemo, useState } from "react";
import { Lightning } from "@phosphor-icons/react";

import {
  type IesoEnergyDataset,
  type IesoFuelType,
  FUEL_LABEL,
  FUEL_COLOR,
  formatMW,
  formatMWh,
  getCurrentHourData,
} from "../lib/iesoEnergy";

interface Props {
  dataset: IesoEnergyDataset;
}

export function IesoEnergyPanel({ dataset }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  const currentHour = useMemo(() => getCurrentHourData(dataset), [dataset]);
  const currentTotal = useMemo(() => {
    if (!currentHour) return 0;
    return Object.values(currentHour.fuels).reduce((a, b) => a + b, 0);
  }, [currentHour]);

  const createdLabel = useMemo(() => {
    try {
      const d = new Date(dataset.createdAt);
      return d.toLocaleDateString("en-CA", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return dataset.createdAt;
    }
  }, [dataset.createdAt]);

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        aria-label={`Expand grid generation panel. Current output: ${formatMW(currentTotal)}`}
        className="pointer-events-auto absolute right-6 top-[72px] z-10 flex h-9 items-center gap-2 rounded-full border border-[var(--color-ink-3)] bg-[color-mix(in_oklch,var(--color-ink-1)_88%,transparent)] px-3 text-[12px] backdrop-blur-xl transition-all hover:border-[var(--color-ink-4)] active:translate-y-px"
      >
        <Lightning size={13} weight="fill" className="text-[var(--color-accent)]" />
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-6)]">
          Grid
        </span>
        <span className="font-mono text-[11px] font-semibold tabular-nums text-[var(--color-ink-8)]">
          {formatMW(currentTotal)}
        </span>
      </button>
    );
  }

  return (
    <aside
      role="region"
      aria-label="Ontario grid generation by fuel type"
      className="pointer-events-auto absolute right-6 top-[72px] z-10 w-[300px] rounded-[14px] border border-[var(--color-ink-3)] bg-[color-mix(in_oklch,var(--color-ink-1)_88%,transparent)] p-4 backdrop-blur-xl transition-all duration-300"
      style={{ boxShadow: "0 12px 40px -8px rgba(0,0,0,0.5)" }}
    >
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Lightning size={14} weight="fill" className="text-[var(--color-accent)]" />
          <span className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-[var(--color-ink-6)]">
            Grid Generation
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[9.5px] text-[var(--color-ink-5)]">
            {createdLabel}
          </span>
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            aria-label="Collapse grid generation panel"
            className="grid h-6 w-6 place-items-center rounded-md text-[var(--color-ink-6)] transition-colors hover:bg-[var(--color-ink-2)] hover:text-[var(--color-ink-8)] active:translate-y-px"
            title="Collapse"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="18 15 12 9 6 15" />
            </svg>
          </button>
        </div>
      </div>

      {/* Current hour snapshot */}
      {currentHour && (
        <CurrentHourBlock hour={currentHour} totalMW={currentTotal} />
      )}

      {/* 24-hour stacked bar chart */}
      {dataset.latestDay && (
        <div className="mb-3">
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-[var(--color-ink-5)]">
              24h Output
            </span>
            <span className="font-mono text-[9.5px] text-[var(--color-ink-5)]">
              {dataset.latestDay.date}
            </span>
          </div>
          <StackedBarChart day={dataset.latestDay} />
        </div>
      )}

      {/* Fuel mix breakdown */}
      <div className="mb-3">
        <div className="mb-1.5 font-mono text-[9.5px] uppercase tracking-[0.18em] text-[var(--color-ink-5)]">
          Fuel Mix
        </div>
        <div className="flex flex-col gap-0.5">
          {dataset.fuelSummaries.map((f) => (
            <FuelRow
              key={f.type}
              type={f.type}
              label={f.label}
              color={f.color}
              currentMW={currentHour?.fuels[f.type] ?? 0}
              share={f.share}
            />
          ))}
        </div>
      </div>

      {/* Summary stats */}
      <div className="h-px bg-[var(--color-ink-2)] mb-2.5" />
      <SummaryRow
        totalMWh={dataset.totalGenerationMWh}
        peakMW={dataset.peakTotalMW}
        avgMW={dataset.avgTotalMW}
      />
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Current hour block
// ---------------------------------------------------------------------------

function CurrentHourBlock({
  hour,
  totalMW,
}: {
  hour: { hour: number; fuels: Record<IesoFuelType, number> };
  totalMW: number;
}) {
  // Build stacked bar segments
  const segments = useMemo(() => {
    const sorted = (Object.entries(hour.fuels) as [IesoFuelType, number][])
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1]);
    return sorted;
  }, [hour]);

  return (
    <div className="mb-3 rounded-lg border border-[var(--color-ink-3)]/60 bg-[var(--color-ink-2)]/30 px-3 py-2.5">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="font-mono text-[9.5px] uppercase tracking-[0.15em] text-[var(--color-ink-5)]">
          Hour {String(hour.hour).padStart(2, "0")}:00
        </span>
        <span className="font-mono text-[14px] font-semibold tabular-nums text-[var(--color-ink-8)]">
          {formatMW(totalMW)}
        </span>
      </div>
      {/* Stacked bar */}
      <div className="flex h-2 w-full overflow-hidden rounded-full">
        {segments.map(([fuel, mw]) => (
          <span
            key={fuel}
            className="block h-full transition-all duration-300"
            style={{
              width: `${(mw / totalMW) * 100}%`,
              backgroundColor: FUEL_COLOR[fuel],
            }}
            title={`${FUEL_LABEL[fuel]}: ${formatMW(mw)}`}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 24-hour stacked bar chart (SVG)
// ---------------------------------------------------------------------------

function StackedBarChart({
  day,
}: {
  day: { date: string; hours: { hour: number; fuels: Record<IesoFuelType, number> }[] };
}) {
  const chartW = 268;
  const chartH = 100;
  const padBottom = 14;
  const innerH = chartH - padBottom;
  const barGap = 2;
  const fuelOrder: IesoFuelType[] = ["NUCLEAR", "GAS", "HYDRO", "WIND", "SOLAR", "BIOFUEL", "OTHER"];

  // Compute max hourly total for scaling
  const maxTotal = useMemo(() => {
    let max = 0;
    for (const h of day.hours) {
      const total = Object.values(h.fuels).reduce((a, b) => a + b, 0);
      if (total > max) max = total;
    }
    return max || 1;
  }, [day]);

  // Current hour index for the "now" marker
  const currentHourIdx = useMemo(() => {
    const now = new Date();
    const h = now.getHours() + 1; // IESO 1-indexed
    return day.hours.findIndex((d) => d.hour === h);
  }, [day]);

  const barW = (chartW - barGap * (day.hours.length - 1)) / day.hours.length;
  const hourLabels = [
    { hour: 1, label: "0" },
    { hour: 7, label: "6" },
    { hour: 13, label: "12" },
    { hour: 19, label: "18" },
    { hour: 24, label: "24" },
  ];

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${chartW} ${chartH}`}
      className="overflow-visible"
      style={{ height: chartH }}
    >
      {day.hours.map((h, i) => {
        const x = i * (barW + barGap);
        const total = Object.values(h.fuels).reduce((a, b) => a + b, 0);
        const barHeight = (total / maxTotal) * innerH;
        const isNow = i === currentHourIdx;
        let y = innerH - barHeight;

        return (
          <g key={h.hour} className="group/bar">
            {/* Hover highlight */}
            <rect
              x={x - 1}
              y={0}
              width={barW + 2}
              height={innerH}
              fill="transparent"
              className="transition-opacity group-hover/bar:opacity-100"
            />
            {fuelOrder.map((fuel) => {
              const val = h.fuels[fuel] ?? 0;
              if (val <= 0) return null;
              const segH = (val / maxTotal) * innerH;
              const segY = y;
              y += segH;
              return (
                <rect
                  key={fuel}
                  x={x}
                  y={segY}
                  width={barW}
                  height={Math.max(0.5, segH)}
                  fill={FUEL_COLOR[fuel]}
                  opacity={isNow ? 1 : 0.75}
                  rx={i === 0 || i === day.hours.length - 1 ? 1 : 0}
                  className="transition-opacity group-hover/bar:opacity-100"
                />
              );
            })}
            {/* "Now" marker line */}
            {isNow && (
              <line
                x1={x + barW / 2}
                y1={0}
                x2={x + barW / 2}
                y2={innerH}
                stroke="var(--color-accent)"
                strokeWidth={1}
                strokeOpacity={0.5}
                strokeDasharray="2 2"
              />
            )}
          </g>
        );
      })}
      {/* Hour labels */}
      {hourLabels.map(({ hour, label }) => {
        const idx = day.hours.findIndex((h) => h.hour === hour);
        if (idx < 0) return null;
        const x = idx * (barW + barGap) + barW / 2;
        return (
          <text
            key={hour}
            x={x}
            y={chartH - 2}
            textAnchor="middle"
            className="fill-[var(--color-ink-5)]"
            style={{ fontSize: 8, fontFamily: "var(--font-mono)" }}
          >
            {label}
          </text>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Fuel mix row
// ---------------------------------------------------------------------------

function FuelRow({
  label,
  color,
  currentMW,
  share,
}: {
  type: IesoFuelType;
  label: string;
  color: string;
  currentMW: number;
  share: number;
}) {
  return (
    <div
      className="group flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-[var(--color-ink-2)]/50"
    >
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span className="min-w-0 flex-1 truncate text-[11.5px] text-[var(--color-ink-7)]">
        {label}
      </span>
      <span className="font-mono text-[10.5px] tabular-nums text-[var(--color-ink-6)]">
        {formatMW(currentMW)}
      </span>
      <div className="flex items-center gap-1.5">
        <div className="h-1 w-10 overflow-hidden rounded-full bg-[var(--color-ink-2)]">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${Math.min(100, share * 100)}%`,
              backgroundColor: color,
              opacity: 0.8,
            }}
          />
        </div>
        <span className="w-8 text-right font-mono text-[9.5px] tabular-nums text-[var(--color-ink-5)]">
          {(share * 100).toFixed(1)}%
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary row
// ---------------------------------------------------------------------------

function SummaryRow({
  totalMWh,
  peakMW,
  avgMW,
}: {
  totalMWh: number;
  peakMW: number;
  avgMW: number;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <SummaryCell label="Total" value={formatMWh(totalMWh)} />
      <SummaryCell label="Peak" value={formatMW(peakMW)} />
      <SummaryCell label="Average" value={formatMW(avgMW)} />
    </div>
  );
}

function SummaryCell({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[8.5px] uppercase tracking-[0.14em] text-[var(--color-ink-5)]">
        {label}
      </span>
      <span className="font-mono text-[11px] font-semibold tabular-nums text-[var(--color-ink-8)]">
        {value}
      </span>
    </div>
  );
}
