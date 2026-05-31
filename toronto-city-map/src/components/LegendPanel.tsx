// LegendPanel — bottom-left control surface.
//
// Two responsibilities:
//   1. Show the height-encoded colour ramp (passive reference).
//   2. Render dynamic layer toggles for every annotation kind currently
//      seen on the wire, plus per-source rows. Toggling a row hides the
//      corresponding overlays both on the map and as floating callouts.
//
// Rows render by introspection: kinds and sources only appear once the
// system has actually observed them, so the legend grows organically
// while the stream runs. Disabling a layer fades the row in place
// rather than collapsing the panel — preserves spatial memory.

import { useMemo } from "react";
import { Eye, EyeSlash } from "@phosphor-icons/react";
import clsx from "clsx";
import type { StreamEventKind, StreamSource } from "../lib/types";
import { KIND_COLOR, KIND_LABEL } from "../lib/sources";
import type { ColorMode } from "./MapView";
import {
  sampleEnergyRamp,
  formatKWh,
  type EnergyDataset,
} from "../lib/energy";

interface Props {
  kindCounts: Record<string, number>;
  sourceCounts: Record<string, number>;
  enabledKinds: Set<StreamEventKind>;
  enabledSources: Set<string>;
  onToggleKind: (kind: StreamEventKind) => void;
  onToggleSource: (sourceId: string) => void;
  /** All sources currently configured — drives the source rows. */
  sources: StreamSource[];
  /** Kinds that the system has ever observed, used to enumerate rows. */
  seenKinds: Set<StreamEventKind>;
  hoveredLabel: string | null;
  hoveredHeight: number | null;
  hoveredCategory: string | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
  /** Active fill colour mode — height (default) or energy. */
  colorMode: ColorMode;
  onColorModeChange: (mode: ColorMode) => void;
  /** Aggregate dataset, present once the energy fetch resolves. */
  energyDataset: EnergyDataset | null;
  /** True while the energy data is in flight. */
  energyLoading: boolean;
  /** Whether ward boundaries are visible on the map. */
  showWards: boolean;
  /** Callback to toggle ward visibility. */
  onToggleWards: () => void;
  /** Number of wards currently loaded. */
  wardCount: number;
  /** Building opacity multiplier 0–1. */
  buildingOpacity: number;
  /** Callback to change building opacity. */
  onBuildingOpacityChange: (v: number) => void;
}

const KIND_ORDER: StreamEventKind[] = ["highlight", "annotate", "alert"];

