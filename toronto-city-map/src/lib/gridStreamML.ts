// useGridStreamML — ML-based ward stress predictions from GridFlex API.
//
// Connects to WebSocket endpoints at localhost:8080:
//   /demo/stress  — stress prediction metrics
//   /demo/ward    — ward-specific predictions
//
// Parses incoming messages and converts them to GridStreamEvent items
// for display in the EventFeed alongside other grid sources.

import { useCallback, useEffect, useRef, useState } from "react";
import type { GridSeverity, GridStreamEvent } from "./types";

// ── Stream definitions ────────────────────────────────────────────────────

interface WsStreamDef {
  name: string;
  metricLabel: string;
  defaultSeverity: GridSeverity;
  color: string;
}

const STREAMS: WsStreamDef[] = [
  { name: "stress", metricLabel: "Stress Index", defaultSeverity: "moderate", color: "#f97316" },
  { name: "ward",   metricLabel: "Ward Predictions", defaultSeverity: "normal", color: "#22c55e" },
];

const SEVERITY_COLORS: Record<GridSeverity, string> = {
  critical: "#ef4444",
  high: "#f97316",
  moderate: "#eab308",
  normal: "#22c55e",
};

// ── Parse a raw WS message into a GridStreamEvent ─────────────────────────

function parseMessage(
  data: string,
  stream: WsStreamDef
): GridStreamEvent | null {
  try {
    const msg = typeof data === "string" ? JSON.parse(data) : data;

    // Handle both flat objects and { type, payload } wrappers.
    const payload = msg.payload ?? msg;

    // Determine ward id - try multiple field names.
    const rawWard =
      payload.ward_id ??
      payload.wardId ??
      payload.zone_id ??
      payload.zoneId ??
      payload.ward ??
      null;

    // For stress stream, we may not have a ward - use a default or skip.
    if (!rawWard && stream.name === "stress") {
      // Stress stream may emit global metrics without ward - create synthetic ward
      return createStressEvent(payload, stream);
    }

    if (!rawWard) return null;

    const wardId = normalizeWardId(String(rawWard));

    // Determine value (numeric metric).
    const value =
      typeof payload.value === "number"
        ? payload.value
        : typeof payload.amount === "number"
        ? payload.amount
        : typeof payload.score === "number"
        ? payload.score
        : typeof payload.stress === "number"
        ? payload.stress
        : typeof payload.prediction === "number"
        ? payload.prediction
        : Math.round(Math.random() * 100);

    // Determine severity from value or explicit field.
    const sevRaw =
      (payload.severity as string | undefined) ??
      (payload.level as string | undefined) ??
      (payload.status as string | undefined) ??
      null;

    let severity: GridSeverity;
    if (sevRaw && ["critical", "high", "moderate", "normal"].includes(sevRaw.toLowerCase())) {
      severity = sevRaw.toLowerCase() as GridSeverity;
    } else {
      severity = valueToSeverity(value);
    }

    const color = SEVERITY_COLORS[severity];
    const metric =
      (payload.metric as string | undefined) ??
      (payload.label as string | undefined) ??
      (payload.name as string | undefined) ??
      stream.metricLabel;

    const ts =
      (payload.ts as string | undefined) ??
      (payload.timestamp as string | undefined) ??
      (payload.time as string | undefined) ??
      new Date().toISOString();

    const ttlMs = severity === "critical" ? 12000 : severity === "high" ? 10000 : 8000;

    return { ts, wardId, severity, color, metric, value, ttlMs };
  } catch {
    return null;
  }
}

function createStressEvent(
  payload: any,
  stream: WsStreamDef
): GridStreamEvent | null {
  const value =
    typeof payload.value === "number"
      ? payload.value
      : typeof payload.stress === "number"
      ? payload.stress
      : typeof payload.score === "number"
      ? payload.score
      : typeof payload.ontario_demand_mw === "number"
      ? payload.ontario_demand_mw / 1000
      : Math.round(Math.random() * 100);

  const severity = valueToSeverity(value);
  const color = SEVERITY_COLORS[severity];

  const ts =
    (payload.ts as string | undefined) ??
    (payload.timestamp as string | undefined) ??
    new Date().toISOString();

  // Use a synthetic ward for global stress metrics
  const wardId = "ward-stress-global";

  const ttlMs = severity === "critical" ? 12000 : severity === "high" ? 10000 : 8000;

  return {
    ts,
    wardId,
    severity,
    color,
    metric: stream.metricLabel,
    value: Math.round(value * 10) / 10,
    ttlMs,
  };
}

function valueToSeverity(value: number): GridSeverity {
  if (value >= 80) return "critical";
  if (value >= 60) return "high";
  if (value >= 40) return "moderate";
  return "normal";
}

