// App — top-level wiring.
//
// Composition:
//   - Loads the Toronto building footprints (procedural fast-path, with a
//     best-effort live fetch from the Open Data CKAN endpoint).
//   - Manages a list of stream sources (the plugin endpoints) via the
//     SourcesPanel and persists them through `loadSources/saveSources`.
//   - Spawns one transport per enabled source through the multi-stream
//     manager; per-source status flows back into the panel.
//   - Tracks two enable/disable axes for annotation rendering:
//       * `enabledKinds`  — by event kind (Highlight / Annotate / Alert)
//       * `enabledSources` — by streaming endpoint
//     Both are surfaced in the dynamic LegendPanel.
//   - Renders the screen-space callouts inside MapView so they share
//     the same viewState used by the deck.gl canvas.

import { useEffect, useMemo, useRef, useState } from "react";

import { MapView } from "./components/MapView";
import { HeaderBar } from "./components/HeaderBar";
import { LegendPanel } from "./components/LegendPanel";
import { EventFeed, type FeedItem } from "./components/EventFeed";
import { SourcesPanel } from "./components/SourcesPanel";

import {
  fetchTorontoBuildings,
  getProceduralToronto,
  indexById,
} from "./lib/buildings";
import { createMultiStream, type MultiStreamHandle } from "./lib/stream";
import { loadSources, saveSources } from "./lib/sources";
import { OverlayState } from "./lib/overlay";
import type {
  Building,
  ConnectionStatus,
  StreamEvent,
  StreamEventKind,
  StreamSource,
} from "./lib/types";

const FEED_CAP = 80;

const ALL_KINDS: StreamEventKind[] = ["highlight", "annotate", "alert"];

