// EnergyGeocodePanel — geocoding pipeline status and energy dataset coverage.
//
// Surfaces the data lineage from the energy-geocode module: how many
// building records were parsed from the XLSX, how many were resolved
// to geographic coordinates, and the per-category breakdown.
//
// Position: left column, above the LegendPanel. Collapsible like its
// siblings; collapse state persisted in localStorage.

import { useMemo } from "react";
import {
  MapPinArea,
  Database,
  CheckCircle,
  WarningDiamond,
  Lightning,
  Flame,
  Buildings,
  GlobeHemisphereWest,
} from "@phosphor-icons/react";
import clsx from "clsx";
import type { EnergyDataset, EnergyGeoDataset } from "../lib/energy";
import { formatKWh } from "../lib/energy";

interface Props {
  dataset: EnergyDataset | null;
  geo: EnergyGeoDataset | null;
  loading: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function EnergyGeocodePanel({
  dataset,
  geo,
  loading,
  collapsed,
  onToggleCollapse,
}: Props) {
  // Derive coverage stats from the dataset + geo feature counts.
  const stats = useMemo(() => {
    const totalRecords = dataset?.recordCount ?? 0;
    const geoResolved = geo?.featureCount ?? 0;
    const coveragePct =
      totalRecords > 0 ? (geoResolved / totalRecords) * 100 : 0;
    const categories = dataset
      ? Object.keys(dataset.intensityByCategory).length
      : 0;

    return { totalRecords, geoResolved, coveragePct, categories };
  }, [dataset, geo]);

  const categoryBreakdown = useMemo(() => {
    if (!dataset) return [];
    return Object.entries(dataset.intensityByCategory)
      .sort((a, b) => b[1] - a[1])
      .map(([name, intensity]) => ({ name, intensity }));
  }, [dataset]);

  return (
    <aside className="pointer-events-auto absolute bottom-[calc(100%-24px)] left-6 z-10 w-[300px] rounded-[14px] border border-[var(--color-ink-3)] bg-[color-mix(in_oklch,var(--color-ink-1)_88%,transparent)] backdrop-blur-xl transition-all duration-300 ease-in-out"
      style={{ bottom: "auto", top: "80px" }}
    >
      {collapsed ? (
        <button
          type="button"
          onClick={onToggleCollapse}
          className="grid h-8 w-8 place-items-center rounded-md text-[var(--color-ink-6)] transition-colors hover:bg-[var(--color-ink-2)] hover:text-[var(--color-ink-8)] active:translate-y-px"
          title="Expand energy geocode"
        >
          <MapPinArea size={18} weight="bold" />
        </button>
      ) : (
        <div className="flex flex-col gap-4 p-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="grid h-6 w-6 place-items-center rounded-md bg-[color-mix(in_oklch,var(--color-accent)_18%,var(--color-ink-2))]">
                <MapPinArea size={13} weight="bold" className="text-[var(--color-accent)]" />
              </span>
              <span className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-[var(--color-ink-6)]">
                Energy Geocode
              </span>
            </div>
            <button
              type="button"
              onClick={onToggleCollapse}
              className="grid h-6 w-6 place-items-center rounded-md text-[var(--color-ink-6)] transition-colors hover:bg-[var(--color-ink-2)] hover:text-[var(--color-ink-8)] active:translate-y-px"
              title="Collapse panel"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15" /></svg>
            </button>
          </div>

          {loading ? (
            <LoadingState />
          ) : !dataset ? (
            <EmptyState />
          ) : (
            <>
              {/* Pipeline stats */}
              <div className="grid grid-cols-3 gap-2">
                <StatCell
                  icon={Database}
                  label="Records"
                  value={stats.totalRecords.toLocaleString()}
                  tone="default"
                />
                <StatCell
                  icon={GlobeHemisphereWest}
                  label="Geocoded"
                  value={stats.geoResolved.toLocaleString()}
                  tone={stats.geoResolved > 0 ? "accent" : "default"}
                />
                <StatCell
                  icon={stats.coveragePct >= 50 ? CheckCircle : WarningDiamond}
                  label="Coverage"
                  value={`${stats.coveragePct.toFixed(0)}%`}
                  tone={
                    stats.coveragePct >= 70
                      ? "ok"
                      : stats.coveragePct >= 40
                      ? "warn"
                      : "alert"
                  }
                />
              </div>

              <div className="h-px bg-[var(--color-ink-2)]" />

              {/* Energy totals */}
              <div className="flex flex-col gap-2.5">
                <span className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-[var(--color-ink-6)]">
                  Consumption · {dataset.year}
                </span>
                <div className="flex flex-col gap-1.5">
                  <EnergyRow
                    icon={Lightning}
                    label="Electricity"
                    value={formatKWh(dataset.totalElectricityKWh)}
                    color="var(--color-accent)"
                  />
                  <EnergyRow
                    icon={Flame}
                    label="Natural gas"
                    value={formatKWh(dataset.totalGasKWhEq)}
                    color="var(--color-warn)"
                  />
                  <EnergyRow
                    icon={Buildings}
                    label="Floor area"
                    value={`${(dataset.totalFloorAreaSqM / 1_000_000).toFixed(1)}M m²`}
                    color="var(--color-ink-6)"
                  />
                </div>
              </div>

              {/* Intensity */}
              <div className="h-px bg-[var(--color-ink-2)]" />
              <div className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between">
                  <span className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-[var(--color-ink-6)]">
                    Intensity
                  </span>
                  <span className="font-mono text-[11px] tabular-nums text-[var(--color-ink-8)]">
                    {dataset.intensityKWhPerSqM.toFixed(0)} kWh/m²
                  </span>
                </div>
                <IntensityBar p5={dataset.intensityP5} p95={dataset.intensityP95} />
              </div>

              {/* Category breakdown */}
              {categoryBreakdown.length > 0 && (
                <>
                  <div className="h-px bg-[var(--color-ink-2)]" />
                  <div className="flex flex-col gap-1.5">
                    <span className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-[var(--color-ink-6)]">
                      By category
                    </span>
                    {categoryBreakdown.map((cat) => (
                      <CategoryRow
                        key={cat.name}
                        name={cat.name}
                        intensity={cat.intensity}
                        maxIntensity={categoryBreakdown[0].intensity}
                      />
                    ))}
                  </div>
                </>
              )}

              {/* Data source */}
              <div className="flex items-center gap-1.5 pt-1">
                <Database size={10} weight="bold" className="text-[var(--color-ink-4)]" />
                <span className="truncate font-mono text-[9.5px] text-[var(--color-ink-4)]">
                  {dataset.resourceName}
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCell({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Database;
  label: string;
  value: string;
  tone: "default" | "accent" | "ok" | "warn" | "alert";
}) {
  const toneClass =
    tone === "accent"
      ? "text-[var(--color-accent)]"
      : tone === "ok"
      ? "text-[var(--color-ok)]"
      : tone === "warn"
      ? "text-[var(--color-warn)]"
      : tone === "alert"
      ? "text-[var(--color-alert)]"
      : "text-[var(--color-ink-7)]";

  return (
    <div className="flex flex-col items-center gap-1 rounded-lg border border-[var(--color-ink-2)] bg-[var(--color-ink-1)] px-2 py-2.5">
      <Icon size={14} weight="bold" className={toneClass} />
      <span className={clsx("text-[15px] font-semibold tabular-nums leading-none", toneClass)}>
        {value}
      </span>
      <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--color-ink-5)]">
        {label}
      </span>
    </div>
  );
}

function EnergyRow({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: typeof Lightning;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon size={12} weight="bold" style={{ color }} />
      <span className="flex-1 text-[12px] text-[var(--color-ink-7)]">
        {label}
      </span>
      <span className="font-mono text-[11px] tabular-nums text-[var(--color-ink-8)]">
        {value}
      </span>
    </div>
  );
}

function IntensityBar({ p5, p95 }: { p5: number; p95: number }) {
  const stops = useMemo(() => {
    return Array.from({ length: 24 }, (_, i) => {
      const t = i / 23;
      const r = Math.round(22 + (248 - 22) * t);
      const g = Math.round(14 + (220 - 14) * t);
      const b = Math.round(56 + (110 - 56) * t);
      return `rgb(${r},${g},${b})`;
    });
  }, []);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex h-2 w-full overflow-hidden rounded-full">
        {stops.map((c, i) => (
          <span
            key={i}
            className="block h-full flex-1"
            style={{ background: c }}
          />
        ))}
      </div>
      <div className="flex items-center justify-between font-mono text-[9.5px] tabular-nums text-[var(--color-ink-5)]">
        <span>{Math.round(p5)}</span>
        <span className="text-[var(--color-ink-4)]">kWh/m²</span>
        <span>{Math.round(p95)}</span>
      </div>
    </div>
  );
}

function CategoryRow({
  name,
  intensity,
  maxIntensity,
}: {
  name: string;
  intensity: number;
  maxIntensity: number;
}) {
  const pct = maxIntensity > 0 ? (intensity / maxIntensity) * 100 : 0;

  return (
    <div className="flex items-center gap-2">
      <span className="w-20 truncate text-[11.5px] capitalize text-[var(--color-ink-7)]">
        {name}
      </span>
      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--color-ink-2)]">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-[var(--color-accent)]"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-12 text-right font-mono text-[10px] tabular-nums text-[var(--color-ink-5)]">
        {Math.round(intensity)}
      </span>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col items-center gap-2 py-6">
      <div className="relative h-7 w-7">
        <div className="absolute inset-0 rounded-full border border-[var(--color-ink-3)]" />
        <div
          className="absolute inset-0 rounded-full border-2 border-transparent"
          style={{
            borderTopColor: "var(--color-accent)",
            animation: "geocode-spin 0.9s linear infinite",
          }}
        />
      </div>
      <span className="text-[12px] text-[var(--color-ink-5)]">
        Loading energy data…
      </span>
      <style>{`@keyframes geocode-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-2 py-6 text-center">
      <MapPinArea size={24} weight="bold" className="text-[var(--color-ink-4)]" />
      <span className="text-[12px] text-[var(--color-ink-5)]">
        Switch to "Energy use" mode to load the geocoded dataset.
      </span>
    </div>
  );
}
