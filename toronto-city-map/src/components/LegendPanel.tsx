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

import { useMemo, useState, useRef, useEffect } from "react";
import { Eye, EyeSlash, Swatches, CaretDown } from "@phosphor-icons/react";
import clsx from "clsx";
import type { StreamEventKind, StreamSource, GridSeverity } from "../lib/types";
import { KIND_COLOR, KIND_LABEL } from "../lib/sources";
import { SEVERITY_COLORS, SEVERITY_LABELS } from "../lib/gridStreams";
import type { ColorMode } from "./MapView";
import type { EnergyDataset, EnergyGeoDataset } from "../lib/energy";
import { formatKWh, sampleEnergyRamp } from "../lib/energy";
import { HEIGHT_PALETTES, getPalette, type HeightPalette } from "../lib/heightPalettes";



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
  /** Active colour mode. */
  colorMode: ColorMode;
  /** Callback to change colour mode. */
  onColorModeChange: (mode: ColorMode) => void;
  /** Energy dataset for the energy tab. */
  energyDataset: EnergyDataset | null;
  /** Energy geojson dataset. */
  energyGeo: EnergyGeoDataset | null;
  /** Whether energy data is currently loading. */
  energyLoading: boolean;
  /** Height palette ID for 3-stop gradient. */
  heightPaletteId: string;
  /** Callback to change height palette. */
  onHeightPaletteIdChange: (id: string) => void;
  /** Enabled grid severity levels. */
  enabledSeverities: Set<GridSeverity>;
  /** Callback to toggle a severity level. */
  onToggleSeverity: (sev: GridSeverity) => void;
  /** Counts of active wards per severity. */
  severityCounts: Record<string, number>;
  /** Current speed multiplier for event feed and grid streams. */
  speed: number;
  /** Callback to change speed multiplier. */
  onSpeedChange: (speed: number) => void;
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

  showWards,
  onToggleWards,
  wardCount,
  buildingOpacity,
  onBuildingOpacityChange,
  colorMode,
  onColorModeChange,
  energyDataset,
  energyGeo,
  energyLoading,
  heightPaletteId,
  onHeightPaletteIdChange,
  enabledSeverities,
  onToggleSeverity,
  severityCounts,
  speed,
  onSpeedChange,
}: Props) {
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const paletteRef = useRef<HTMLDivElement>(null);
  const currentPalette = useMemo(() => getPalette(heightPaletteId), [heightPaletteId]);
  const [annotationTab, setAnnotationTab] = useState<"kinds" | "grid">("kinds");
  
  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (paletteRef.current && !paletteRef.current.contains(event.target as Node)) {
        setIsPaletteOpen(false);
      }
    }
    
    if (isPaletteOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isPaletteOpen]);
  
  const heightRamp = useMemo(
    () =>
      Array.from({ length: 24 }, (_, i) => {
        const t = i / 23;
        return colorAt(t, currentPalette);
      }),
    [currentPalette]
  );


  // Render kinds in canonical order, but only those we've actually seen.
  const kindRows = useMemo(
    () => KIND_ORDER.filter((k) => seenKinds.has(k)),
    [seenKinds]
  );

  return (
    <aside className={clsx(
      "pointer-events-auto absolute bottom-6 left-6 z-10 flex flex-col gap-4 rounded-[14px] bg-[color-mix(in_oklch,var(--color-ink-1)_88%,transparent)] backdrop-blur-xl transition-all duration-300 ease-in-out",
      collapsed ? "w-auto border-0 p-3" : "w-[300px] border border-[var(--color-ink-3)] p-4"
    )}>
      {collapsed ? (
        <button
          type="button"
          onClick={onToggleCollapse}
          title="Expand legend"
          className="flex h-9 items-center gap-2 rounded-full border-0 bg-[color-mix(in_oklch,var(--color-ink-1)_82%,transparent)] px-3 text-[12px] text-[var(--color-ink-7)] backdrop-blur-md transition-all hover:text-[var(--color-ink-8)] hover:bg-[color-mix(in_oklch,var(--color-ink-1)_92%,transparent)] active:translate-y-[1px]"
        >
          <Swatches size={13} weight="bold" />
          <span className="font-mono text-[10px] uppercase tracking-[0.18em]">
            Legend
          </span>
        </button>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-[var(--color-ink-6)]">
              Legend
            </span>
            <button
              type="button"
              onClick={onToggleCollapse}
              className="grid h-6 w-6 place-items-center rounded-md text-[var(--color-ink-6)] transition-colors hover:bg-[var(--color-ink-2)] hover:text-[var(--color-ink-8)] active:translate-y-px"
              title="Collapse legend"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>
            </button>
          </div>
          
          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-[var(--color-ink-6)]">
                Color by
              </span>
              <span className="font-mono text-[10.5px] tabular-nums text-[var(--color-ink-5)]">
                {colorMode === "energy" ? "kWh/m\u00B2" : "metres"}
              </span>
            </div>

            {/* Mode tabs */}
            <div className="mb-2 flex gap-1">
              <ModeTab
                label="Height"
                active={colorMode === "height"}
                onClick={() => onColorModeChange("height")}
              />
              <ModeTab
                label="Energy use"
                active={colorMode === "energy"}
                onClick={() => onColorModeChange("energy")}
                loading={energyLoading}
              />
            </div>

            {colorMode === "energy" ? (
              <EnergyRamp dataset={energyDataset} geo={energyGeo} />
            ) : (
              <>
                {/* Color scale with dropdown */}
                <div className="relative mt-3">
                  <button
                    type="button"
                    onClick={() => setIsPaletteOpen(!isPaletteOpen)}
                    className="w-full group"
                  >
                    <div className="flex h-2.5 w-full overflow-hidden rounded-full">
                      {heightRamp.map((c, i) => (
                        <span
                          key={i}
                          className="block h-full flex-1"
                          style={{ background: c }}
                        />
                      ))}
                    </div>
                    <div className="mt-1.5 flex items-center justify-between font-mono text-[10.5px] tabular-nums text-[var(--color-ink-5)]">
                      <span>10</span>
                      <span>120</span>
                      <span>320+</span>
                    </div>
                    <div className="mt-2 flex items-center justify-center gap-1.5 rounded-md border border-[var(--color-ink-3)] bg-[var(--color-ink-2)]/40 px-2 py-1.5 transition-colors group-hover:border-[var(--color-ink-4)] group-hover:bg-[var(--color-ink-2)]">
                      <div className="flex h-3 w-12 overflow-hidden rounded-sm">
                        {currentPalette.stops.map((color, i) => (
                          <span
                            key={i}
                            className="block h-full flex-1"
                            style={{ background: color }}
                          />
                        ))}
                      </div>
                      <span className="font-mono text-[9px] uppercase tracking-[0.15em] text-[var(--color-ink-6)]">
                        {currentPalette.name}
                      </span>
                      <CaretDown
                        size={10}
                        weight="bold"
                        className={clsx(
                          "text-[var(--color-ink-5)] transition-transform",
                          isPaletteOpen && "rotate-180"
                        )}
                      />
                    </div>
                  </button>

                  {/* Palette dropdown */}
                  {isPaletteOpen && (
                    <div 
                      ref={paletteRef}
                      className="absolute left-0 z-20 mt-2 w-full rounded-lg border border-[var(--color-ink-3)] bg-[var(--color-ink-1)] p-2 shadow-lg"
                    >
                    <div className="mb-2 font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--color-ink-5)]">
                      Select palette
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {HEIGHT_PALETTES.map((palette) => (
                        <button
                          key={palette.id}
                          type="button"
                          onClick={() => {
                            onHeightPaletteIdChange(palette.id);
                            setIsPaletteOpen(false);
                          }}
                          className={clsx(
                            "group/item flex flex-col items-center gap-1 rounded-md border px-2 py-2 transition-all",
                            heightPaletteId === palette.id
                              ? "border-[var(--color-ink-6)] bg-[var(--color-ink-2)]"
                              : "border-[var(--color-ink-3)] hover:border-[var(--color-ink-4)] hover:bg-[var(--color-ink-2)]/50"
                          )}
                          title={palette.description}
                        >
                          <div className="flex h-5 w-full overflow-hidden rounded">
                            {palette.stops.map((color, i) => (
                              <span
                                key={i}
                                className="block h-full flex-1"
                                style={{ background: color }}
                              />
                            ))}
                          </div>
                          <span className="font-mono text-[9px] leading-none text-[var(--color-ink-6)]">
                            {palette.name}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                </div>
              </>
            )}
          </div>

          <div className="h-px bg-[var(--color-ink-2)]" />

          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-[var(--color-ink-6)]">
                Annotation layers
              </span>
              <span className="font-mono text-[10.5px] tabular-nums text-[var(--color-ink-5)]">
                {annotationTab === "kinds"
                  ? `${enabledKinds.size}/${kindRows.length || "\u2014"} on`
                  : `${enabledSeverities.size}/4 on`}
              </span>
            </div>
            {/* Tab switcher */}
            <div className="mb-2 flex gap-1">
              <ModeTab
                label="Kinds"
                active={annotationTab === "kinds"}
                onClick={() => setAnnotationTab("kinds")}
              />
              <ModeTab
                label="Grid"
                active={annotationTab === "grid"}
                onClick={() => setAnnotationTab("grid")}
              />
            </div>
            {annotationTab === "kinds" ? (
              kindRows.length === 0 ? (
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
              )
            ) : (
              <ul className="grid grid-cols-1 gap-1">
                {(["normal", "moderate", "high", "critical"] as GridSeverity[]).map((sev) => (
                  <LayerRow
                    key={sev}
                    color={SEVERITY_COLORS[sev]}
                    label={SEVERITY_LABELS[sev]}
                    count={severityCounts[sev] ?? 0}
                    enabled={enabledSeverities.has(sev)}
                    onToggle={() => onToggleSeverity(sev)}
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

          <div className="h-px bg-[var(--color-ink-2)]" />

          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-[var(--color-ink-6)]">
                Stream speed
              </span>
              <span className="font-mono text-[10.5px] tabular-nums text-[var(--color-ink-5)]">
                {speed}×
              </span>
            </div>
            <SpeedSlider value={speed} onChange={onSpeedChange} />
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

const SPEED_STOPS = [0.25, 0.5, 1, 1.5, 2] as const;

function SpeedSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  // Map speed value to nearest stop index.
  const speedToIndex = (v: number) => {
    let closest = 0;
    let minDist = Math.abs(v - SPEED_STOPS[0]);
    for (let i = 1; i < SPEED_STOPS.length; i++) {
      const d = Math.abs(v - SPEED_STOPS[i]);
      if (d < minDist) { minDist = d; closest = i; }
    }
    return closest;
  };
  const currentIndex = speedToIndex(value);
  const fillPct = (currentIndex / (SPEED_STOPS.length - 1)) * 100;

  return (
    <div className="flex flex-col gap-1.5">
      <input
        type="range"
        min={0}
        max={SPEED_STOPS.length - 1}
        step={1}
        value={currentIndex}
        onChange={(e) => onChange(SPEED_STOPS[Number(e.target.value)])}
        className="speed-slider h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[var(--color-ink-2)] outline-none"
        style={{
          background: `linear-gradient(to right, var(--color-accent) 0%, var(--color-accent) ${fillPct}%, var(--color-ink-2) ${fillPct}%, var(--color-ink-2) 100%)`,
        }}
      />
      <div className="flex items-center justify-between font-mono text-[9px] tabular-nums text-[var(--color-ink-5)]">
        {SPEED_STOPS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onChange(s)}
            className={clsx(
              "rounded px-0.5 transition-colors",
              value === s
                ? "text-[var(--color-ink-8)]"
                : "hover:text-[var(--color-ink-7)]"
            )}
          >
            {s}×
          </button>
        ))}
      </div>
      <style>{`
        .speed-slider::-webkit-slider-thumb {
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
        .speed-slider::-webkit-slider-thumb:hover {
          transform: scale(1.15);
        }
        .speed-slider::-moz-range-thumb {
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



// Mirrors `heightToColor` from overlay.ts but emits CSS rgb() strings for
// the static legend strip. Uses the same 3-stop palette interpolation.
function colorAt(t: number, palette: HeightPalette): string {
  const [low, mid, high] = palette.stops.map(hexToRgb);
  const clampedT = Math.min(1, Math.max(0, t));
  
  let rgb: [number, number, number];
  if (clampedT < 0.5) {
    const localT = clampedT * 2;
    rgb = [
      Math.round(low[0] + (mid[0] - low[0]) * localT),
      Math.round(low[1] + (mid[1] - low[1]) * localT),
      Math.round(low[2] + (mid[2] - low[2]) * localT),
    ];
  } else {
    const localT = (clampedT - 0.5) * 2;
    rgb = [
      Math.round(mid[0] + (high[0] - mid[0]) * localT),
      Math.round(mid[1] + (high[1] - mid[1]) * localT),
      Math.round(mid[2] + (high[2] - mid[2]) * localT),
    ];
  }
  
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

function hexToRgb(hex: string): [number, number, number] {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return [0, 0, 0];
  return [
    parseInt(result[1], 16),
    parseInt(result[2], 16),
    parseInt(result[3], 16),
  ];
}

// ---------------------------------------------------------------------------
// Color mode tab switcher
// ---------------------------------------------------------------------------

function ModeTab({
  label,
  active,
  onClick,
  loading,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className={clsx(
        "relative flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] transition-colors active:translate-y-px",
        active
          ? "bg-[var(--color-ink-2)] text-[var(--color-ink-8)]"
          : "text-[var(--color-ink-5)] hover:bg-[var(--color-ink-2)]/50 hover:text-[var(--color-ink-7)]",
        loading && "cursor-wait opacity-60"
      )}
    >
      {loading && (
        <span
          className="inline-block h-2.5 w-2.5 rounded-full border border-[var(--color-ink-4)] border-t-transparent"
          style={{ animation: "mode-tab-spin 0.8s linear infinite" }}
        />
      )}
      <span className="font-mono text-[10.5px] uppercase tracking-[0.18em]">
        {label}
      </span>
      <style>{`@keyframes mode-tab-spin { to { transform: rotate(360deg); } }`}</style>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Energy colour ramp display
// ---------------------------------------------------------------------------

function EnergyRamp({
  dataset,
  geo,
}: {
  dataset: EnergyDataset | null;
  geo: EnergyGeoDataset | null;
}) {
  const ramp = useMemo(() => sampleEnergyRamp(24), []);

  if (!dataset && !geo) {
    return (
      <div className="flex flex-col items-center gap-1.5 py-3 text-center">
        <span className="text-[11.5px] text-[var(--color-ink-5)]">
          Loading energy data…
        </span>
      </div>
    );
  }

  const p5 = geo?.intensityP5 ?? dataset?.intensityP5 ?? 0;
  const p95 = geo?.intensityP95 ?? dataset?.intensityP95 ?? 0;
  const featureCount = geo?.featureCount ?? 0;
  const totalEnergy = geo?.totalEnergyKWh ?? dataset?.totalElectricityKWh ?? 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full">
        {ramp.map((c, i) => (
          <span
            key={i}
            className="block h-full flex-1"
            style={{ background: c }}
          />
        ))}
      </div>
      <div className="flex items-center justify-between font-mono text-[10.5px] tabular-nums text-[var(--color-ink-5)]">
        <span>{Math.round(p5)}</span>
        <span>kWh/m²</span>
        <span>{Math.round(p95)}</span>
      </div>
      {(dataset || geo) && (
        <div className="flex flex-col gap-0.5 pt-1">
          {featureCount > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-[10.5px] text-[var(--color-ink-5)]">Metered buildings</span>
              <span className="font-mono text-[10.5px] tabular-nums text-[var(--color-ink-7)]">{featureCount}</span>
            </div>
          )}
          {totalEnergy > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-[10.5px] text-[var(--color-ink-5)]">Total consumption</span>
              <span className="font-mono text-[10.5px] tabular-nums text-[var(--color-ink-7)]">{formatKWh(totalEnergy)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