export default function App() {
  // ── Buildings ───────────────────────────────────────────────────────
  const [buildings, setBuildings] = useState<Building[]>(() =>
    getProceduralToronto()
  );
  const buildingsById = useMemo(() => indexById(buildings), [buildings]);

  // ── Overlay reducer ─────────────────────────────────────────────────
  const overlayRef = useRef<OverlayState>(new OverlayState());
  const [overlayVersion, setOverlayVersion] = useState(0);

  // ── Sources (plugin registry) ───────────────────────────────────────
  const [sources, setSources] = useState<StreamSource[]>(() => loadSources());
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [sourceStatuses, setSourceStatuses] = useState<
    Record<string, ConnectionStatus>
  >({});
  const [, setSourceCounts] = useState<Record<string, number>>({});
  const [sourceRates, setSourceRates] = useState<Record<string, number>>({});

  // ── Layer visibility ────────────────────────────────────────────────
  const [enabledKinds, setEnabledKinds] = useState<Set<StreamEventKind>>(
    () => new Set(ALL_KINDS)
  );
  const [enabledSources, setEnabledSources] = useState<Set<string>>(() => {
    return new Set(sources.filter((s) => s.enabled).map((s) => s.id));
  });
  const [seenKinds, setSeenKinds] = useState<Set<StreamEventKind>>(new Set());

  // Monotonic clock used by AnnotationOverlays to recompute TTL bars
  // without invalidating deck.gl's per-building colour caches.
  const [, setTickClock] = useState(0);

  // ── Misc UI ─────────────────────────────────────────────────────────
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [eventsTotal, setEventsTotal] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState<Building | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);

  const streamRef = useRef<MultiStreamHandle | null>(null);

  // Stream rate accounting ─ rolling counts per source for the meters.
  const recentByIdRef = useRef<Map<string, number[]>>(new Map());

  // Background: try a live OpenData fetch (best-effort).
  useEffect(() => {
    const ac = new AbortController();
    fetchTorontoBuildings({ signal: ac.signal })
      .then((next) => {
        if (next.length > 0) setBuildings(next);
      })
      .catch(() => {
        /* fallback already in place */
      });
    return () => ac.abort();
  }, []);

  // Boot the multi-source stream manager once buildings are present.
  useEffect(() => {
    if (buildings.length === 0) return;
    const handle = createMultiStream(buildings, {
      onEvent: handleEvent,
      onSourceStatus: (sourceId, status) => {
        setSourceStatuses((prev) => ({ ...prev, [sourceId]: status }));
      },
    });
    streamRef.current = handle;
    handle.setSources(sources);
    return () => {
      handle.close();
      streamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildings.length]);

  // Reconcile the manager whenever the source list changes.
  useEffect(() => {
    streamRef.current?.setSources(sources);
    saveSources(sources);
  }, [sources]);

  // Keep enabledSources in step with newly-added/removed sources, and
  // keep at least the enabled ones visible by default.
  useEffect(() => {
    setEnabledSources((prev) => {
      const next = new Set(prev);
      const validIds = new Set(sources.map((s) => s.id));
      for (const id of Array.from(next)) {
        if (!validIds.has(id)) next.delete(id);
      }
      for (const s of sources) {
        if (s.enabled && !next.has(s.id)) next.add(s.id);
      }
      return next;
    });
  }, [sources]);

  // Recompute per-source rate (events/sec) every second.
  useEffect(() => {
    const id = setInterval(() => {
      const cutoff = Date.now() - 5000;
      const next: Record<string, number> = {};
      for (const [sid, list] of recentByIdRef.current) {
        const fresh = list.filter((t) => t > cutoff);
        recentByIdRef.current.set(sid, fresh);
        next[sid] = fresh.length / 5;
      }
      setSourceRates(next);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // TTL pruner — runs every 500ms.
  useEffect(() => {
    const id = setInterval(() => {
      if (overlayRef.current.tick()) {
        setOverlayVersion(overlayRef.current.version);
      }
      // Cheap clock pulse so callouts redraw their TTL bars without
      // forcing the deck.gl polygon layer to recompute its accessors.
      if (overlayRef.current.size() > 0) {
        setTickClock((t) => (t + 1) % 1_000_000);
      }
    }, 500);
    return () => clearInterval(id);
  }, []);

  function handleEvent(e: StreamEvent) {
    overlayRef.current.apply(e);
    setOverlayVersion(overlayRef.current.version);
    setEventsTotal((n) => n + 1);
    // seen-kinds bookkeeping for the dynamic legend.
    if (e.kind !== "clear") {
      setSeenKinds((prev) => {
        if (prev.has(e.kind)) return prev;
        const next = new Set(prev);
        next.add(e.kind);
        return next;
      });
    }
    // Per-source counters and rate samples.
    if (e.sourceId) {
      const sid = e.sourceId;
      setSourceCounts((prev) => ({ ...prev, [sid]: (prev[sid] ?? 0) + 1 }));
      const list = recentByIdRef.current.get(sid) ?? [];
      list.push(Date.now());
      recentByIdRef.current.set(sid, list);
    }
    setFeed((prev) => {
      const item: FeedItem = {
        ...e,
        buildingLabel: buildingsById.get(e.buildingId)?.label,
        arrivedAt: Date.now(),
      };
      const next = [item, ...prev];
      return next.length > FEED_CAP ? next.slice(0, FEED_CAP) : next;
    });
  }

  // ── Derived UI counts ───────────────────────────────────────────────
  const overlaysActive = overlayVersion >= 0 ? overlayRef.current.size() : 0;
  const kindCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const o of overlayRef.current.entries()) {
      out[o.kind] = (out[o.kind] ?? 0) + 1;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayVersion]);

  const sourceLiveCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const o of overlayRef.current.entries()) {
      if (o.sourceId) out[o.sourceId] = (out[o.sourceId] ?? 0) + 1;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayVersion]);

  // Derive a "headline" connection status for the header pill —
  // any-source-live → live, else worst non-idle, else idle.
  const headlineStatus: ConnectionStatus = useMemo(() => {
    const enabledStatuses = sources
      .filter((s) => s.enabled)
      .map((s) => sourceStatuses[s.id] ?? "idle");
    if (enabledStatuses.length === 0) return "idle";
    if (enabledStatuses.some((s) => s === "live")) return "live";
    if (enabledStatuses.some((s) => s === "error")) return "error";
    if (
      enabledStatuses.some((s) => s === "connecting" || s === "reconnecting")
    ) {
      return "reconnecting";
    }
    if (enabledStatuses.some((s) => s === "offline")) return "offline";
    return "idle";
  }, [sourceStatuses, sources]);

  // ── Handlers ────────────────────────────────────────────────────────
  const togglePause = () => {
    setPaused((p) => {
      const next = !p;
      if (next) streamRef.current?.pauseAll();
      else streamRef.current?.resumeAll();
      return next;
    });
  };

  const injectAlert = () => {
    const target = buildings[Math.floor(Math.random() * buildings.length)];
    streamRef.current?.inject({
      ts: new Date().toISOString(),
      buildingId: target.id,
      kind: "alert",
      color: "#ff6b6b",
      note: "Manual probe · field team dispatched",
      severity: 0.95,
      ttlMs: 14000,
      sourceId: "manual",
    });
  };

  const focusBuilding = (id: string) => {
    setFocusId(id);
    window.setTimeout(() => setFocusId(null), 200);
  };

  const toggleKind = (kind: StreamEventKind) => {
    setEnabledKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  };

  const toggleSourceVisibility = (id: string) => {
    setEnabledSources((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const sourcesEnabledCount = sources.filter((s) => s.enabled).length;

  return (
    <div className="relative h-[100dvh] w-screen overflow-hidden bg-[var(--color-ink-0)]">
      <MapView
        buildings={buildings}
        overlay={overlayRef.current}
        overlayVersion={overlayVersion}
        onHoverBuilding={setHovered}
        focusBuildingId={focusId}
        enabledKinds={enabledKinds}
        enabledSources={enabledSources}
        onFocusBuilding={focusBuilding}
      />

      <HeaderBar
        status={headlineStatus}
        streamUrl={null}
        buildingsLoaded={buildings.length}
        overlaysActive={overlaysActive}
        eventsTotal={eventsTotal}
        sourcesEnabled={sourcesEnabledCount}
        sourcesTotal={sources.length}
        onOpenSources={() => setSourcesOpen(true)}
      />

      <LegendPanel
        kindCounts={kindCounts}
        sourceCounts={sourceLiveCounts}
        enabledKinds={enabledKinds}
        enabledSources={enabledSources}
        onToggleKind={toggleKind}
        onToggleSource={toggleSourceVisibility}
        sources={sources}
        seenKinds={seenKinds}
        hoveredLabel={hovered?.label ?? hovered?.id ?? null}
        hoveredHeight={hovered?.height ?? null}
        hoveredCategory={hovered?.category ?? null}
      />

      <EventFeed
        items={feed}
        paused={paused}
        onTogglePause={togglePause}
        onFocus={focusBuilding}
        onInjectAlert={injectAlert}
      />

      <SourcesPanel
        open={sourcesOpen}
        onClose={() => setSourcesOpen(false)}
        sources={sources}
        onChange={setSources}
        statuses={sourceStatuses}
        rates={sourceRates}
      />
    </div>
  );
}
