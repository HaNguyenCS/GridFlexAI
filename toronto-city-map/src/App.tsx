// App — top-level wiring.
//
// Composition:
//   - Loads the Toronto building footprints (procedural fast-path, with a
//     best-effort live fetch from the Open Data CKAN endpoint).
//   - Connects to the realtime stream (WebSocket if VITE_STREAM_URL is set,
//     otherwise the in-browser mock simulator).
//   - Maintains an OverlayState that materialises events into per-building
//     fill/outline/width accessors consumed by the deck.gl PolygonLayer.
//   - Renders the dark ops chrome around the map.

import { useEffect, useMemo, useRef, useState } from "react";

import { MapView } from "./components/MapView";
import { HeaderBar } from "./components/HeaderBar";
import { LegendPanel } from "./components/LegendPanel";
import { EventFeed, type FeedItem } from "./components/EventFeed";

import {
  fetchTorontoBuildings,
  getProceduralToronto,
  indexById,
} from "./lib/buildings";
import { connectStream, type StreamHandle } from "./lib/stream";
import { OverlayState } from "./lib/overlay";
import type {
  Building,
  ConnectionStatus,
  StreamEvent,
} from "./lib/types";

const STREAM_URL =
  (import.meta.env.VITE_STREAM_URL as string | undefined) ?? null;

const FEED_CAP = 80;

export default function App() {
  const [buildings, setBuildings] = useState<Building[]>(() =>
    getProceduralToronto()
  );
  const buildingsById = useMemo(() => indexById(buildings), [buildings]);

  const overlayRef = useRef<OverlayState>(new OverlayState());
  const [overlayVersion, setOverlayVersion] = useState(0);

  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [eventsTotal, setEventsTotal] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState<Building | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);

  const streamRef = useRef<StreamHandle | null>(null);

  // Background: try a live OpenData fetch (best-effort). Procedural data
  // is already on screen, so this is a no-flicker upgrade path.
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

  // Connect the stream once buildings are present.
  useEffect(() => {
    if (buildings.length === 0) return;
    const handle = connectStream(buildings, {
      onStatus: setStatus,
      onEvent: (e) => handleEvent(e),
    });
    streamRef.current = handle;
    return () => {
      handle.close();
      streamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildings.length]);

  // TTL pruner — runs every 500ms.
  useEffect(() => {
    const id = setInterval(() => {
      if (overlayRef.current.tick()) {
        setOverlayVersion(overlayRef.current.version);
      }
    }, 500);
    return () => clearInterval(id);
  }, []);

  function handleEvent(e: StreamEvent) {
    overlayRef.current.apply(e);
    setOverlayVersion(overlayRef.current.version);
    setEventsTotal((n) => n + 1);
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

  const overlaysActive = overlayVersion >= 0 ? overlayRef.current.size() : 0;
  const kindCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const o of overlayRef.current.entries()) {
      out[o.kind] = (out[o.kind] ?? 0) + 1;
    }
    return out;
    // overlayVersion is the explicit dependency that signals overlay churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayVersion]);

  const togglePause = () => {
    setPaused((p) => {
      const next = !p;
      if (next) streamRef.current?.pause();
      else streamRef.current?.resume();
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
    });
  };

  const focusBuilding = (id: string) => {
    setFocusId(id);
    // Reset focus shortly so re-clicking the same row re-triggers the fly-to.
    window.setTimeout(() => setFocusId(null), 200);
  };

  return (
    <div className="relative h-[100dvh] w-screen overflow-hidden bg-[var(--color-ink-0)]">
      <MapView
        buildings={buildings}
        overlay={overlayRef.current}
        overlayVersion={overlayVersion}
        onHoverBuilding={setHovered}
        focusBuildingId={focusId}
      />

      <HeaderBar
        status={status}
        streamUrl={STREAM_URL}
        buildingsLoaded={buildings.length}
        overlaysActive={overlaysActive}
        eventsTotal={eventsTotal}
      />

      <LegendPanel
        kindCounts={kindCounts}
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
    </div>
  );
}
