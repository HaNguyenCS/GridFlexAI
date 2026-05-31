// Realtime stream layer.
//
// The application supports two transport modes:
//   1. A real WebSocket (set VITE_STREAM_URL=ws://host:port to enable).
//   2. An in-browser mock simulator that replays a stochastic stream of
//      events against the loaded building set, so the demo works offline.
//
// Both modes emit the same `StreamEvent` shape and route through the same
// reducer — the rest of the app is transport-agnostic.

import type {
  Building,
  ConnectionStatus,
  StreamEvent,
  StreamEventKind,
  StreamSource,
} from "./types";
import { isMockSource } from "./sources";

export interface StreamHandle {
  /** Unsubscribe and close the underlying transport. */
  close: () => void;
  /** Force-emit an event (used by the "Inject" UI button). */
  inject: (e: StreamEvent) => void;
  /** Pause/resume the simulator (no-op for real WS). */
  pause: () => void;
  resume: () => void;
  /** Set the speed multiplier for the mock simulator (no-op for real WS). */
  setSpeed: (multiplier: number) => void;
}

export interface StreamCallbacks {
  onEvent: (e: StreamEvent) => void;
  onStatus: (s: ConnectionStatus) => void;
}

const DEFAULT_URL =
  (import.meta.env.VITE_STREAM_URL as string | undefined) ?? "";

/**
 * Connect to a real WebSocket at the configured URL. Falls back to the
 * mock simulator if no URL is provided or the socket fails to open.
 */
export function connectStream(
  buildings: Building[],
  cb: StreamCallbacks,
  opts?: { url?: string; forceMock?: boolean }
): StreamHandle {
  const url = opts?.url ?? DEFAULT_URL;
  if (opts?.forceMock || !url) {
    return startMockSimulator(buildings, cb);
  }
  return startWebSocket(url, buildings, cb);
}

// ---------------------------------------------------------------------------
// WebSocket transport
// ---------------------------------------------------------------------------

function startWebSocket(
  url: string,
  buildings: Building[],
  cb: StreamCallbacks
): StreamHandle {
  let ws: WebSocket | null = null;
  let closed = false;
  let retry = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let mockFallback: StreamHandle | null = null;

  const open = () => {
    cb.onStatus(retry === 0 ? "connecting" : "reconnecting");
    try {
      ws = new WebSocket(url);
    } catch {
      scheduleRetry();
      return;
    }
    ws.onopen = () => {
      retry = 0;
      cb.onStatus("live");
    };
    ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data);
        const events: StreamEvent[] = Array.isArray(data) ? data : [data];
        for (const e of events) cb.onEvent(e);
      } catch {
        // Drop malformed frames silently — production code would log here.
      }
    };
    ws.onerror = () => {
      cb.onStatus("error");
    };
    ws.onclose = () => {
      if (closed) return;
      scheduleRetry();
    };
  };

  const scheduleRetry = () => {
    if (closed) return;
    cb.onStatus("reconnecting");
    retry += 1;
    if (retry > 4) {
      // Give up on real WS, drop into mock so the demo keeps moving.
      cb.onStatus("offline");
      mockFallback = startMockSimulator(buildings, cb);
      return;
    }
    const delay = Math.min(8000, 600 * 2 ** retry);
    retryTimer = setTimeout(open, delay);
  };

  open();

  return {
    close: () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      ws?.close();
      mockFallback?.close();
    },
    inject: (e) => cb.onEvent(e),
    pause: () => {
      mockFallback?.pause();
    },
    resume: () => {
      mockFallback?.resume();
    },
    setSpeed: (m) => {
      mockFallback?.setSpeed(m);
    },
  };
}

// ---------------------------------------------------------------------------
// Mock simulator — drives a believable event stream offline
// ---------------------------------------------------------------------------

const NOTES_BY_KIND: Record<StreamEventKind, string[]> = {
  highlight: [
    "Sensor reading anomaly",
    "Energy spike detected",
    "HVAC load above baseline",
    "Pedestrian density rising",
    "Wi-Fi mesh saturation",
  ],
  annotate: [
    "Inspection scheduled",
    "Permit issued · facade",
    "Roof survey complete",
    "Heritage flag lifted",
    "BIM sync 2 mins ago",
  ],
  alert: [
    "Smoke alarm tripped",
    "Elevator outage",
    "Power phase imbalance",
    "Security cordon active",
  ],
  clear: [""],
};

const COLORS = ["#5cf2c8", "#7ad4ff", "#ffc66e", "#ff8a8a", "#c89cff"];

function pick<T>(arr: T[], r = Math.random()) {
  return arr[Math.floor(r * arr.length)];
}

