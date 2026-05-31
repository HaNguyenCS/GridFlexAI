// TradeAnnotationOverlays — floating annotations with arrows showing trades between wards.
//
// When a trade is confirmed, this component renders an SVG arrow from the source ward
// to the destination ward, along with a floating chip showing trade details.

import { useEffect, useMemo, useState } from "react";
import { WebMercatorViewport, type MapViewState } from "@deck.gl/core";

import type { Ward } from "../lib/mapTypes";
import type { Trade } from "../lib/types";

interface Props {
  width: number;
  height: number;
  viewState: MapViewState;
  wards: Ward[];
  trades: Trade[];
  maxVisible?: number;
}

interface TradeCallout {
  trade: Trade;
  fromWard: Ward;
  toWard: Ward;
  fromAnchor: { x: number; y: number };
  toAnchor: { x: number; y: number };
  panel: { x: number; y: number };
  bend: number;
}

const DEFAULT_MAX = 6;
const CARD_W = 180;
const CARD_H = 60;

export function TradeAnnotationOverlays({
  width,
  height,
  viewState,
  wards,
  trades,
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

  const wardMap = useMemo(() => {
    const map = new Map<string, Ward>();
    for (const ward of wards) {
      map.set(ward.id, ward);
    }
    return map;
  }, [wards]);

  const callouts = useMemo<TradeCallout[]>(() => {
    if (!viewport || trades.length === 0) return [];
    const margin = 24;
    const items: TradeCallout[] = [];

    for (const trade of trades) {
      const fromWard = wardMap.get(trade.from_zone_id);
      const toWard = wardMap.get(trade.to_zone_id);
      if (!fromWard || !toWard) continue;

      // Project from ward centroid
      const [fromLng, fromLat] = fromWard.centroid;
      let fromProjected: number[];
      try {
        fromProjected = viewport.project([fromLng, fromLat]);
      } catch {
        continue;
      }
      const [fromX, fromY] = fromProjected;

      // Project to ward centroid
      const [toLng, toLat] = toWard.centroid;
      let toProjected: number[];
      try {
        toProjected = viewport.project([toLng, toLat]);
      } catch {
        continue;
      }
      const [toX, toY] = toProjected;

      // Check if both points are within viewport (with margin)
      if (
        !Number.isFinite(fromX) ||
        !Number.isFinite(fromY) ||
        !Number.isFinite(toX) ||
        !Number.isFinite(toY) ||
        fromX < -margin ||
        fromY < -margin ||
        fromX > width + margin ||
        fromY > height + margin ||
        toX < -margin ||
        toY < -margin ||
        toX > width + margin ||
        toY > height + margin
      ) {
        continue;
      }

      // Position the chip at the midpoint of the arrow
      const midX = (fromX + toX) / 2;
      const midY = (fromY + toY) / 2;
      const offset = staggerOffset(`${trade.from_zone_id}-${trade.to_zone_id}`);
      
      let px = midX + offset.dx - CARD_W / 2;
      let py = midY + offset.dy - CARD_H / 2;
      
      // Clamp inside the viewport
      const gutterX = 16;
      const gutterY = 12;
      px = Math.max(gutterX, Math.min(width - CARD_W - gutterX, px));
      py = Math.max(gutterY, Math.min(height - CARD_H - gutterY, py));

      items.push({
        trade,
        fromWard,
        toWard,
        fromAnchor: { x: fromX, y: fromY },
        toAnchor: { x: toX, y: toY },
        panel: { x: px, y: py },
        bend: offset.bend,
      });

      if (items.length >= maxVisible) break;
    }

    return items;
  }, [viewport, trades, wardMap, width, height, maxVisible]);

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
          <filter id="trade-callout-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="2" />
          </filter>
          <marker
            id="trade-arrowhead"
            markerWidth="10"
            markerHeight="8"
            refX="9"
            refY="4"
            orient="auto"
          >
            <path
              d="M 0 0 L 10 4 L 0 8 Z"
              fill="#38bdf8"
              opacity="0.9"
            />
          </marker>
        </defs>
        {callouts.map((c) => (
          <TradeArrow key={`${c.trade.from_zone_id}-${c.trade.to_zone_id}`} c={c} />
        ))}
      </svg>

      {callouts.map((c) => (
        <TradeChip key={`chip-${c.trade.from_zone_id}-${c.trade.to_zone_id}`} c={c} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Arrow (SVG)
// ---------------------------------------------------------------------------

function TradeArrow({ c }: { c: TradeCallout }) {
  const color = "#38bdf8"; // Light blue for trades
  const fromX = c.fromAnchor.x;
  const fromY = c.fromAnchor.y;
  const toX = c.toAnchor.x;
  const toY = c.toAnchor.y;

  // Calculate control point for curved arrow
  const midX = (fromX + toX) / 2;
  const midY = (fromY + toY) / 2;
  
  // Create a perpendicular offset for the curve
  const dx = toX - fromX;
  const dy = toY - fromY;
  const length = Math.sqrt(dx * dx + dy * dy);
  const perpX = -dy / length;
  const perpY = dx / length;
  const curveOffset = Math.min(length * 0.2, 40) * (c.bend > 0 ? 1 : -1);
  
  const controlX = midX + perpX * curveOffset;
  const controlY = midY + perpY * curveOffset;
  
  const path = `M ${fromX} ${fromY} Q ${controlX} ${controlY} ${toX} ${toY}`;

  return (
    <g style={{ ["--trade-color" as never]: color }}>
      {/* Soft halo */}
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeOpacity="0.25"
        strokeWidth="8"
        strokeLinecap="round"
        filter="url(#trade-callout-glow)"
      />
      {/* Main stroke with arrowhead */}
      <path
        className="trade-arrow-stroke"
        d={path}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        markerEnd="url(#trade-arrowhead)"
        pathLength={1}
      />
      {/* Anchor dot at from ward */}
      <circle cx={fromX} cy={fromY} r={4} fill={color} className="trade-anchor-dot" />
      <circle
        cx={fromX}
        cy={fromY}
        r={8}
        fill="none"
        stroke={color}
        strokeOpacity="0.5"
        strokeWidth="1.5"
        className="trade-anchor-ring"
      />
      {/* Anchor dot at to ward */}
      <circle cx={toX} cy={toY} r={4} fill={color} className="trade-anchor-dot" />
      <circle
        cx={toX}
        cy={toY}
        r={8}
        fill="none"
        stroke={color}
        strokeOpacity="0.5"
        strokeWidth="1.5"
        className="trade-anchor-ring"
      />
    </g>
  );
}

// ---------------------------------------------------------------------------
// Chip
// ---------------------------------------------------------------------------

function TradeChip({ c }: { c: TradeCallout }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const r = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(r);
  }, []);

  const color = "#38bdf8";
  const trade = c.trade;

  return (
    <div
      data-mounted={mounted ? "true" : "false"}
      className="trade-callout-chip pointer-events-none absolute"
      style={{
        transform: `translate3d(${c.panel.x}px, ${c.panel.y}px, 0)`,
        width: CARD_W,
      }}
    >
      <div
        className="trade-callout-chip-inner relative overflow-hidden rounded-[10px] border bg-[color-mix(in_oklch,var(--color-ink-0)_82%,transparent)] backdrop-blur-xl"
        style={{
          borderColor: `color-mix(in oklch, ${color} 40%, var(--color-ink-3))`,
          boxShadow: `0 8px 24px -10px color-mix(in oklch, ${color} 30%, transparent)`,
        }}
      >
        {/* Top accent line */}
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 h-[2px]"
          style={{
            background: `linear-gradient(90deg, ${color} 0%, ${color} 100%)`,
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
            <div className="flex items-baseline gap-1">
              <span className="truncate font-mono text-[9.5px] tabular-nums text-[var(--color-ink-7)]">
                {c.fromWard.id}
              </span>
              <span style={{ color }} className="text-[10px]">
                →
              </span>
              <span className="truncate font-mono text-[9.5px] tabular-nums text-[var(--color-ink-7)]">
                {c.toWard.id}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between font-mono text-[10px] tabular-nums">
              <span style={{ color }}>{trade.mw.toFixed(1)} MW</span>
              <span className="text-[var(--color-ink-5)]">
                ${trade.cost.toFixed(0)}
              </span>
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
  const dx = -60 + a * 120;
  const dy = -40 + b * 80;
  const bend = -1 + ((h >> 11) % 3) * 2; // -1, 1, or 3
  return { dx, dy, bend };
}
