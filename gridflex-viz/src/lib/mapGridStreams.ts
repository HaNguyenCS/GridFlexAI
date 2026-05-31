// useGridStreams — GridFlex-style severity stream for ward zones.

import { useCallback, useEffect, useRef, useState } from "react";
import type { GridSeverity, GridStreamEvent, WardGridColor } from "./mapTypes";
import type { Ward } from "./mapTypes";
import { hexToRgba } from "./stream";

export const SEVERITY_COLORS: Record<GridSeverity, string> = {
  critical: "#ef4444",
  high: "#f97316",
  moderate: "#eab308",
  normal: "#22c55e",
};

export function severityToFill(
  severity: GridSeverity,
  alpha = 90
): [number, number, number, number] {
  return hexToRgba(SEVERITY_COLORS[severity], alpha);
}

export function severityToOutline(
  severity: GridSeverity,
  alpha = 230
): [number, number, number, number] {
  return hexToRgba(SEVERITY_COLORS[severity], alpha);
}

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
];

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

interface UseGridStreamsOptions {
  wards: Ward[];
  enabled?: boolean;
  cadenceMs?: number;
  historyCap?: number;
  speed?: number;
}

interface UseGridStreamsResult {
  wardColors: Map<string, WardGridColor>;
  events: GridStreamEvent[];
  isLive: boolean;
  paused: boolean;
  togglePause: () => void;
}

export function useGridStreams({
  wards,
  enabled = true,
  cadenceMs = 1800,
  historyCap = 60,
  speed = 1,
}: UseGridStreamsOptions): UseGridStreamsResult {
  const [wardColors, setWardColors] = useState<Map<string, WardGridColor>>(
    () => new Map()
  );
  const [events, setEvents] = useState<GridStreamEvent[]>([]);
  const [isLive, setIsLive] = useState(false);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pruneRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const togglePause = useCallback(() => {
    setPaused((p) => {
      pausedRef.current = !p;
      return !p;
    });
  }, []);

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

  useEffect(() => {
    if (!enabled || wards.length === 0) {
      setIsLive(false);
      return;
    }

    setIsLive(true);

    const tick = () => {
      emit();
      const jitter = 0.7 + Math.random() * 0.6;
      const s = speedRef.current || 1;
      timerRef.current = setTimeout(tick, (cadenceMs * jitter) / s);
    };

    timerRef.current = setTimeout(tick, 400);

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
