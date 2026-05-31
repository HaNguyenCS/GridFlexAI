// EnergyDetailCard — building-level energy consumption detail.
//
// Appears when the user hovers a building that has energy data from the
// geocoded dataset. Shows address, operation type, electricity/gas split,
// intensity, and coordinates from the energy-geocode pipeline.
//
// Position: top-right, below the HeaderBar and CommandCenter trigger.
// Slides in with a subtle animation; fades out when hover ends.

import {
  MapPin,
  Lightning,
  Flame,
  Ruler,
  Crosshair,
  BuildingOffice,
  TrendUp,
} from "@phosphor-icons/react";
import type { EnergyGeoFeature, BuildingEnergy } from "../lib/energy";
import { formatKWh } from "../lib/energy";

interface Props {
  /** Real geocoded energy feature, if the building was matched. */
  geoFeature: EnergyGeoFeature | null;
  /** Model-derived energy estimate, always present when energy mode is on. */
  estimate: BuildingEnergy | null;
  /** Building label from the footprints dataset. */
  buildingLabel: string | null;
  /** Building height in metres. */
  buildingHeight: number | null;
}

export function EnergyDetailCard({
  geoFeature,
  estimate,
  buildingLabel,
  buildingHeight,
}: Props) {
  // Prefer real geocoded data over model estimates.
  const isReal = !!geoFeature;
  const source = isReal ? "Metered" : "Estimated";

  if (!geoFeature && !estimate) return null;

  return (
    <div className="energy-detail-card pointer-events-none absolute right-6 top-[80px] z-10 w-[280px] rounded-[14px] border border-[var(--color-ink-3)] bg-[color-mix(in_oklch,var(--color-ink-1)_92%,transparent)] p-4 backdrop-blur-xl">
      {/* Header */}
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <BuildingOffice size={12} weight="bold" className="text-[var(--color-accent)]" />
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-ink-6)]">
              Energy Detail
            </span>
          </div>
          <h3 className="mt-1 truncate text-[14px] font-medium text-[var(--color-ink-8)]">
            {geoFeature?.name || buildingLabel || "Building"}
          </h3>
        </div>
        <SourceBadge source={source} isReal={isReal} />
      </div>

      {/* Address + coordinates (geocoded data only) */}
      {geoFeature && (
        <div className="mb-3 flex flex-col gap-1 rounded-lg border border-[var(--color-ink-2)] bg-[var(--color-ink-1)] px-3 py-2">
          <div className="flex items-start gap-1.5">
            <MapPin size={11} weight="bold" className="mt-0.5 shrink-0 text-[var(--color-ink-5)]" />
            <span className="text-[11.5px] leading-snug text-[var(--color-ink-7)]">
              {geoFeature.address}
              {geoFeature.city && (
                <span className="text-[var(--color-ink-5)]">, {geoFeature.city}</span>
              )}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Crosshair size={10} weight="bold" className="text-[var(--color-ink-4)]" />
            <span className="font-mono text-[10px] tabular-nums text-[var(--color-ink-5)]">
              {geoFeature.coordinates[1].toFixed(4)}°N, {Math.abs(geoFeature.coordinates[0]).toFixed(4)}°W
            </span>
          </div>
          {geoFeature.operationType && (
            <div className="mt-0.5 flex items-center gap-1.5">
              <BuildingOffice size={10} weight="bold" className="text-[var(--color-ink-4)]" />
              <span className="text-[10.5px] capitalize text-[var(--color-ink-6)]">
                {geoFeature.operationType}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Consumption breakdown */}
      <div className="flex flex-col gap-2">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-[var(--color-ink-6)]">
          Consumption
        </span>

        {geoFeature ? (
          <>
            <MetricRow
              icon={Lightning}
              label="Electricity"
              value={formatKWh(geoFeature.electricityKWh)}
              color="var(--color-accent)"
            />
            <MetricRow
              icon={Flame}
              label="Natural gas"
              value={`${geoFeature.naturalGasM3.toLocaleString()} m³ · ${formatKWh(geoFeature.naturalGasKWhEq)}`}
              color="var(--color-warn)"
            />
            <div className="my-1 h-px bg-[var(--color-ink-2)]" />
            <MetricRow
              icon={TrendUp}
              label="Total"
              value={formatKWh(geoFeature.totalEnergyKWh)}
              color="var(--color-ink-8)"
              bold
            />
          </>
        ) : estimate ? (
          <MetricRow
            icon={TrendUp}
            label="Estimated"
            value={formatKWh(estimate.kWh)}
            color="var(--color-ink-7)"
          />
        ) : null}
      </div>

      {/* Intensity + area */}
      <div className="mt-3 flex flex-col gap-1.5 border-t border-[var(--color-ink-2)] pt-3">
        {geoFeature && (
          <>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-[var(--color-ink-6)]">Intensity</span>
              <span className="font-mono text-[11px] tabular-nums text-[var(--color-ink-8)]">
                {geoFeature.intensityKWhPerSqM.toFixed(0)} kWh/m²
              </span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                <Ruler size={10} weight="bold" className="text-[var(--color-ink-4)]" />
                <span className="text-[11px] text-[var(--color-ink-6)]">Floor area</span>
              </div>
              <span className="font-mono text-[11px] tabular-nums text-[var(--color-ink-7)]">
                {geoFeature.floorAreaSqM.toLocaleString()} m²
              </span>
            </div>
          </>
        )}
        {buildingHeight != null && (
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-[var(--color-ink-6)]">Height</span>
            <span className="font-mono text-[11px] tabular-nums text-[var(--color-ink-7)]">
              {Math.round(buildingHeight)} m
            </span>
          </div>
        )}
      </div>

      {/* Year badge */}
      {geoFeature && (
        <div className="mt-2 flex items-center justify-end">
          <span className="rounded-sm bg-[var(--color-ink-2)] px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--color-ink-5)]">
            {geoFeature.year}
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SourceBadge({ source, isReal }: { source: string; isReal: boolean }) {
  return (
    <span
      className={
        isReal
          ? "rounded-sm border border-[color-mix(in_oklch,var(--color-ok)_40%,transparent)] bg-[color-mix(in_oklch,var(--color-ok)_12%,var(--color-ink-2))] px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--color-ok)]"
          : "rounded-sm bg-[var(--color-ink-2)] px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--color-ink-5)]"
      }
    >
      {source}
    </span>
  );
}

function MetricRow({
  icon: Icon,
  label,
  value,
  color,
  bold,
}: {
  icon: typeof Lightning;
  label: string;
  value: string;
  color: string;
  bold?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon size={12} weight="bold" style={{ color }} />
      <span className="flex-1 text-[12px] text-[var(--color-ink-7)]">{label}</span>
      <span
        className={
          bold
            ? "font-mono text-[12px] font-semibold tabular-nums text-[var(--color-ink-8)]"
            : "font-mono text-[11px] tabular-nums text-[var(--color-ink-8)]"
        }
      >
        {value}
      </span>
    </div>
  );
}
