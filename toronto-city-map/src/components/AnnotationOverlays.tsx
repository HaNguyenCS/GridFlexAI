// AnnotationOverlays — screen-space callouts that arrow to building rooftops.
//
// For every active overlay (filtered by the user's enabled layers) we
// project the [centroid lng, centroid lat, building height] anchor into
// pixel space using deck.gl's WebMercatorViewport. The callout itself
// is a small ops-console chip floating in the air; an SVG arrow drawn
// underneath connects the chip's anchor edge to the rooftop point.
//
// Implementation notes:
//   - We render the chip with a transform-only translate so motion
//     stays GPU-friendly (no layout thrash on viewState changes).
//   - The chip mounts behind a `data-mounted` flag so the very first
//     paint runs the entry transition (opacity + scale, ease-out-quart).
//   - The SVG layer is sibling to the chips so arrows draw under them.
//   - Z-ordered by start time so the most-recent callouts sit on top.
//
// The component is purely decorative and never blocks pointer events.

import { useEffect, useMemo, useRef, useState } from "react";
import { WebMercatorViewport, type MapViewState } from "@deck.gl/core";

import type { Building, BuildingOverlay, StreamEventKind } from "../lib/types";
import { KIND_LABEL } from "../lib/sources";

interface Props {
  width: number;
  height: number;
  viewState: MapViewState;
  buildingsById: Map<string, Building>;
  overlays: BuildingOverlay[];
  /** Per-kind visibility from the legend. */
  enabledKinds: Set<StreamEventKind>;
  /** Per-source visibility from the sources panel. */
  enabledSources: Set<string>;
  /** Cap concurrent callouts so the screen never floods. */
  maxVisible?: number;
  onFocus?: (buildingId: string) => void;
}

interface ProjectedCallout {
  overlay: BuildingOverlay;
  building: Building;
  anchor: { x: number; y: number };
  panel: { x: number; y: number };
  bend: number;
}

const DEFAULT_MAX = 6;

