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

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Map, { type MapRef } from "react-map-gl/maplibre";
import maplibregl from "maplibre-gl";
import DeckGL from "@deck.gl/react";
import { PolygonLayer, PathLayer } from "@deck.gl/layers";
import { LightingEffect, AmbientLight, DirectionalLight } from "@deck.gl/core";
import type { MapViewState, PickingInfo } from "@deck.gl/core";

import type { Building, StreamEventKind, GridSeverity } from "../lib/types";
import {
  OverlayState,
  pickFill,
  pickLineColor,
  pickLineWidth,
} from "../lib/overlay";
import { DARK_STYLE_URL } from "../lib/mapStyle";
import { AnnotationOverlays } from "./AnnotationOverlays";
import { WardAnnotationOverlays } from "./WardAnnotationOverlays";
import { EnergyInfoPanel } from "./EnergyInfoPanel";
import { indexById } from "../lib/buildings";
import { energyToColor, type BuildingEnergy, type EnergyGeoFeature } from "../lib/energy";
import { type Ward } from "../lib/wards";
import {
  pickWardLineWidth,
} from "../lib/wardOverlay";
import { severityToFill, severityToOutline, type WardGridColor } from "../lib/gridStreams";
export type ColorMode = "height" | "energy";

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

/** Static material — hoisted so it never triggers deck.gl diffing. */
const BUILDING_MATERIAL = {
  ambient: 0.55,
  diffuse: 0.85,
  shininess: 28,
  specularColor: [180, 220, 240] as [number, number, number],
};

/**
 * Precompute polygon geometry once per building so the deck.gl
 * `getPolygon` accessor returns a stable reference instead of
 * allocating a new array on every invocation.
 */