function startMockSimulator(
  buildings: Building[],
  cb: StreamCallbacks
): StreamHandle {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let paused = false;
  let closed = false;
  let speed = 1;

  cb.onStatus("connecting");
  setTimeout(() => {
    if (!closed) cb.onStatus("live");
  }, 250);

  const tick = () => {
    if (closed) return;
    if (!paused && buildings.length) {
      const target = pick(buildings);
      const kindRoll = Math.random();
      const kind: StreamEventKind =
        kindRoll < 0.55
          ? "highlight"
          : kindRoll < 0.78
          ? "annotate"
          : kindRoll < 0.94
          ? "alert"
          : "clear";

      const e: StreamEvent = {
        ts: new Date().toISOString(),
        buildingId: target.id,
        kind,
        color:
          kind === "alert"
            ? "#ff6b6b"
            : kind === "annotate"
            ? "#7ad4ff"
            : pick(COLORS),
        note: pick(NOTES_BY_KIND[kind]),
        ttlMs:
          kind === "alert"
            ? 9000
            : kind === "annotate"
            ? 14000
            : 5000 + Math.random() * 3500,
        severity: kind === "alert" ? 0.85 + Math.random() * 0.15 : Math.random() * 0.7,
      };
      cb.onEvent(e);
    }
    const s = speed || 1;
    const next = (280 + Math.random() * 700) / s; // 280–980 ms cadence, scaled by speed
    timer = setTimeout(tick, next);
  };
  timer = setTimeout(tick, 600);

  return {
    close: () => {
      closed = true;
      if (timer) clearTimeout(timer);
    },
    inject: (e) => cb.onEvent(e),
    pause: () => {
      paused = true;
    },
    resume: () => {
      paused = false;
    },
    setSpeed: (m) => {
      speed = m;
    },
  };
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Convert a CSS hex like "#5cf2c8" to an RGBA tuple deck.gl can ingest. */
export function hexToRgba(
  hex: string,
  alpha = 235
): [number, number, number, number] {
  const m = hex.replace("#", "");
  const full =
    m.length === 3
      ? m
          .split("")
          .map((c) => c + c)
          .join("")
      : m;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return [r, g, b, alpha];
}

// ---------------------------------------------------------------------------
// Multi-source manager
// ---------------------------------------------------------------------------
//
// Each enabled StreamSource spawns its own StreamHandle. Events are
// tagged with sourceId before being forwarded to the consumer. Disabling
// a source closes its handle; toggling back on re-opens.

export interface MultiStreamCallbacks {
  onEvent: (e: StreamEvent) => void;
  onSourceStatus: (sourceId: string, status: ConnectionStatus) => void;
}

export interface MultiStreamHandle {
  /** Reconcile to the desired source list. Idempotent. */
  setSources: (sources: StreamSource[]) => void;
  /** Pause every active handle (mock simulators only — WS keeps streaming). */
  pauseAll: () => void;
  resumeAll: () => void;
  /** Synthesize an event into the consumer (used by the manual "Inject" button). */
  inject: (e: StreamEvent) => void;
  /** Tear down every handle and release timers. */
  close: () => void;
  /** Set the speed multiplier for all mock simulators. */
  setSpeed: (multiplier: number) => void;
}

export function createMultiStream(
  buildings: Building[],
  cb: MultiStreamCallbacks
): MultiStreamHandle {
  const handles = new Map<string, StreamHandle>();
  let paused = false;
  const buildingsRef = buildings;
  let closed = false;

  const openSource = (s: StreamSource) => {
    const handle = connectStream(
      buildingsRef,
      {
        onStatus: (status) => cb.onSourceStatus(s.id, status),
        onEvent: (e) =>
          cb.onEvent({
            ...e,
            // Stamp the source id so consumers can group / filter.
            sourceId: e.sourceId ?? s.id,
            // Allow per-source colour to surface for events without one.
            color: e.color ?? s.color,
          }),
      },
      isMockSource(s) ? { forceMock: true } : { url: s.url }
    );
    if (paused) handle.pause();
    handles.set(s.id, handle);
  };

  const closeSource = (id: string) => {
    const h = handles.get(id);
    if (!h) return;
    h.close();
    handles.delete(id);
    cb.onSourceStatus(id, "idle");
  };

  return {
    setSources(next: StreamSource[]) {
      if (closed) return;
      const wantIds = new Set(next.filter((s) => s.enabled).map((s) => s.id));
      // Close removed/disabled.
      for (const id of Array.from(handles.keys())) {
        if (!wantIds.has(id)) closeSource(id);
      }
      // Open new enabled.
      for (const s of next) {
        if (s.enabled && !handles.has(s.id)) openSource(s);
      }
    },
    pauseAll() {
      paused = true;
      for (const h of handles.values()) h.pause();
    },
    resumeAll() {
      paused = false;
      for (const h of handles.values()) h.resume();
    },
    inject(e: StreamEvent) {
      cb.onEvent(e);
    },
    setSpeed(m: number) {
      for (const h of handles.values()) h.setSpeed(m);
    },
    close() {
      closed = true;
      for (const h of handles.values()) h.close();
      handles.clear();
    },
  };
}
