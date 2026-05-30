// MapView — MapLibre GL base map + deck.gl 3D building overlay.
//
// Why this shape:
//   - We use react-map-gl's MapLibre adapter for the base map and pass
//     the deck.gl PolygonLayer through DeckGL as an overlay. This is the
//     same architecture kepler.gl uses internally (deck.gl over a
//     Mapbox/MapLibre canvas).
//   - The PolygonLayer is "extruded" so footprints become 3D buildings
//     with proper depth, lighting, and per-building colour accessors
//     wired to the live overlay state.
//   - We bump `data` identity (via a wrapper object that includes
//     `OverlayState.version`) on every overlay change so deck.gl's
//     dirty-checking re-runs the colour accessors without rebuilding
//     geometry buffers.
//   - The same viewState that drives the canvas also feeds the screen-
//     space AnnotationOverlays sibling, so floating callouts stay
//     glued to their building rooftops as the camera moves.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Map, { type MapRef } from "react-map-gl/maplibre";
import maplibregl from "maplibre-gl";
import DeckGL from "@deck.gl/react";
import { PolygonLayer } from "@deck.gl/layers";
import { LightingEffect, AmbientLight, DirectionalLight } from "@deck.gl/core";
import type { MapViewState, PickingInfo } from "@deck.gl/core";

import type { Building, StreamEventKind } from "../lib/types";
import {
  OverlayState,
  pickFill,
  pickLineColor,
  pickLineWidth,
} from "../lib/overlay";
import { DARK_STYLE_URL } from "../lib/mapStyle";
import { AnnotationOverlays } from "./AnnotationOverlays";
import { indexById } from "../lib/buildings";

const INITIAL_VIEW: MapViewState = {
  longitude: -79.3832,
  latitude: 43.6478,
  zoom: 14.6,
  pitch: 55,
  bearing: -18,
};

const ambient = new AmbientLight({ color: [255, 255, 255], intensity: 1.0 });
const sun = new DirectionalLight({
  color: [255, 244, 224],
  intensity: 1.6,
  direction: [-2, -3, -1],
  _shadow: false,
});
const dusk = new DirectionalLight({
  color: [180, 200, 240],
  intensity: 0.6,
  direction: [3, 2, -1],
});
const lighting = new LightingEffect({ ambient, sun, dusk });

interface Props {
  buildings: Building[];
  overlay: OverlayState;
  /** Bumped externally on every event apply, used as a layer-data version. */
  overlayVersion: number;
  onHoverBuilding?: (b: Building | null) => void;
  focusBuildingId?: string | null;
  enabledKinds: Set<StreamEventKind>;
  enabledSources: Set<string>;
  onFocusBuilding?: (id: string) => void;
}