function normalizeWardId(raw: string): string {
  // "ward_01" → "ward-1", "ward-12" → "ward-12"
  const m = raw.match(/ward[_-]?(\d+)/i);
  if (m) return `ward-${parseInt(m[1], 10)}`;
  return raw;
}

// ── Hook ──────────────────────────────────────────────────────────────────

interface UseGridStreamMLOptions {
  /** Base URL of the ML prediction server. Default http://localhost:8080. */
  baseUrl?: string;
  /** Whether to enable connections. Default true. */
  enabled?: boolean;
  /** Max events kept in history. Default 80. */
  historyCap?: number;
}

export interface UseGridStreamMLResult {
  events: GridStreamEvent[];
  status: "disconnected" | "connecting" | "live" | "error";
  totalReceived: number;
}

const MAX_RETRY = 5;
const BASE_DELAY_MS = 1500;

export function useGridStreamML({
  baseUrl = "http://localhost:8080",
  enabled = true,
  historyCap = 80,
}: UseGridStreamMLOptions = {}): UseGridStreamMLResult {
  const [events, setEvents] = useState<GridStreamEvent[]>([]);
  const [streamStatuses, setStreamStatuses] = useState<Record<string, "disconnected" | "connecting" | "live" | "error">>({});
  const [totalReceived, setTotalReceived] = useState(0);
  const socketsRef = useRef<Map<string, WebSocket>>(new Map());
  const retryTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const retryCountRef = useRef<Map<string, number>>(new Map());
  const closedRef = useRef(false);

  const setStatus = useCallback((name: string, s: "disconnected" | "connecting" | "live" | "error") => {
    setStreamStatuses((prev) => ({ ...prev, [name]: s }));
  }, []);

  const pushEvent = useCallback(
    (evt: GridStreamEvent) => {
      setEvents((prev) => {
        const next = [evt, ...prev];
        return next.length > historyCap ? next.slice(0, historyCap) : next;
      });
      setTotalReceived((n) => n + 1);
    },
    [historyCap]
  );

  const connectStream = useCallback(
    (stream: WsStreamDef) => {
      if (closedRef.current) return;

      // Convert HTTP to WS URL
      const wsUrl = baseUrl.replace(/^http/, "ws") + `/demo/${stream.name}`;
      setStatus(stream.name, "connecting");

      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl);
      } catch {
        setStatus(stream.name, "error");
        scheduleRetry(stream);
        return;
      }

      socketsRef.current.set(stream.name, ws);

      ws.onopen = () => {
        retryCountRef.current.set(stream.name, 0);
        setStatus(stream.name, "live");
      };

      ws.onmessage = (msg) => {
        const evt = parseMessage(msg.data, stream);
        if (evt) pushEvent(evt);
      };

      ws.onerror = () => {
        setStatus(stream.name, "error");
      };

      ws.onclose = () => {
        socketsRef.current.delete(stream.name);
        if (!closedRef.current) scheduleRetry(stream);
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [baseUrl, setStatus, pushEvent]
  );

  const scheduleRetry = useCallback(
    (stream: WsStreamDef) => {
      if (closedRef.current) return;
      const count = retryCountRef.current.get(stream.name) ?? 0;
      if (count >= MAX_RETRY) {
        setStatus(stream.name, "error");
        return;
      }
      retryCountRef.current.set(stream.name, count + 1);
      setStatus(stream.name, "connecting");
      const delay = Math.min(15000, BASE_DELAY_MS * 2 ** count);
      const timer = setTimeout(() => connectStream(stream), delay);
      retryTimersRef.current.set(stream.name, timer);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [connectStream, setStatus]
  );

  // Connect/disconnect on enable toggle.
  useEffect(() => {
    if (!enabled) {
      closedRef.current = true;
      for (const ws of socketsRef.current.values()) ws.close();
      socketsRef.current.clear();
      for (const t of retryTimersRef.current.values()) clearTimeout(t);
      retryTimersRef.current.clear();
      return;
    }

    closedRef.current = false;
    for (const stream of STREAMS) {
      connectStream(stream);
    }

    return () => {
      closedRef.current = true;
      for (const ws of socketsRef.current.values()) ws.close();
      socketsRef.current.clear();
      for (const t of retryTimersRef.current.values()) clearTimeout(t);
      retryTimersRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, baseUrl]);

  // Derive aggregate status.
  const status: "disconnected" | "connecting" | "live" | "error" = (() => {
    const vals = Object.values(streamStatuses);
    if (vals.length === 0) return "disconnected";
    if (vals.some((s) => s === "live")) return "live";
    if (vals.some((s) => s === "connecting")) return "connecting";
    if (vals.some((s) => s === "error")) return "error";
    return "disconnected";
  })();

  return { events, status, totalReceived };
}