export function LegendPanel({
  kindCounts,
  sourceCounts,
  enabledKinds,
  enabledSources,
  onToggleKind,
  onToggleSource,
  sources,
  seenKinds,
  hoveredLabel,
  hoveredHeight,
  hoveredCategory,
  collapsed,
  onToggleCollapse,
  colorMode,
  onColorModeChange,
  energyDataset,
  energyLoading,
  showWards,
  onToggleWards,
  wardCount,
  buildingOpacity,
  onBuildingOpacityChange,
}: Props) {
  const heightRamp = useMemo(
    () =>
      Array.from({ length: 24 }, (_, i) => {
        const t = i / 23;
        return colorAt(t);
      }),
    []
  );
  const energyRamp = useMemo(() => sampleEnergyRamp(24), []);

  // Render kinds in canonical order, but only those we've actually seen.
  const kindRows = useMemo(
    () => KIND_ORDER.filter((k) => seenKinds.has(k)),
    [seenKinds]
  );

  return (
    <aside className="pointer-events-auto absolute bottom-6 left-6 z-10 flex w-[300px] flex-col gap-4 rounded-[14px] border border-[var(--color-ink-3)] bg-[color-mix(in_oklch,var(--color-ink-1)_88%,transparent)] p-4 backdrop-blur-xl transition-all duration-300 ease-in-out">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-[var(--color-ink-6)]">
          Legend
        </span>
        <button
          type="button"
          onClick={onToggleCollapse}
          className="grid h-6 w-6 place-items-center rounded-md text-[var(--color-ink-6)] transition-colors hover:bg-[var(--color-ink-2)] hover:text-[var(--color-ink-8)] active:translate-y-px"
          title={collapsed ? "Expand legend" : "Collapse legend"}
        >
          {collapsed ? (
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>
          )}
        </button>
      </div>
      
      {!collapsed && (
        <>
          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-[var(--color-ink-6)]">
                Color by
              </span>
              <span className="font-mono text-[10.5px] tabular-nums text-[var(--color-ink-5)]">
                {colorMode === "energy" ? "kWh / m²" : "metres"}
              </span>
            </div>
            <div
              role="tablist"
              aria-label="Building colour mode"
              className="flex h-7 items-center rounded-full border border-[var(--color-ink-3)] bg-[var(--color-ink-2)]/60 p-0.5"
            >
              <ColorModeTab
                active={colorMode === "height"}
                onClick={() => onColorModeChange("height")}
                label="Height"
              />
              <ColorModeTab
                active={colorMode === "energy"}
                onClick={() => onColorModeChange("energy")}
                label="Energy use"
                loading={energyLoading}
              />
            </div>
            <div className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full">
              {(colorMode === "energy" ? energyRamp : heightRamp).map((c, i) => (
                <span
                  key={i}
                  className="block h-full flex-1"
                  style={{ background: c }}
                />
              ))}
            </div>
            {colorMode === "energy" ? (
              <EnergyScale dataset={energyDataset} loading={energyLoading} />
            ) : (
              <div className="mt-1.5 flex items-center justify-between font-mono text-[10.5px] tabular-nums text-[var(--color-ink-5)]">
                <span>10</span>
                <span>120</span>
                <span>320+</span>
              </div>
            )}
          </div>

          <div className="h-px bg-[var(--color-ink-2)]" />

          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-[var(--color-ink-6)]">
                Annotation layers
              </span>
              <span className="font-mono text-[10.5px] tabular-nums text-[var(--color-ink-5)]">
                {enabledKinds.size}/{kindRows.length || "—"} on
              </span>
            </div>
            {kindRows.length === 0 ? (
              <p className="text-[12px] text-[var(--color-ink-5)]">
                Waiting for the first event<span className="ml-1">…</span>
              </p>
            ) : (
              <ul className="grid grid-cols-1 gap-1">
                {kindRows.map((k) => (
                  <LayerRow
                    key={k}
                    color={KIND_COLOR[k]}
                    label={KIND_LABEL[k]}
                    count={kindCounts[k] ?? 0}
                    enabled={enabledKinds.has(k)}
                    onToggle={() => onToggleKind(k)}
                  />
                ))}
              </ul>
            )}
          </div>

          {sources.length > 0 ? (
            <>
              <div className="h-px bg-[var(--color-ink-2)]" />
              <div>
                <div className="mb-2 flex items-baseline justify-between">
                  <span className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-[var(--color-ink-6)]">
                    Source channels
                  </span>
                  <span className="font-mono text-[10.5px] tabular-nums text-[var(--color-ink-5)]">
                    {enabledSources.size}/{sources.length} on
                  </span>
                </div>
                <ul className="grid grid-cols-1 gap-1">
                  {sources.map((s) => (
                    <LayerRow
                      key={s.id}
                      color={s.color}
                      label={s.name}
                      count={sourceCounts[s.id] ?? 0}
                      enabled={enabledSources.has(s.id)}
                      onToggle={() => onToggleSource(s.id)}
                    />
                  ))}
                </ul>
              </div>
            </>
          ) : null}

          <div className="h-px bg-[var(--color-ink-2)]" />

          <div>
            <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.22em] text-[var(--color-ink-6)]">
              City boundaries
            </div>
            <WardToggleRow
              enabled={showWards}
              onToggle={onToggleWards}
              wardCount={wardCount}
            />
          </div>

          <div className="h-px bg-[var(--color-ink-2)]" />

          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-[var(--color-ink-6)]">
                Building opacity
              </span>
              <span className="font-mono text-[10.5px] tabular-nums text-[var(--color-ink-5)]">
                {Math.round(buildingOpacity * 100)}%
              </span>
            </div>
            <OpacitySlider
              value={buildingOpacity}
              onChange={onBuildingOpacityChange}
            />
          </div>

          <div className="min-h-[48px]">
            <div className="mb-1 font-mono text-[10.5px] uppercase tracking-[0.22em] text-[var(--color-ink-6)]">
              Cursor
            </div>
            {hoveredLabel ? (
              <div>
                <div className="truncate text-[13px] text-[var(--color-ink-8)]">
                  {hoveredLabel}
                </div>
                <div className="mt-0.5 flex items-center gap-2 font-mono text-[11px] tabular-nums text-[var(--color-ink-5)]">
                  <span>{Math.round(hoveredHeight ?? 0)} m</span>
                  <span aria-hidden>·</span>
                  <span className="capitalize">{hoveredCategory ?? "—"}</span>
                </div>
              </div>
            ) : (
              <div className="text-[12.5px] text-[var(--color-ink-5)]">
                Hover the model to inspect a footprint.
              </div>
            )}
          </div>
        </>
      )}
    </aside>
  );
}

