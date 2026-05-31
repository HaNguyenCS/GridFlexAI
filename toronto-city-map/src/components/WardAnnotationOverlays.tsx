// WardAnnotationOverlays — screen-space callouts for grid stream ward events.
//
// Similar to AnnotationOverlays but for ward-level grid severity data from
// useGridStreams. Each active ward gets a floating chip with an SVG arrow
// pointing to the ward's centroid on the map.

import { useEffect, useMemo, useState } from "react";
import { WebMercatorViewport, type MapViewState } from "@deck.gl/core";

import type { Ward } from "../lib/wards";
import type { WardGridColor } from "../lib/gridStreams";
import { SEVERITY_LABELS } from "../lib/gridStreams";

interface Props {
  width: number;
  height: number;
  viewState: MapViewState;
  wards: Ward[];
  wardColors: Map<string, WardGridColor>;
  maxVisible?: number;
}

interface WardCallout {
  ward: Ward;
  gridColor: WardGridColor;
  anchor: { x: number; y: number };
  panel: { x: number; y: number };
  bend: number;
}

const DEFAULT_MAX = 8;
const CARD_W = 200;
const CARD_H = 72;

export function WardAnnotationOverlays({
  width,
  height,
  viewState,
  wards,
  wardColors,
  maxVisible = DEFAULT_MAX,
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

  const callouts = useMemo<WardCallout[]>(() => {
    if (!viewport || wardColors.size === 0) return [];
    const margin = 24;
    const items: WardCallout[] = [];

    // Sort by severity (critical first) then by expiry time
    const severityOrder = { critical: 0, high: 1, moderate: 2, normal: 3 };
    const sorted = [...wardColors.entries()].sort(
      ([, a], [, b]) =>
        severityOrder[a.severity] - severityOrder[b.severity] ||
        b.expiresAt - a.expiresAt
    );

    for (const [wardId, gc] of sorted) {
      const ward = wards.find((w) => w.id === wardId);
      if (!ward) continue;

      const [clng, clat] = ward.centroid;
      let projected: number[];
      try {
        projected = viewport.project([clng, clat]);
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

      const offset = staggerOffset(wardId);
      let px = ax + offset.dx;
      let py = ay + offset.dy;
      const gutterX = 16;
      const gutterY = 12;
      px = Math.max(gutterX, Math.min(width - CARD_W - gutterX, px));
      py = Math.max(gutterY, Math.min(height - CARD_H - gutterY, py));

      items.push({
        ward,
        gridColor: gc,
        anchor: { x: ax, y: ay },
        panel: { x: px, y: py },
        bend: offset.bend,
      });
      if (items.length >= maxVisible) break;
    }
    return items;
  }, [viewport, wardColors, wards, width, height, maxVisible]);

  if (!viewport || callouts.length === 0) return null;

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
          <filter id="ward-callout-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="1.6" />
          </filter>
        </defs>
        {callouts.map((c) => (
          <WardCalloutArrow key={c.ward.id} c={c} />
        ))}
      </svg>

      {callouts.map((c) => (
        <WardCalloutChip key={`chip-${c.ward.id}`} c={c} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Arrow (SVG)
// ---------------------------------------------------------------------------

function WardCalloutArrow({ c }: { c: WardCallout }) {
  const color = c.gridColor.outline
    ? `rgb(${c.gridColor.outline[0]}, ${c.gridColor.outline[1]}, ${c.gridColor.outline[2]})`
    : "#22c55e";
  const ax = c.anchor.x;
  const ay = c.anchor.y;
  const cx = c.panel.x + CARD_W / 2;
  const cy = c.panel.y + CARD_H;
  const midX = (ax + cx) / 2 + c.bend;
  const midY = (ay + cy) / 2 - 18;
  const path = `M ${cx} ${cy} Q ${midX} ${midY} ${ax} ${ay}`;

  return (
    <g style={{ ["--ward-color" as never]: color }}>
      {/* soft halo */}
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeOpacity="0.22"
        strokeWidth="6"
        strokeLinecap="round"
        filter="url(#ward-callout-glow)"
      />
      {/* main stroke */}
      <path
        className="ward-callout-arrow-stroke"
        d={path}
        fill="none"
        stroke={color}
        strokeWidth="1.4"
        strokeLinecap="round"
        pathLength={1}
      />
      {/* anchor dot at ward centroid */}
      <circle cx={ax} cy={ay} r={3.5} fill={color} className="ward-callout-dot" />
      <circle
        cx={ax}
        cy={ay}
        r={7}
        fill="none"
        stroke={color}
        strokeOpacity="0.5"
        strokeWidth="1"
        className="ward-callout-ring"
      />
    </g>
  );
}

// ---------------------------------------------------------------------------
// Chip
// ---------------------------------------------------------------------------

function WardCalloutChip({ c }: { c: WardCallout }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const r = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(r);
  }, []);

  const gc = c.gridColor;
  const color = gc.outline
    ? `rgb(${gc.outline[0]}, ${gc.outline[1]}, ${gc.outline[2]})`
    : "#22c55e";
  const sevLabel = SEVERITY_LABELS[gc.severity];
  const ttlPct = computeTtlPct(gc);

  return (
    <div
      data-mounted={mounted ? "true" : "false"}
      className="ward-callout-chip pointer-events-none absolute"
      style={{
        transform: `translate3d(${c.panel.x}px, ${c.panel.y}px, 0)`,
        width: CARD_W,
      }}
    >
      <div
        className="ward-callout-chip-inner relative overflow-hidden rounded-[10px] border bg-[color-mix(in_oklch,var(--color-ink-0)_82%,transparent)] backdrop-blur-xl"
        style={{
          borderColor: `color-mix(in oklch, ${color} 40%, var(--color-ink-3))`,
          boxShadow: `0 8px 24px -10px color-mix(in oklch, ${color} 30%, transparent)`,
        }}
      >
        {/* TTL bar */}
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 h-[2px]"
          style={{
            background: `linear-gradient(90deg, ${color} 0%, ${color} ${ttlPct}%, transparent ${ttlPct}%)`,
            opacity: 0.85,
          }}
        />

        <div className="flex items-start gap-2 px-3 py-2.5">
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
                {sevLabel}
              </span>
              <span className="truncate font-mono text-[9.5px] tabular-nums text-[var(--color-ink-5)]">
                Ward {c.ward.wardNumber}
              </span>
            </div>
            <p className="mt-0.5 line-clamp-1 text-[11px] leading-snug text-[var(--color-ink-7)]">
              {c.ward.name}
            </p>
            <div className="mt-1 flex items-center justify-between font-mono text-[10px] tabular-nums text-[var(--color-ink-5)]">
              <span className="truncate">{gc.metric}</span>
              <span>{gc.value}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function staggerOffset(seed: string): { dx: number; dy: number; bend: number } {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const a = (h % 100) / 100;
  const b = ((h >> 7) % 100) / 100;
  const dx = -100 + a * 200;
  const dy = -140 + b * 50;
  const bend = -25 + ((h >> 11) % 50);
  return { dx, dy, bend };
}

function computeTtlPct(gc: WardGridColor): number {
  if (!gc.expiresAt) return 100;
  const now = Date.now();
  // Assume a max TTL of 12000ms (critical severity)
  const total = 12000;
  const remaining = Math.max(0, gc.expiresAt - now);
  return Math.max(0, Math.min(100, (remaining / total) * 100));
}
