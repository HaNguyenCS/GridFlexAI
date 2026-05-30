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

import { useEffect, useMemo, useRef, useState } from "react";
import Map, { type MapRef } from "react-map-gl/maplibre";
import maplibregl from "maplibre-gl";
import DeckGL from "@deck.gl/react";
import { PolygonLayer } from "@deck.gl/layers";
import { LightingEffect, AmbientLight, DirectionalLight } from "@deck.gl/core";
import type { MapViewState, PickingInfo } from "@deck.gl/core";

import type { Building } from "../lib/types";
import { OverlayState, pickFill, pickLineColor, pickLineWidth } from "../lib/overlay";
import { DARK_STYLE_URL } from "../lib/mapStyle";

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
}

export function MapView({
  buildings,
  overlay,
  overlayVersion,
  onHoverBuilding,
  focusBuildingId,
}: Props) {
  const mapRef = useRef<MapRef | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [viewState, setViewState] = useState<MapViewState>(INITIAL_VIEW);

  // Smooth-fly to a focused building.
  useEffect(() => {
    if (!focusBuildingId) return;
    const target = buildings.find((b) => b.id === focusBuildingId);
    if (!target) return;
    const [lng, lat] = centroid(target.contour);
    setViewState((vs) => ({
      ...vs,
      longitude: lng,
      latitude: lat,
      zoom: Math.max(vs.zoom, 16.4),
      transitionDuration: 1200,
    } as MapViewState));
  }, [focusBuildingId, buildings]);

  const layers = useMemo(() => {
    return [
      new PolygonLayer<Building>({
        id: "toronto-buildings",
        data: buildings,
        // version-tagged so deck.gl invalidates its colour caches on each
        // overlay mutation without rebuilding the geometry buffers.
        updateTriggers: {
          getFillColor: overlayVersion,
          getLineColor: [overlayVersion, hoverId],
          getLineWidth: [overlayVersion, hoverId],
        },
        pickable: true,
        stroked: true,
        filled: true,
        extruded: true,
        wireframe: false,
        getPolygon: (b) => (b.holes ? [b.contour, ...b.holes] : b.contour),
        getElevation: (b) => b.height,
        elevationScale: 1,
        getFillColor: (b) => pickFill(b, overlay.get(b.id)),
        getLineColor: (b) => pickLineColor(overlay.get(b.id), hoverId === b.id),
        getLineWidth: (b) => pickLineWidth(overlay.get(b.id), hoverId === b.id),
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
  }, [buildings, overlay, overlayVersion, hoverId, onHoverBuilding]);

  return (
    <div className="absolute inset-0">
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