export function MapView({
  buildings,
  overlay,
  overlayVersion,
  onHoverBuilding,
  focusBuildingId,
  enabledKinds,
  enabledSources,
  onFocusBuilding,
}: Props) {
  const mapRef = useRef<MapRef | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [viewState, setViewState] = useState<MapViewState>(INITIAL_VIEW);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  // Smooth-fly to a focused building.
  useEffect(() => {
    if (!focusBuildingId) return;
    const target = buildings.find((b) => b.id === focusBuildingId);
    if (!target) return;
    const [lng, lat] = centroid(target.contour);
    setViewState((vs) =>
      ({
        ...vs,
        longitude: lng,
        latitude: lat,
        zoom: Math.max(vs.zoom, 16.4),
        transitionDuration: 1200,
      } as MapViewState)
    );
  }, [focusBuildingId, buildings]);

  // Track container size so the WebMercatorViewport used by the
  // AnnotationOverlays sibling matches the deck.gl canvas exactly.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setSize({ w: rect.width, h: rect.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const buildingsById = useMemo(() => indexById(buildings), [buildings]);

  // Filter mask used by deck.gl accessors so disabled layers
  // visually fall back to the base building style instead of the
  // overlay tint. We don't drop the data — only the colour swap.
  const isVisible = (id: string): boolean => {
    const o = overlay.get(id);
    if (!o) return false;
    if (!enabledKinds.has(o.kind)) return false;
    if (o.sourceId && !enabledSources.has(o.sourceId)) return false;
    return true;
  };

  const layers = useMemo(() => {
    return [
      new PolygonLayer<Building>({
        id: "toronto-buildings",
        data: buildings,
        // version-tagged so deck.gl invalidates its colour caches on each
        // overlay mutation without rebuilding the geometry buffers.
        updateTriggers: {
          getFillColor: [overlayVersion, enabledKinds, enabledSources],
          getLineColor: [overlayVersion, hoverId, enabledKinds, enabledSources],
          getLineWidth: [overlayVersion, hoverId, enabledKinds, enabledSources],
        },
        pickable: true,
        stroked: true,
        filled: true,
        extruded: true,
        wireframe: false,
        getPolygon: (b) => (b.holes ? [b.contour, ...b.holes] : b.contour),
        getElevation: (b) => b.height,
        elevationScale: 1,
        getFillColor: (b) =>
          pickFill(b, isVisible(b.id) ? overlay.get(b.id) : undefined),
        getLineColor: (b) =>
          pickLineColor(
            isVisible(b.id) ? overlay.get(b.id) : undefined,
            hoverId === b.id
          ),
        getLineWidth: (b) =>
          pickLineWidth(
            isVisible(b.id) ? overlay.get(b.id) : undefined,
            hoverId === b.id
          ),
        lineWidthUnits: "pixels",
        lineWidthMinPixels: 0.4,
        material: {
          ambient: 0.55,
          diffuse: 0.85,
          shininess: 28,
          specularColor: [180, 220, 240],
        },
        onHover: (info: PickingInfo<Building>) => {
          const next = info.object?.id ?? null;
          if (next !== hoverId) {
            setHoverId(next);
            onHoverBuilding?.(info.object ?? null);
          }
        },
      }),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    buildings,
    overlay,
    overlayVersion,
    hoverId,
    onHoverBuilding,
    enabledKinds,
    enabledSources,
  ]);

  // Filter once for the screen-space callouts.
  const visibleOverlays = useMemo(() => {
    return overlay.entries().filter((o) => {
      if (!enabledKinds.has(o.kind)) return false;
      if (o.sourceId && !enabledSources.has(o.sourceId)) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlay, overlayVersion, enabledKinds, enabledSources]);

  return (
    <div ref={containerRef} className="absolute inset-0">
      <DeckGL
        layers={layers}
        viewState={viewState}
        controller={{ doubleClickZoom: false, inertia: 320 }}
        onViewStateChange={(p) => setViewState(p.viewState as MapViewState)}
        effects={[lighting]}
        getCursor={({ isDragging, isHovering }) =>
          isDragging ? "grabbing" : isHovering ? "pointer" : "grab"
        }
      >
        <Map
          ref={(r) => {
            mapRef.current = r;
          }}
          mapLib={maplibregl}
          mapStyle={DARK_STYLE_URL}
          reuseMaps
          attributionControl={false}
        />
      </DeckGL>

      {/* Ground vignette — anchors the dark scene */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 55%, rgba(7,9,12,0.65) 100%)",
        }}
      />

      <AnnotationOverlays
        width={size.w}
        height={size.h}
        viewState={viewState}
        buildingsById={buildingsById}
        overlays={visibleOverlays}
        enabledKinds={enabledKinds}
        enabledSources={enabledSources}
        onFocus={onFocusBuilding}
      />
    </div>
  );
}

function centroid(ring: [number, number][]): [number, number] {
  let x = 0;
  let y = 0;
  const n = ring.length - 1;
  for (let i = 0; i < n; i++) {
    x += ring[i][0];
    y += ring[i][1];
  }
  return [x / n, y / n];
}