function attachPolygonData(buildings: Building[]): void {
  for (const b of buildings) {
    if ((b as any).__polyData) continue; // already attached
    (b as any).__polyData = b.holes ? [b.contour, ...b.holes] : b.contour;
  }
}

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
  /** Active fill colour mode. "height" is the historical default. */
  colorMode: ColorMode;
  /** Height palette ID for 3-stop color gradient. */
  heightPaletteId?: string;
  /** Per-building energy estimates (from XLSX dataset). */
  energyById?: Map<string, BuildingEnergy> | null;
  /** Per-building real metered energy data (from geojson). */
  energyMatchById?: Map<string, EnergyGeoFeature> | null;
  /** Toronto ward boundaries. */
  wards: Ward[];
  /** Whether to render ward boundaries on the map. */
  showWards: boolean;
  /** Global opacity multiplier for building fills (0–1). */
  buildingOpacity: number;
  /** Grid stream ward colour fills (RAG severity shades). */
  wardGridColors?: Map<string, WardGridColor>;
  /** Severities currently visible in the legend. */
  enabledSeverities?: Set<GridSeverity>;
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
  colorMode,
  heightPaletteId,
  energyById,
  energyMatchById,
  wards,
  showWards,
  buildingOpacity,
  wardGridColors,
  enabledSeverities,
}: Props) {
  const mapRef = useRef<MapRef | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  // Ref mirror so accessors read the latest hover without the layer
  // useMemo depending on hoverId (which would rebuild geometry buffers).
  const hoverIdRef = useRef<string | null>(null);
  hoverIdRef.current = hoverId;
  const [selectedId, setSelectedId] = useState<string | null>(null);
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

  // Precompute polygon data whenever the buildings array changes.
  useMemo(() => attachPolygonData(buildings), [buildings]);

  // Stable hash strings for Set-based triggers — avoids re-triggering
  // deck.gl accessors when the Set identity changes but content doesn't.
  const kindsSig = useMemo(
    () => Array.from(enabledKinds).sort().join(","),
    [enabledKinds]
  );
  const sourcesSig = useMemo(
    () => Array.from(enabledSources).sort().join(","),
    [enabledSources]
  );

  // Filter mask used by deck.gl accessors so disabled layers
  // visually fall back to the base building style instead of the
  // overlay tint. We don't drop the data — only the colour swap.
  const isVisible = useCallback((id: string): boolean => {
    const o = overlay.get(id);
    if (!o) return false;
    if (!enabledKinds.has(o.kind)) return false;
    if (o.sourceId && !enabledSources.has(o.sourceId)) return false;
    return true;
  }, [overlay, enabledKinds, enabledSources]);

  // Filter grid colours by enabled severity levels.
  const filteredGridColors = useMemo(() => {
    if (!wardGridColors || !enabledSeverities) return wardGridColors;
    const entries = Array.from(wardGridColors.entries()).filter(
      ([, wc]) => enabledSeverities.has(wc.severity)
    );
    return new (globalThis as unknown as { Map: MapConstructor }).Map(entries) as typeof wardGridColors;
  }, [wardGridColors, enabledSeverities]);

  const layers = useMemo(() => {
    const result: (PolygonLayer<Building> | PolygonLayer<Ward> | PathLayer<Ward>)[] = [];

    // Ward fill layer — rendered BELOW buildings.
    // When grid stream colours are present they override the default
    // ward fill, painting each zone with its RAG severity shade.
    if (showWards && wards.length > 0) {
      const gridVersion = filteredGridColors
        ? Array.from(filteredGridColors.values()).reduce((a, c) => a + c.expiresAt, 0)
        : 0;
      result.push(
        new PolygonLayer<Ward>({
          id: "toronto-wards-fill",
          data: wards,
          pickable: false,
          stroked: false,
          filled: true,
          extruded: false,
          getPolygon: (w) => (w.holes ? [w.contour, ...w.holes] : w.contour),
          getFillColor: (w) => {
            const gc = filteredGridColors?.get(w.id);
            if (gc) return gc.fill;
            // Default: show all wards as "normal" (green)
            return severityToFill("normal", 50);
          },
          updateTriggers: { getFillColor: [gridVersion] },
        })
      );
    }

    // Building layer
    result.push(
      new PolygonLayer<Building>({
        id: "toronto-buildings",
        data: buildings,
        updateTriggers: {
          getFillColor: [
            overlayVersion,
            kindsSig,
            sourcesSig,
            buildingOpacity,
            heightPaletteId,
            colorMode,
            energyById,
            energyMatchById,
          ],
          getLineColor: [overlayVersion, hoverId, kindsSig, sourcesSig, buildingOpacity],
          getLineWidth: [overlayVersion, hoverId, kindsSig, sourcesSig],
        },
        pickable: true,
        stroked: true,
        filled: true,
        extruded: true,
        wireframe: false,
        getPolygon: (b) => (b as any).__polyData ?? b.contour,
        getElevation: (b) => b.height,
        elevationScale: 1,
        getFillColor: (b) => {
          let rgba: [number, number, number, number];
          // Energy colour mode: use real or estimated consumption data.
          if (colorMode === "energy") {
            const geoMatch = energyMatchById?.get(b.id);
            const est = energyById?.get(b.id);
            const t = geoMatch?.normalised ?? est?.normalised ?? 0;
            rgba = energyToColor(t);
          } else if (isVisible(b.id)) {
            const o = overlay.get(b.id);
            if (o?.color) { rgba = o.color; }
            else { rgba = pickFill(b, undefined, heightPaletteId); }
          } else {
            rgba = pickFill(b, undefined, heightPaletteId);
          }
          return [rgba[0], rgba[1], rgba[2], Math.round(rgba[3] * buildingOpacity)] as [number, number, number, number];
        },
        getLineColor: (b) =>
          pickLineColor(
            isVisible(b.id) ? overlay.get(b.id) : undefined,
            hoverIdRef.current === b.id
          ),
        getLineWidth: (b) =>
          pickLineWidth(
            isVisible(b.id) ? overlay.get(b.id) : undefined,
            hoverIdRef.current === b.id
          ),
        lineWidthUnits: "pixels",
        lineWidthMinPixels: 0.4,
        material: BUILDING_MATERIAL,
        onHover: (info: PickingInfo<Building>) => {
          const next = info.object?.id ?? null;
          if (next !== hoverIdRef.current) {
            setHoverId(next);
            onHoverBuilding?.(info.object ?? null);
          }
        },
        onClick: (info: PickingInfo<Building>) => {
          const next = info.object?.id ?? null;
          setSelectedId((prev) => (prev === next ? null : next));
        },
      })
    );

    // Ward outline layer — rendered ABOVE buildings for crisp boundaries.
    // Grid stream severity also thickens and recolours the outline.
    if (showWards && wards.length > 0) {
      const gridVersion = filteredGridColors
        ? Array.from(filteredGridColors.values()).reduce((a, c) => a + c.expiresAt, 0)
        : 0;
      result.push(
        new PathLayer<Ward>({
          id: "toronto-wards-outline",
          data: wards,
          pickable: false,
          widthUnits: "pixels",
          widthMinPixels: 1.6,
          getPath: (w) => w.contour,
          getColor: (w) => {
            const gc = filteredGridColors?.get(w.id);
            if (gc) return gc.outline;
            // Default: show all wards as "normal" (green) outline
            return severityToOutline("normal", 160);
          },
          getWidth: (w) => {
            const gc = filteredGridColors?.get(w.id);
            if (gc) return 3.2;
            return pickWardLineWidth(undefined);
          },
          updateTriggers: { getColor: [gridVersion], getWidth: [gridVersion] },
        })
      );
    }

    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    buildings,
    overlay,
    overlayVersion,
    onHoverBuilding,
    kindsSig,
    sourcesSig,
    wards,
    showWards,
    buildingOpacity,
    wardGridColors,
    filteredGridColors,
    colorMode,
    heightPaletteId,
    energyById,
    energyMatchById,
    isVisible,
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

      {showWards && filteredGridColors && filteredGridColors.size > 0 && (
        <WardAnnotationOverlays
          width={size.w}
          height={size.h}
          viewState={viewState}
          wards={wards}
          wardColors={filteredGridColors}
        />
      )}

      {/* Energy info panel — shown when a building with metered data is clicked */}
      {(() => {
        if (!selectedId) return null;
        const b = buildingsById.get(selectedId);
        const ef = energyMatchById?.get(selectedId);
        if (!b || !ef) return null;
        return (
          <EnergyInfoPanel
            width={size.w}
            height={size.h}
            viewState={viewState}
            building={b}
            energy={ef}
            onClose={() => setSelectedId(null)}
          />
        );
      })()}
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