export function AnnotationOverlays({
  width,
  height,
  viewState,
  buildingsById,
  overlays,
  enabledKinds,
  enabledSources,
  maxVisible = DEFAULT_MAX,
  onFocus,
}: Props) {
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

  const callouts = useMemo<ProjectedCallout[]>(() => {
    if (!viewport) return [];
    const margin = 24;
    const items: ProjectedCallout[] = [];
    // Newest first so the cap keeps the freshest events on screen.
    const sorted = [...overlays].sort(
      (a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0)
    );
    for (const o of sorted) {
      if (o.kind === "clear") continue;
      if (!enabledKinds.has(o.kind)) continue;
      if (o.sourceId && !enabledSources.has(o.sourceId)) continue;
      const b = buildingsById.get(o.buildingId);
      if (!b) continue;
      const [clng, clat] = centroid(b.contour);
      const anchorLngLat: [number, number, number] = [clng, clat, b.height];
      let projected: number[];
      try {
        projected = viewport.project(anchorLngLat);
      } catch {
        continue;
      }
      const [ax, ay] = projected;
      if (
        !Number.isFinite(ax) ||
        !Number.isFinite(ay) ||
        ax < -margin ||
        ay < -margin ||
        ax > width + margin ||
        ay > height + margin
      ) {
        continue;
      }
      const offset = staggerOffset(o.buildingId);
      let px = ax + offset.dx;
      let py = ay + offset.dy;
      // Clamp inside the viewport with a generous gutter.
      const gutterX = 16;
      const gutterY = 12;
      const cardW = 220;
      const cardH = 64;
      px = Math.max(gutterX, Math.min(width - cardW - gutterX, px));
      py = Math.max(gutterY, Math.min(height - cardH - gutterY, py));
      items.push({
        overlay: o,
        building: b,
        anchor: { x: ax, y: ay },
        panel: { x: px, y: py },
        bend: offset.bend,
      });
      if (items.length >= maxVisible) break;
    }
    return items;
  }, [
    viewport,
    overlays,
    buildingsById,
    enabledKinds,
    enabledSources,
    width,
    height,
    maxVisible,
  ]);

  if (!viewport) return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        width={width}
        height={height}
      >
        <defs>
          <filter id="callout-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="1.6" />
          </filter>
        </defs>
        {callouts.map((c) => (
          <CalloutArrow key={c.overlay.buildingId} c={c} />
        ))}
      </svg>

      {callouts.map((c) => (
        <CalloutChip
          key={c.overlay.buildingId}
          c={c}
          onFocus={onFocus}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Arrow (SVG) — drawn under the chip
// ---------------------------------------------------------------------------

function CalloutArrow({ c }: { c: ProjectedCallout }) {
  const color = c.overlay.hex ?? "#7ad4ff";
  const ax = c.anchor.x;
  const ay = c.anchor.y;
  // Connection point on the chip: bottom-mid of its bounding box.
  const cardW = 220;
  const cardH = 64;
  // Pick the chip edge closest to the anchor for a clean line.
  const cx = c.panel.x + cardW / 2;
  const cy = c.panel.y + cardH;
  // Bezier control point — pulled toward the anchor with a side bend.
  const midX = (ax + cx) / 2 + c.bend;
  const midY = (ay + cy) / 2 - 18;
  const path = `M ${cx} ${cy} Q ${midX} ${midY} ${ax} ${ay}`;

  return (
    <g className="callout-arrow-enter" style={{ ["--callout-color" as never]: color }}>
      {/* soft halo */}
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeOpacity="0.22"
        strokeWidth="6"
        strokeLinecap="round"
        filter="url(#callout-glow)"
      />
      {/* main stroke (drawn-in animation via CSS dashoffset) */}
      <path
        className="callout-arrow-stroke"
        d={path}
        fill="none"
        stroke={color}
        strokeWidth="1.4"
        strokeLinecap="round"
        pathLength={1}
      />
      {/* anchor dot at rooftop */}
      <circle
        cx={ax}
        cy={ay}
        r={3.2}
        fill={color}
        className="callout-anchor-dot"
      />
      <circle
        cx={ax}
        cy={ay}
        r={6}
        fill="none"
        stroke={color}
        strokeOpacity="0.55"
        strokeWidth="1"
        className="callout-anchor-ring"
      />
    </g>
  );
}

// ---------------------------------------------------------------------------
// Chip — the floating annotated panel
// ---------------------------------------------------------------------------

function CalloutChip({
  c,
  onFocus,
}: {
  c: ProjectedCallout;
  onFocus?: (buildingId: string) => void;
}) {
  const [mounted, setMounted] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const r = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(r);
  }, []);

  const o = c.overlay;
  const color = o.hex ?? "#7ad4ff";
  const label = KIND_LABEL[o.kind];
  const sevPct = Math.round(100 * Math.max(0, Math.min(1, o.severity ?? 0.4)));
  const ttlPct = computeTtlPct(o);

  return (
    <div
      ref={ref}
      data-mounted={mounted ? "true" : "false"}
      className="callout-chip pointer-events-auto absolute"
      style={{
        transform: `translate3d(${c.panel.x}px, ${c.panel.y}px, 0)`,
        width: 220,
      }}
    >
      <div
        className="callout-chip-inner relative overflow-hidden rounded-[10px] border bg-[color-mix(in_oklch,var(--color-ink-0)_82%,transparent)] backdrop-blur-xl"
        style={{
          borderColor: `color-mix(in oklch, ${color} 40%, var(--color-ink-3))`,
          boxShadow: `0 8px 24px -10px color-mix(in oklch, ${color} 30%, transparent)`,
        }}
      >
        {/* TTL bar — runs from full to empty over the lifetime. */}
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 h-[2px]"
          style={{
            background: `linear-gradient(90deg, ${color} 0%, ${color} ${ttlPct}%, transparent ${ttlPct}%)`,
            opacity: 0.85,
          }}
        />

        <button
          type="button"
          onClick={() => onFocus?.(o.buildingId)}
          className="flex w-full items-start gap-2 px-3 py-2.5 text-left transition-colors hover:bg-[color-mix(in_oklch,var(--color-ink-2)_55%,transparent)] active:translate-y-px"
        >
          <span
            className="mt-[3px] grid h-[14px] w-[14px] shrink-0 place-items-center rounded-full"
            style={{
              backgroundColor: `color-mix(in oklch, ${color} 18%, var(--color-ink-1))`,
              border: `1px solid color-mix(in oklch, ${color} 60%, transparent)`,
            }}
          >
            <span
              className="h-[5px] w-[5px] rounded-full"
              style={{ backgroundColor: color }}
            />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span
                className="font-mono text-[9.5px] uppercase tracking-[0.22em]"
                style={{ color }}
              >
                {label}
              </span>
              <span className="truncate font-mono text-[9.5px] tabular-nums text-[var(--color-ink-5)]">
                {labelOrId(c.building)}
              </span>
            </div>
            <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-[var(--color-ink-8)]">
              {o.note ?? "—"}
            </p>
            <div className="mt-1 flex items-center justify-between font-mono text-[10px] tabular-nums text-[var(--color-ink-5)]">
              <span>{Math.round(c.building.height)} m</span>
              <span>sev · {sevPct}%</span>
            </div>
          </div>
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function centroid(ring: [number, number][]): [number, number] {
  let x = 0;
  let y = 0;
  const n = Math.max(1, ring.length - 1);
  for (let i = 0; i < n; i++) {
    x += ring[i][0];
    y += ring[i][1];
  }
  return [x / n, y / n];
}

function labelOrId(b: Building): string {
  return b.label ?? b.id;
}

/**
 * Deterministic stagger so multiple callouts on adjacent buildings don't
 * collide on the same offset. Ranges sit above and to the right by
 * default, so the chip clears the rooftop instead of covering it.
 */
function staggerOffset(seed: string): { dx: number; dy: number; bend: number } {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const a = (h % 100) / 100;
  const b = ((h >> 7) % 100) / 100;
  const dx = -110 + a * 220; // [-110, 110]
  const dy = -150 + b * 60; // [-150, -90]
  const bend = -30 + ((h >> 11) % 60);
  return { dx, dy, bend };
}

function computeTtlPct(o: BuildingOverlay): number {
  if (!o.expiresAt || !o.startedAt || !o.ttlMs) return 100;
  const now = Date.now();
  const total = o.ttlMs;
  const remaining = Math.max(0, o.expiresAt - now);
  return Math.max(0, Math.min(100, (remaining / total) * 100));
}
