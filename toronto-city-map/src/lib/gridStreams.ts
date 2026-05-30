// useGridStreams — GridFlex-style severity stream for ward zones.
//
// Simulates a live grid that paints each ward with a RAG (Red/Amber/
// Green) severity shade. The stream emits periodic events that target
// random wards; each event carries a severity band (critical → normal)
// that maps to a red / orange / yellow / green fill on the ward polygon.
//
// The hook also surfaces the raw events so the EventFeed can display
// them alongside the building-level stream.

import { useCallback, useEffect, useRef, useState } from "react";
import type { GridSeverity, GridStreamEvent } from "./types";
import type { Ward } from "./wards";
import { hexToRgba } from "./stream";

// ── Severity → colour mapping ────────────────────────────────────────

export const SEVERITY_COLORS: Record<GridSeverity, string> = {
  critical: "#ef4444", // red
  high: "#f97316", // orange
  moderate: "#eab308", // yellow
  normal: "#22c55e", // green
};

export const SEVERITY_LABELS: Record<GridSeverity, string> = {
  critical: "Critical",
  high: "High",
  moderate: "Moderate",
  normal: "Normal",
};

/** Convert severity to an RGBA fill suitable for deck.gl PolygonLayer. */
export function severityToFill(
  severity: GridSeverity,
  alpha = 90
): [number, number, number, number] {
  return hexToRgba(SEVERITY_COLORS[severity], alpha);
}

/** Convert severity to an RGBA outline colour. */
export function severityToOutline(
  severity: GridSeverity,
  alpha = 230
): [number, number, number, number] {
  return hexToRgba(SEVERITY_COLORS[severity], alpha);
}

// ── Metric catalogue for the mock simulator ──────────────────────────

const METRICS: { label: string; severityWeights: Record<GridSeverity, number> }[] = [
  {
    label: "Grid load factor",
    severityWeights: { critical: 0.12, high: 0.25, moderate: 0.38, normal: 0.25 },
  },
  {
    label: "Transformer utilisation",
    severityWeights: { critical: 0.08, high: 0.22, moderate: 0.40, normal: 0.30 },
  },
  {
    label: "Peak demand ratio",
    severityWeights: { critical: 0.15, high: 0.30, moderate: 0.35, normal: 0.20 },
  },
  {
    label: "Voltage stability index",
    severityWeights: { critical: 0.05, high: 0.15, moderate: 0.40, normal: 0.40 },
  },
  {
    label: "Feeder congestion",
    severityWeights: { critical: 0.10, high: 0.28, moderate: 0.37, normal: 0.25 },
  },
  {
    label: "Renewable curtailment",
    severityWeights: { critical: 0.06, high: 0.18, moderate: 0.36, normal: 0.40 },
  },
];

// ── Weighted random helpers ──────────────────────────────────────────

function pickSeverity(weights: Record<GridSeverity, number>): GridSeverity {
  const r = Math.random();
  let acc = 0;
  for (const [sev, w] of Object.entries(weights) as [GridSeverity, number][]) {
    acc += w;
    if (r < acc) return sev;
  }
  return "normal";
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function valueForSeverity(sev: GridSeverity): number {
  switch (sev) {
    case "critical":
      return 85 + Math.random() * 15;
    case "high":
      return 65 + Math.random() * 20;
    case "moderate":
      return 40 + Math.random() * 25;
    case "normal":
      return 10 + Math.random() * 30;
  }
}

// ── Active zone state ────────────────────────────────────────────────

export interface WardGridColor {
  wardId: string;
  severity: GridSeverity;
  fill: [number, number, number, number];
  outline: [number, number, number, number];
  expiresAt: number;
  metric: string;
  value: number;
}

// ── Hook ─────────────────────────────────────────────────────────────

interface UseGridStreamsOptions {
  /** Ward set to stream against. */
  wards: Ward[];
  /** Whether the stream is enabled. Default true. */
  enabled?: boolean;
  /** Emit cadence in ms (randomised ±30%). Default 1800. */
  cadenceMs?: number;
  /** Max events kept in the history buffer. Default 60. */
  historyCap?: number;
}

interface UseGridStreamsResult {
  /** Active ward colour fills — pass to MapView for rendering. */
  wardColors: Map<string, WardGridColor>;
  /** Latest-first event history for the EventFeed. */
  events: GridStreamEvent[];
  /** Whether the stream is currently live. */
  isLive: boolean;
  /** Pause/resume toggle. */
  paused: boolean;
  togglePause: () => void;
}

export function useGridStreams({
  wards,
  enabled = true,
  cadenceMs = 1800,
  historyCap = 60,
}: UseGridStreamsOptions): UseGridStreamsResult {
  const [wardColors, setWardColors] = useState<Map<string, WardGridColor>>(
    () => new Map()
  );
  const [events, setEvents] = useState<GridStreamEvent[]>([]);
  const [isLive, setIsLive] = useState(false);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pruneRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const togglePause = useCallback(() => {
    setPaused((p) => {
      pausedRef.current = !p;
      return !p;
    });
  }, []);

  // Emit a single grid event.
  const emit = useCallback(() => {
    if (!wards.length || pausedRef.current) return;

    const ward = pick(wards);
    const metric = pick(METRICS);
    const severity = pickSeverity(metric.severityWeights);
    const value = valueForSeverity(severity);
    const ttlMs = severity === "critical" ? 12000 : severity === "high" ? 10000 : 8000;

    const evt: GridStreamEvent = {
      ts: new Date().toISOString(),
      wardId: ward.id,
      severity,
      color: SEVERITY_COLORS[severity],
      metric: metric.label,
      value: Math.round(value * 10) / 10,
      ttlMs,
    };

    const now = Date.now();

    setWardColors((prev) => {
      const next = new Map(prev);
      next.set(ward.id, {
        wardId: ward.id,
        severity,
        fill: severityToFill(severity),
        outline: severityToOutline(severity),
        expiresAt: now + ttlMs,
        metric: metric.label,
        value: Math.round(value * 10) / 10,
      });
      return next;
    });

    setEvents((prev) => {
      const next = [evt, ...prev];
      return next.length > historyCap ? next.slice(0, historyCap) : next;
    });
  }, [wards, historyCap]);

  // Start/stop the stream.
  useEffect(() => {
    if (!enabled || wards.length === 0) {
      setIsLive(false);
      return;
    }

    setIsLive(true);

    const tick = () => {
      emit();
      const jitter = 0.7 + Math.random() * 0.6; // ±30 %
      timerRef.current = setTimeout(tick, cadenceMs * jitter);
    };

    timerRef.current = setTimeout(tick, 400);

    // Prune expired ward colours every 500 ms.
    pruneRef.current = setInterval(() => {
      const now = Date.now();
      setWardColors((prev) => {
        let changed = false;
        const next = new Map(prev);
        for (const [id, wc] of next) {
          if (wc.expiresAt <= now) {
            next.delete(id);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 500);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (pruneRef.current) clearInterval(pruneRef.current);
      setIsLive(false);
    };
  }, [enabled, wards, cadenceMs, emit]);

  return { wardColors, events, isLive, paused, togglePause };
}
