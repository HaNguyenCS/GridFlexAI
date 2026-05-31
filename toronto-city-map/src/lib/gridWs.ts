// useGridWs — connects to the grid simulation server at localhost:3000
// and feeds WebSocket events into the EventFeed as GridStreamEvent items.
//
// The server exposes 4 WS streams per the /health endpoint:
//   /ws/demand  — zone demand metrics
//   /ws/supply  — supply capacity metrics
//   /ws/trades  — inter-zone trade flows
//   /ws/issues  — fault / issue alerts
//
// Each stream emits JSON messages targeting one of 25 wards (ward_01..ward_25).
// We parse each message into a GridStreamEvent so it shows up in the feed
// alongside the locally-simulated grid severity events.

import { useCallback, useEffect, useRef, useState } from "react";
import type { GridSeverity, GridStreamEvent } from "./types";

// ── Stream definitions ────────────────────────────────────────────────────

interface WsStreamDef {
  /** Path segment, e.g. "demand". */
  name: string;
  /** Display label for the metric column. */
  metricLabel: string;
  /** Default severity when the message doesn't carry one. */
  defaultSeverity: GridSeverity;
  /** Brand colour for this stream. */
  color: string;
}

const STREAMS: WsStreamDef[] = [
  { name: "demand",  metricLabel: "Demand",     defaultSeverity: "high",     color: "#f97316" },
  { name: "supply",  metricLabel: "Supply",     defaultSeverity: "moderate", color: "#eab308" },
  { name: "trades",  metricLabel: "Trades",     defaultSeverity: "normal",   color: "#22c55e" },
  { name: "issues",  metricLabel: "Issues",     defaultSeverity: "critical", color: "#ef4444" },
];

const SEVERITY_COLORS: Record<GridSeverity, string> = {
  critical: "#ef4444",
  high: "#f97316",
  moderate: "#eab308",
  normal: "#22c55e",
};

// ── Normalise ward IDs ────────────────────────────────────────────────────
// Server uses "ward_01"; our internal model uses "ward-1" style.
// We try to map both ways so events match existing ward polygons.

function normalizeWardId(raw: string): string {
  // "ward_01" → "ward-1", "ward-12" → "ward-12"
  const m = raw.match(/ward[_-]?(\d+)/i);
  if (m) return `ward-${parseInt(m[1], 10)}`;
  return raw;
}

// ── Parse a raw WS message into a GridStreamEvent ─────────────────────────

function parseMessage(
  data: string,
  stream: WsStreamDef
): GridStreamEvent | null {
  try {
    const msg = JSON.parse(data);

    // Accept both flat objects and { type, payload } wrappers.
    const payload = msg.payload ?? msg;

    // Determine ward id.
    const rawWard =
      payload.ward_id ??
      payload.wardId ??
      payload.zone_id ??
      payload.zoneId ??
      payload.ward ??
      null;
    if (!rawWard) return null;

    const wardId = normalizeWardId(String(rawWard));

    // Determine value (numeric metric).
    const value =
      typeof payload.value === "number"
        ? payload.value
        : typeof payload.amount === "number"
        ? payload.amount
        : typeof payload.load === "number"
        ? payload.load
        : Math.round(Math.random() * 80 + 10);

    // Determine severity.
    const sevRaw =
      (payload.severity as string | undefined) ??
      (payload.level as string | undefined) ??
      (payload.status as string | undefined) ??
      null;
    const severity: GridSeverity =
      sevRaw && ["critical", "high", "moderate", "normal"].includes(sevRaw.toLowerCase())
        ? (sevRaw.toLowerCase() as GridSeverity)
        : stream.defaultSeverity;

    const color = SEVERITY_COLORS[severity];
    const metric =
      (payload.metric as string | undefined) ??
      (payload.label as string | undefined) ??
      stream.metricLabel;

    const ts =
      (payload.ts as string | undefined) ??
      (payload.timestamp as string | undefined) ??
      new Date().toISOString();

    const ttlMs = severity === "critical" ? 12000 : severity === "high" ? 10000 : 8000;

    return { ts, wardId, severity, color, metric, value, ttlMs };
  } catch {
    return null;
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────

interface UseGridWsOptions {
  /** Base HTTP URL of the grid server (default http://localhost:3000). */
  baseUrl?: string;
  /** Whether to enable connections. Default true. */
  enabled?: boolean;
  /** Max events kept in history. Default 80. */
  historyCap?: number;
}

export type GridWsStatus = "disconnected" | "connecting" | "live" | "error";

interface UseGridWsResult {
  /** Parsed grid events ready for the EventFeed. */
  events: GridStreamEvent[];
  /** Per-stream connection status. */
  streamStatuses: Record<string, GridWsStatus>;
  /** Aggregate status (worst of all streams). */
  status: GridWsStatus;
  /** Total events received across all streams. */
  totalReceived: number;
}

const MAX_RETRY = 5;
const BASE_DELAY_MS = 1500;

export function useGridWs({
  baseUrl = "http://localhost:3000",
  enabled = true,
  historyCap = 80,
}: UseGridWsOptions = {}): UseGridWsResult {
  const [events, setEvents] = useState<GridStreamEvent[]>([]);
  const [streamStatuses, setStreamStatuses] = useState<Record<string, GridWsStatus>>({});
  const [totalReceived, setTotalReceived] = useState(0);
  const socketsRef = useRef<Map<string, WebSocket>>(new Map());
  const retryTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const retryCountRef = useRef<Map<string, number>>(new Map());
  const closedRef = useRef(false);

  const setStatus = useCallback((name: string, s: GridWsStatus) => {
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

      const wsUrl = baseUrl.replace(/^http/, "ws") + `/ws/${stream.name}`;
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
      // Close all sockets.
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
  const status: GridWsStatus = (() => {
    const vals = Object.values(streamStatuses);
    if (vals.length === 0) return "disconnected";
    if (vals.some((s) => s === "live")) return "live";
    if (vals.some((s) => s === "connecting")) return "connecting";
    if (vals.some((s) => s === "error")) return "error";
    return "disconnected";
  })();

  return { events, streamStatuses, status, totalReceived };
}
