// EnergyInfoPanel — floating info card for buildings with metered energy data.
//
// When a user clicks a building that has a matched EnergyGeoFeature (from
// the energy-geocode pipeline), this panel slides in near the building's
// screen-space position and shows the real consumption figures:
//   - Facility name + address
//   - Operation type
//   - Electricity / natural gas / combined totals
//   - Energy intensity (kWh/m²) and floor area
//
// The panel is projected from the building centroid using the same
// WebMercatorViewport as AnnotationOverlays so it tracks the camera.

import { useEffect, useMemo, useRef, useState } from "react";
import { WebMercatorViewport, type MapViewState } from "@deck.gl/core";

import type { Building } from "../lib/types";
import { type EnergyGeoFeature, formatKWh, energyToCss } from "../lib/energy";

interface Props {
  width: number;
  height: number;
  viewState: MapViewState;
  building: Building;
  energy: EnergyGeoFeature;
  onClose: () => void;
}

const PANEL_W = 264;
const PANEL_H = 220;

export function EnergyInfoPanel({
  width,
  height,
  viewState,
  building,
  energy,
  onClose,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const r = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(r);
  }, []);

  const viewport = useMemo(() => {
    if (width <= 0 || height <= 0) return null;
    try {
      return new WebMercatorViewport({
        width,
        height,
        longitude: viewState.longitude,
        latitude: viewState.latitude,
        zoom: viewState.zoom,
        pitch: viewState.pitch,
        bearing: viewState.bearing,
      });
    } catch {
      return null;
    }
  }, [width, height, viewState]);

  const position = useMemo(() => {
    if (!viewport) return null;
    const [clng, clat] = ringCentroid(building.contour);
    try {
      const [ax, ay] = viewport.project([clng, clat, building.height]);
      if (!Number.isFinite(ax) || !Number.isFinite(ay)) return null;
      // Offset panel to upper-right of anchor, clamped to viewport.
      const gutter = 16;
      let px = ax + 18;
      let py = ay - PANEL_H / 2;
      px = Math.max(gutter, Math.min(width - PANEL_W - gutter, px));
      py = Math.max(gutter, Math.min(height - PANEL_H - gutter, py));
      return { ax, ay, px, py };
    } catch {
      return null;
    }
  }, [viewport, building, width, height]);

  if (!position) return null;

  const { ax, ay, px, py } = position;
  const accentColor = energyToCss(energy.normalised);
  const intensity = energy.intensityKWhPerSqM;
  const totalKWh = energy.totalEnergyKWh;

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{ zIndex: 50 }}
    >
      {/* Connector line from anchor to panel */}
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        width={width}
        height={height}
      >
        <defs>
          <filter id="energy-panel-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="2" />
          </filter>
        </defs>
        <line
          x1={ax} y1={ay}
          x2={px} y2={py + PANEL_H / 2}
          stroke={accentColor}
          strokeOpacity="0.3"
          strokeWidth="1.5"
          strokeDasharray="4 3"
        />
        <circle cx={ax} cy={ay} r={5} fill={accentColor} fillOpacity="0.7" />
        <circle cx={ax} cy={ay} r={8} fill="none" stroke={accentColor} strokeOpacity="0.4" strokeWidth="1" />
      </svg>

      {/* Panel card */}
      <div
        ref={panelRef}
        data-mounted={mounted ? "true" : "false"}
        className="energy-info-panel pointer-events-auto absolute"
        style={{
          transform: `translate3d(${px}px, ${py}px, 0)`,
          width: PANEL_W,
        }}
      >
        <div
          className="relative overflow-hidden rounded-2xl border bg-[rgba(8,12,22,0.88)] backdrop-blur-xl"
          style={{
            borderColor: `color-mix(in oklch, ${accentColor} 45%, var(--color-ink-3))`,
            boxShadow: `0 12px 40px -8px rgba(0,0,0,0.7), 0 0 0 1px color-mix(in oklch, ${accentColor} 18%, transparent)`,
          }}
        >
          {/* Accent strip */}
          <div
            className="h-1 w-full"
            style={{ background: `linear-gradient(90deg, ${accentColor}, transparent)` }}
          />

          {/* Header */}
          <div className="flex items-start justify-between gap-2 px-3.5 pt-3 pb-1">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-semibold leading-tight text-[var(--color-ink-8)]">
                {energy.name || building.label || "City Facility"}
              </p>
              {energy.address && (
                <p className="mt-0.5 truncate text-[10.5px] leading-snug text-[var(--color-ink-5)]">
                  {energy.address}{energy.city ? `, ${energy.city}` : ""}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-white/10 text-[var(--color-ink-5)] transition-colors hover:border-white/25 hover:text-[var(--color-ink-8)]"
              aria-label="Close"
            >
              <svg viewBox="0 0 10 10" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M1 1 L9 9 M9 1 L1 9" />
              </svg>
            </button>
          </div>

          {/* Operation type badge */}
          {energy.operationType && (
            <div className="px-3.5 pb-2">
              <span
                className="inline-block rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.15em]"
                style={{
                  backgroundColor: `color-mix(in oklch, ${accentColor} 15%, var(--color-ink-1))`,
                  color: accentColor,
                  border: `1px solid color-mix(in oklch, ${accentColor} 30%, transparent)`,
                }}
              >
                {energy.operationType}
              </span>
            </div>
          )}

          {/* Metrics grid */}
          <div className="grid grid-cols-2 gap-x-3 gap-y-2 px-3.5 pb-3">
            <MetricCell
              label="Total Energy"
              value={formatKWh(totalKWh)}
              accent={accentColor}
            />
            <MetricCell
              label="Intensity"
              value={intensity > 0 ? `${Math.round(intensity)} kWh/m²` : "—"}
              accent={accentColor}
            />
            <MetricCell
              label="Electricity"
              value={formatKWh(energy.electricityKWh)}
              accent={accentColor}
              sublabel="kWh"
            />
            <MetricCell
              label="Natural Gas"
              value={formatKWh(energy.naturalGasKWhEq)}
              accent={accentColor}
              sublabel="kWh eq"
            />
            <MetricCell
              label="Floor Area"
              value={energy.floorAreaSqM > 0 ? `${Math.round(energy.floorAreaSqM).toLocaleString()} m²` : "—"}
              accent={accentColor}
            />
            <MetricCell
              label="Reporting Year"
              value={energy.year ? String(energy.year) : "—"}
              accent={accentColor}
            />
          </div>
        </div>
      </div>

      <style>{`
        .energy-info-panel {
          opacity: 0;
          transform-origin: top left;
          transition: opacity 0.22s ease-out, transform 0.22s ease-out;
        }
        .energy-info-panel[data-mounted="true"] {
          opacity: 1;
        }
      `}</style>
    </div>
  );
}

function MetricCell({
  label,
  value,
  accent,
  sublabel,
}: {
  label: string;
  value: string;
  accent: string;
  sublabel?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[8.5px] uppercase tracking-[0.14em] text-[var(--color-ink-5)]">
        {label}
      </span>
      <span
        className="text-[12px] font-semibold tabular-nums leading-tight"
        style={{ color: accent }}
      >
        {value}
      </span>
      {sublabel && (
        <span className="text-[8.5px] text-[var(--color-ink-4)]">{sublabel}</span>
      )}
    </div>
  );
}

function ringCentroid(ring: [number, number][]): [number, number] {
  let x = 0;
  let y = 0;
  const n = Math.max(1, ring.length - 1);
  for (let i = 0; i < n; i++) {
    x += ring[i][0];
    y += ring[i][1];
  }
  return [x / n, y / n];
}
