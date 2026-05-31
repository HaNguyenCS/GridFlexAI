// WardMap — MapLibre GL base map + deck.gl 3D building overlay with ward boundaries.
//
// Architecture:
//   - react-map-gl for the MapLibre base map
//   - deck.gl PolygonLayer for 3D extruded buildings
//   - deck.gl PolygonLayer + PathLayer for ward fills and outlines
//   - Live ward severity colors from the grid stream

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Map, { type MapRef } from "react-map-gl/maplibre";
import maplibregl from "maplibre-gl";
import DeckGL from "@deck.gl/react";
import { PolygonLayer, PathLayer } from "@deck.gl/layers";
import { LightingEffect, AmbientLight, DirectionalLight } from "@deck.gl/core";
import type { MapViewState, PickingInfo } from "@deck.gl/core";

import type { Building, Ward, WardGridColor } from "../lib/mapTypes";
import {
  OverlayState,
  pickFill,
  pickLineColor,
  pickLineWidth,
} from "../lib/overlay";
import { pickWardLineWidth } from "../lib/wardOverlay";
import { severityToFill, severityToOutline } from "../lib/mapGridStreams";
import { DARK_STYLE_URL } from "../lib/mapStyle";
import { fetchTorontoBuildings, indexById } from "../lib/buildings";
import { fetchTorontoWards } from "../lib/wards";

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

const BUILDING_MATERIAL = {
  ambient: 0.55,
  diffuse: 0.85,
  shininess: 28,
  specularColor: [180, 220, 240] as [number, number, number],
};

function attachPolygonData(buildings: Building[]): void {
  for (const b of buildings) {
    if ((b as any).__polyData) continue;
    (b as any).__polyData = b.holes ? [b.contour, ...b.holes] : b.contour;
  }
}

interface Props {
  geojsonUrl?: string; // kept for backward compatibility, not used
  zones?: Map<string, any>; // kept for backward compatibility
  selectedZone?: string | null;
  onSelectZone?: (zoneId: string | null) => void;
  flows?: unknown[];
  simNodes?: any[];
  wardGridColors?: Map<string, WardGridColor>;
  enabledSeverities?: Set<string>;
}

export function WardMap({
  selectedZone,
  onSelectZone,
  wardGridColors,
  enabledSeverities,
}: Props) {
  const mapRef = useRef<MapRef | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [wards, setWards] = useState<Ward[]>([]);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const hoverIdRef = useRef<string | null>(null);
  hoverIdRef.current = hoverId;
  const [viewState, setViewState] = useState<MapViewState>(INITIAL_VIEW);
  const [loading, setLoading] = useState(true);

  const overlay = useMemo(() => new OverlayState(), []);
  const overlayVersion = overlay.version;

  // Load buildings
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    fetchTorontoBuildings()
      .then((data) => {
        if (!cancelled) {
          console.log(`Loaded ${data.length} buildings from real data`);
          setBuildings(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.error("Failed to load buildings:", err);
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Load wards
  useEffect(() => {
    let cancelled = false;

    fetchTorontoWards()
      .then((data) => {
        if (!cancelled) {
          console.log(`Loaded ${data.length} wards from real data`);
          setWards(data);
        }
      })
      .catch((err) => {
        console.error("Failed to load wards:", err);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Track container size (for future annotation overlays)
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      // Can be used for annotation overlays later
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const buildingsById = useMemo(() => indexById(buildings), [buildings]);

  useMemo(() => attachPolygonData(buildings), [buildings]);

  // Filter grid colours by enabled severity levels.
  const filteredGridColors = useMemo(() => {
    if (!wardGridColors || !enabledSeverities) return wardGridColors;
    const entries = Array.from(wardGridColors.entries()).filter(
      ([, wc]) => enabledSeverities.has(wc.severity)
    );
    return new globalThis.Map(entries) as typeof wardGridColors;
  }, [wardGridColors, enabledSeverities]);

  const layers = useMemo(() => {
    const result: (PolygonLayer<Building> | PolygonLayer<Ward> | PathLayer<Ward>)[] = [];

    // Ward fill layer — rendered BELOW buildings
    if (wards.length > 0) {
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
        pickable: true,
        stroked: true,
        filled: true,
        extruded: true,
        wireframe: false,
        getPolygon: (b) => (b as any).__polyData ?? b.contour,
        getElevation: (b) => b.height,
        elevationScale: 1,
        getFillColor: (b) => {
          const rgba = pickFill(b, undefined, 'elevation');
          return rgba;
        },
        getLineColor: (b) =>
          pickLineColor(
            undefined,
            hoverIdRef.current === b.id
          ),
        getLineWidth: (b) =>
          pickLineWidth(
            undefined,
            hoverIdRef.current === b.id
          ),
        lineWidthUnits: "pixels",
        lineWidthMinPixels: 0.4,
        material: BUILDING_MATERIAL,
        onHover: (info: PickingInfo<Building>) => {
          const next = info.object?.id ?? null;
          if (next !== hoverIdRef.current) {
            setHoverId(next);
          }
        },
        onClick: (info: PickingInfo<Building>) => {
          const b = info.object;
          if (b) {
            onSelectZone?.(b.id);
          }
        },
        updateTriggers: {
          getFillColor: [overlayVersion],
          getLineColor: [overlayVersion, hoverId],
          getLineWidth: [overlayVersion, hoverId],
        },
      })
    );

    // Ward outline layer — rendered ABOVE buildings
    if (wards.length > 0) {
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
  }, [
    buildings,
    overlayVersion,
    wards,
    filteredGridColors,
    hoverId,
    onSelectZone,
  ]);

  // Fly to selected zone/building
  useEffect(() => {
    if (!mapRef.current || !selectedZone || !buildings.length) return;

    const target = buildingsById.get(selectedZone);
    if (!target) return;

    const [lng, lat] = centroid(target.contour);
    mapRef.current.flyTo({
      center: [lng, lat],
      zoom: Math.max(viewState.zoom || 14, 16.4),
      duration: 1200,
    });
  }, [selectedZone, buildingsById, buildings.length, viewState.zoom]);

  if (loading) {
    return (
      <div className="gf-map-loading">
        <div>
          <span>Loading Toronto city map…</span>
          <strong>GridFlex</strong>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="gf-ward-map" style={{ width: "100%", height: "100%" }}>
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

      {/* Ground vignette */}
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
