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

import { MapView, type ColorMode } from "./components/MapView";
import { HeaderBar } from "./components/HeaderBar";
import { LegendPanel } from "./components/LegendPanel";
import { EventFeed, type FeedItem, type GridFeedItem } from "./components/EventFeed";
import { SourcesPanel } from "./components/SourcesPanel";
import { CommandCenter } from "./components/CommandCenter";
import { CommandCenterTrigger } from "./components/CommandCenterTrigger";

import {
  fetchTorontoBuildings,
  indexById,
} from "./lib/buildings";
import {
  fetchEnergyDataset,
  buildEnergyIndex,
  type BuildingEnergy,
  type EnergyDataset,
} from "./lib/energy";
import { createMultiStream, type MultiStreamHandle } from "./lib/stream";
import { loadSources, saveSources } from "./lib/sources";
import { OverlayState } from "./lib/overlay";
import { fetchTorontoWards, type Ward } from "./lib/wards";
import { useGridStreams } from "./lib/gridStreams";
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
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [buildingsLoading, setBuildingsLoading] = useState(true);
  const [buildingsError, setBuildingsError] = useState<string | null>(null);
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
  const [commandOpen, setCommandOpen] = useState(false);

  // ── Energy consumption (City of Toronto open data) ──────────────────
  const [colorMode, setColorMode] = useState<ColorMode>("height");
  const [energyDataset, setEnergyDataset] = useState<EnergyDataset | null>(null);
  const [energyLoading, setEnergyLoading] = useState(false);
  const energyFetchDoneRef = useRef(false);
  const energyById = useMemo<Map<string, BuildingEnergy> | null>(() => {
    if (!energyDataset || buildings.length === 0) return null;
    return buildEnergyIndex(buildings, energyDataset);
  }, [energyDataset, buildings]);
  
  // ── Wards ───────────────────────────────────────────────────────────
  const [wards, setWards] = useState<Ward[]>([]);
  const [showWards, setShowWards] = useState(() => {
    const saved = localStorage.getItem('showWards');
    return saved ? JSON.parse(saved) : true;
  });

  // ── Building opacity ──────────────────────────────────────────────
  const [buildingOpacity, setBuildingOpacity] = useState(() => {
    const saved = localStorage.getItem('buildingOpacity');
    return saved ? Number(JSON.parse(saved)) : 1;
  });

  // ── Panel collapse states ───────────────────────────────────────────
  const [legendCollapsed, setLegendCollapsed] = useState(() => {
    const saved = localStorage.getItem('legendCollapsed');
    return saved ? JSON.parse(saved) : false;
  });
  const [feedCollapsed, setFeedCollapsed] = useState(() => {
    const saved = localStorage.getItem('feedCollapsed');
    return saved ? JSON.parse(saved) : false;
  });

  // ── Grid streams (GridFlex RAG severity on ward zones) ────────────
  // Wired after wards load; the hook internally emits periodic events
  // that paint each ward with red/orange/yellow/green severity shades.
  const gridStreams = useGridStreams({ wards, enabled: wards.length > 0 });
  const gridFeedItems: GridFeedItem[] = useMemo(
    () => gridStreams.events.map((e) => ({ ...e, arrivedAt: new Date(e.ts).getTime() })),
    [gridStreams.events]
  );

  // Persist collapse states and toggle states to localStorage
  useEffect(() => {
    localStorage.setItem('legendCollapsed', JSON.stringify(legendCollapsed));
  }, [legendCollapsed]);

  useEffect(() => {
    localStorage.setItem('feedCollapsed', JSON.stringify(feedCollapsed));
  }, [feedCollapsed]);

  useEffect(() => {
    localStorage.setItem('showWards', JSON.stringify(showWards));
  }, [showWards]);

  useEffect(() => {
    localStorage.setItem('buildingOpacity', JSON.stringify(buildingOpacity));
  }, [buildingOpacity]);

  const streamRef = useRef<MultiStreamHandle | null>(null);

  // Stream rate accounting ─ rolling counts per source for the meters.
  const recentByIdRef = useRef<Map<string, number[]>>(new Map());

  // Foreground: load the real Toronto building outlines. The map
  // shows an explicit loading overlay until this resolves; on hard
  // failure we surface an error label rather than silently swapping
  // in fake geometry.
  useEffect(() => {
    const ac = new AbortController();
    setBuildingsLoading(true);
    setBuildingsError(null);
    fetchTorontoBuildings({ signal: ac.signal })
      .then((next) => {
        if (ac.signal.aborted) return;
        if (next.length > 0) {
          setBuildings(next);
        } else {
          setBuildingsError("No buildings returned from Open Data.");
        }
      })
      .catch((err) => {
        if ((err as { name?: string })?.name === "AbortError") return;
        setBuildingsError(
          (err as Error)?.message ?? "Failed to fetch building outlines."
        );
      })
      .finally(() => {
        if (!ac.signal.aborted) setBuildingsLoading(false);
      });
    return () => ac.abort();
  }, []);

  // Lazy energy fetch — only pull the annual energy consumption dataset
  // when the user switches to the "Energy use" colour mode tab.
  // The fetch runs once; subsequent tab switches reuse the cached result.
  useEffect(() => {
    if (colorMode !== "energy" || energyFetchDoneRef.current) return;
    const ac = new AbortController();
    setEnergyLoading(true);
    fetchEnergyDataset({ signal: ac.signal })
      .then((dataset) => {
        if (dataset) setEnergyDataset(dataset);
      })
      .finally(() => {
        energyFetchDoneRef.current = true;
        setEnergyLoading(false);
      });
    return () => ac.abort();
  }, [colorMode]);

  // Load Toronto ward boundaries.
  useEffect(() => {
    const ac = new AbortController();
    fetchTorontoWards({ signal: ac.signal })
      .then((wards) => {
        if (!ac.signal.aborted && wards.length > 0) setWards(wards);
      })
      .catch(() => {});
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
        colorMode={colorMode}
        energyById={energyById}
        wards={wards}
        showWards={showWards}
        buildingOpacity={buildingOpacity}
        wardGridColors={gridStreams.wardColors}
      />

      <BuildingsLoadingOverlay
        loading={buildingsLoading}
        error={buildingsError}
        loaded={buildings.length}
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
        collapsed={legendCollapsed}
        onToggleCollapse={() => setLegendCollapsed((prev: boolean) => !prev)}
        colorMode={colorMode}
        onColorModeChange={setColorMode}
        energyDataset={energyDataset}
        energyLoading={energyLoading}
        showWards={showWards}
        onToggleWards={() => setShowWards((v: boolean) => !v)}
        wardCount={wards.length}
        buildingOpacity={buildingOpacity}
        onBuildingOpacityChange={setBuildingOpacity}
      />

      <EventFeed
        items={feed}
        paused={paused}
        onTogglePause={togglePause}
        onFocus={focusBuilding}
        onInjectAlert={injectAlert}
        collapsed={feedCollapsed}
        onToggleCollapse={() => setFeedCollapsed((prev: boolean) => !prev)}
        gridItems={gridFeedItems}
      />

      <SourcesPanel
        open={sourcesOpen}
        onClose={() => setSourcesOpen(false)}
        sources={sources}
        onChange={setSources}
        statuses={sourceStatuses}
        rates={sourceRates}
      />

      {/* Command Center trigger — positioned directly under the live
          indicator at the top-right corner of the viewport. */}
      <div className="pointer-events-none absolute right-6 top-[72px] z-20 flex justify-end">
        <div className="pointer-events-auto">
          <CommandCenterTrigger
            onClick={() => setCommandOpen((v) => !v)}
            isActive={commandOpen}
          />
        </div>
      </div>

      <CommandCenter
        open={commandOpen}
        onClose={() => setCommandOpen(false)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Buildings loading overlay
// ---------------------------------------------------------------------------
//
// Sits on top of the empty MapView while the Open Data GeoJSON is
// streaming in. Three states:
//   - loading  : centred glass card with a swirling progress ring.
//   - error    : same card, red accent + retry hint.
//   - resolved : returns null and the deck.gl scene shines through.

function BuildingsLoadingOverlay({
  loading,
  error,
  loaded,
}: {
  loading: boolean;
  error: string | null;
  loaded: number;
}) {
  // Keep the overlay mounted until either a successful load (loaded>0)
  // or an explicit error message is in hand. Avoids a flash-of-empty
  // canvas if the fetch resolves with zero features.
  if (!loading && !error && loaded > 0) return null;

  const isError = !loading && !!error;

  return (
    <div
      className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center"
      role="status"
      aria-live="polite"
    >
      <div
        className="pointer-events-auto flex min-w-[260px] max-w-[360px] flex-col items-center gap-3 rounded-2xl border border-white/10 bg-[rgba(8,12,20,0.72)] px-6 py-5 text-center backdrop-blur-md"
        style={{ boxShadow: "0 18px 48px rgba(0,0,0,0.45)" }}
      >
        {isError ? (
          <div
            className="grid h-9 w-9 place-items-center rounded-full border border-rose-400/40 bg-rose-500/10 text-rose-200"
            aria-hidden="true"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 9v4" />
              <path d="M12 17h.01" />
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
            </svg>
          </div>
        ) : (
          <LoadingRing />
        )}
        <div className="text-[13px] font-medium tracking-[0.02em] text-white/95">
          {isError
            ? "Couldn’t load Toronto building outlines"
            : "Loading Toronto building outlines…"}
        </div>
        <div className="text-[11px] leading-relaxed text-white/55">
          {isError ? (
            <>
              {error}
              <br />
              Try <span className="font-mono text-white/75">npm run prefetch</span> to stage the GeoJSON locally.
            </>
          ) : (
            <>Streaming the live Open Data GeoJSON. The first paint will arrive once the buildings are parsed.</>
          )}
        </div>
      </div>
    </div>
  );
}

function LoadingRing() {
  return (
    <div
      className="relative h-9 w-9"
      aria-hidden="true"
    >
      <div className="absolute inset-0 rounded-full border border-white/10" />
      <div
        className="absolute inset-0 rounded-full border-2 border-transparent"
        style={{
          borderTopColor: "rgb(122, 212, 255)",
          borderRightColor: "rgba(122, 212, 255, 0.35)",
          animation: "buildings-loading-spin 0.9s linear infinite",
        }}
      />
      <style>{`@keyframes buildings-loading-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