function LayerRow({
  color,
  label,
  count,
  enabled,
  onToggle,
}: {
  color: string;
  label: string;
  count: number;
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="layer-row-enter">
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={enabled}
        className={clsx(
          "group flex w-full items-center gap-2.5 rounded-[8px] px-1.5 py-1.5 transition-colors active:translate-y-px",
          enabled
            ? "hover:bg-[var(--color-ink-2)]/70"
            : "opacity-50 hover:opacity-80"
        )}
      >
        <span
          aria-hidden
          className={clsx(
            "h-2.5 w-2.5 shrink-0 rounded-[2px] transition-transform",
            !enabled && "scale-90"
          )}
          style={{
            backgroundColor: enabled
              ? color
              : `color-mix(in oklch, ${color} 35%, transparent)`,
          }}
        />
        <span
          className={clsx(
            "flex-1 truncate text-left text-[12.5px] transition-colors",
            enabled ? "text-[var(--color-ink-8)]" : "text-[var(--color-ink-6)]"
          )}
        >
          {label}
        </span>
        <span className="font-mono text-[10.5px] tabular-nums text-[var(--color-ink-5)] tabular-nums">
          {count}
        </span>
        <span
          className={clsx(
            "grid h-5 w-5 place-items-center rounded-md transition-colors",
            enabled
              ? "text-[var(--color-accent)] group-hover:bg-[color-mix(in_oklch,var(--color-accent)_15%,transparent)]"
              : "text-[var(--color-ink-5)] group-hover:bg-[var(--color-ink-2)]"
          )}
        >
          {enabled ? (
            <Eye size={12} weight="bold" />
          ) : (
            <EyeSlash size={12} weight="bold" />
          )}
        </span>
      </button>
    </li>
  );
}

function WardToggleRow({
  enabled,
  onToggle,
  wardCount,
}: {
  enabled: boolean;
  onToggle: () => void;
  wardCount: number;
}) {
  return (
    <li className="list-none">
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={enabled}
        className={clsx(
          "group flex w-full items-center gap-2.5 rounded-[8px] px-1.5 py-1.5 transition-colors active:translate-y-px",
          enabled
            ? "hover:bg-[var(--color-ink-2)]/70"
            : "opacity-50 hover:opacity-80"
        )}
      >
        <span
          aria-hidden
          className="flex h-3.5 w-3.5 shrink-0 items-center justify-center"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M2 4L7 2L12 4V10L7 12L2 10V4Z"
              stroke={enabled ? "rgb(232,188,110)" : "rgb(120,120,120)"}
              strokeWidth="1.3"
              strokeLinejoin="round"
              fill={enabled ? "rgba(232,188,110,0.15)" : "none"}
            />
          </svg>
        </span>
        <span
          className={clsx(
            "flex-1 truncate text-left text-[12.5px] transition-colors",
            enabled ? "text-[var(--color-ink-8)]" : "text-[var(--color-ink-6)]"
          )}
        >
          Ward boundaries
        </span>
        <span className="font-mono text-[10.5px] tabular-nums text-[var(--color-ink-5)]">
          {wardCount > 0 ? wardCount : "—"}
        </span>
        <span
          className={clsx(
            "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
            enabled ? "bg-[rgb(232,188,110)]" : "bg-[var(--color-ink-3)]"
          )}
        >
          <span
            className={clsx(
              "inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform",
              enabled ? "translate-x-[18px]" : "translate-x-[3px]"
            )}
          />
        </span>
      </button>
    </li>
  );
}

const OPACITY_STOPS = [0, 0.25, 0.5, 0.75, 1] as const;

function OpacitySlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  // Snap to nearest stop on release
  const snapToStop = (v: number) => {
    let closest: number = OPACITY_STOPS[0];
    let minDist = Math.abs(v - closest);
    for (const s of OPACITY_STOPS) {
      const d = Math.abs(v - s);
      if (d < minDist) {
        minDist = d;
        closest = s;
      }
    }
    return closest;
  };

  return (
    <div className="flex flex-col gap-1.5">
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onMouseUp={(e) => onChange(snapToStop(Number((e.target as HTMLInputElement).value)))}
        onTouchEnd={(e) => onChange(snapToStop(Number((e.target as HTMLInputElement).value)))}
        className="opacity-slider h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[var(--color-ink-2)] outline-none"
        style={{
          background: `linear-gradient(to right, var(--color-accent) 0%, var(--color-accent) ${value * 100}%, var(--color-ink-2) ${value * 100}%, var(--color-ink-2) 100%)`,
        }}
      />
      <div className="flex items-center justify-between font-mono text-[9px] tabular-nums text-[var(--color-ink-5)]">
        {OPACITY_STOPS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onChange(s)}
            className={clsx(
              "rounded px-0.5 transition-colors",
              Math.abs(value - s) < 0.02
                ? "text-[var(--color-ink-8)]"
                : "hover:text-[var(--color-ink-7)]"
            )}
          >
            {s === 0 ? "0" : s === 1 ? "1" : s.toFixed(2).replace(/^0/, "")}
          </button>
        ))}
      </div>
      <style>{`
        .opacity-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: white;
          box-shadow: 0 1px 3px rgba(0,0,0,0.3);
          cursor: pointer;
          transition: transform 0.1s;
        }
        .opacity-slider::-webkit-slider-thumb:hover {
          transform: scale(1.15);
        }
        .opacity-slider::-moz-range-thumb {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: white;
          box-shadow: 0 1px 3px rgba(0,0,0,0.3);
          cursor: pointer;
          border: none;
        }
      `}</style>
    </div>
  );
}

function ColorModeTab({
  active,
  onClick,
  label,
  loading,
  disabled,
  title,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  loading?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={clsx(
        "relative flex h-full flex-1 items-center justify-center gap-1.5 rounded-full font-mono text-[10.5px] uppercase tracking-[0.18em] transition-colors",
        active
          ? "bg-[var(--color-ink-1)] text-[var(--color-ink-8)] shadow-[0_1px_0_color-mix(in_oklch,var(--color-ink-3)_60%,transparent)]"
          : disabled
          ? "cursor-not-allowed text-[var(--color-ink-5)] opacity-60"
          : "text-[var(--color-ink-6)] hover:text-[var(--color-ink-8)]"
      )}
    >
      {loading ? (
        <span
          aria-hidden
          className="h-2 w-2 animate-pulse rounded-full bg-[var(--color-ink-5)]"
        />
      ) : null}
      <span>{label}</span>
    </button>
  );
}

function EnergyScale({ dataset, loading }: { dataset: EnergyDataset | null; loading: boolean }) {
  if (!dataset) {
    return (
      <div className="mt-1.5 font-mono text-[10.5px] text-[var(--color-ink-5)]">
        {loading
          ? "Loading City of Toronto consumption data\u2026"
          : "Energy dataset unavailable"}
      </div>
    );
  }
  const lo = Math.round(dataset.intensityP5);
  const hi = Math.round(dataset.intensityP95);
  const mid = Math.round((lo + hi) / 2);
  return (
    <div className="mt-1.5 space-y-1.5">
      <div className="flex items-center justify-between font-mono text-[10.5px] tabular-nums text-[var(--color-ink-5)]">
        <span>{lo.toLocaleString()}</span>
        <span>{mid.toLocaleString()}</span>
        <span>{hi.toLocaleString()}+</span>
      </div>
      <div className="flex items-baseline justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-5)]">
        <span>FY {dataset.year}</span>
        <span className="truncate">
          {dataset.recordCount.toLocaleString()} buildings ·{" "}
          {formatKWh(dataset.totalElectricityKWh + dataset.totalGasKWhEq)}
        </span>
      </div>
    </div>
  );
}

// Mirrors `heightToColor` from overlay.ts but emits CSS rgb() strings for
// the static legend strip. Kept as a tiny duplicate to avoid an import
// cycle — both are derived from the same three-stop ramp.
function colorAt(t: number): string {
  const stops = [
    [32, 46, 64],
    [78, 124, 138],
    [212, 226, 220],
  ];
  const idx = t < 0.5 ? 0 : 1;
  const local = idx === 0 ? t * 2 : (t - 0.5) * 2;
  const a = stops[idx];
  const b = stops[idx + 1];
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * local)}, ${Math.round(
    a[1] + (b[1] - a[1]) * local
  )}, ${Math.round(a[2] + (b[2] - a[2]) * local)})`;
}
