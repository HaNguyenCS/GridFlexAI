import { useCallback, useEffect, useMemo, useState } from "react";
import MapLibreMap, {
  Layer,
  Source,
  type MapLayerMouseEvent,
  type MapRef,
} from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";

import type { ZoneMetrics } from "../lib/types";

interface SimNode {
  ward_id: string;
  ward_name?: string;
  risk_level?: string;
  event_type?: string;
  recommended_action?: string;
  recommended_bid_mw?: number;
  accepted_bid_mw?: number;
  dispatch_status?: string;
  stress_score?: number;
  ward_load_proxy_mw?: number;
  ward_flexible_capacity_mw?: number;
}

interface Props {
  geojsonUrl: string;
  zones: Map<string, ZoneMetrics>;
  selectedZone: string | null;
  onSelectZone: (zoneId: string | null) => void;
  flows?: unknown[];
  simNodes?: SimNode[];
}

const INITIAL_VIEW = {
  longitude: -79.3832,
  latitude: 43.703,
  zoom: 10.25,
  pitch: 52,
  bearing: -18,
};

const DARK_STYLE = {
  version: 8 as const,
  sources: {
    carto: {
      type: "raster" as const,
      tiles: [
        "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution: "© OpenStreetMap © CARTO",
    },
  },
  layers: [
    {
      id: "background",
      type: "background" as const,
      paint: { "background-color": "#07090c" },
    },
    {
      id: "carto",
      type: "raster" as const,
      source: "carto",
      paint: {
        "raster-opacity": 0.48,
        "raster-saturation": -0.55,
        "raster-contrast": 0.08,
      },
    },
  ],
};

function normalizeWardId(raw: unknown): string {
  if (raw == null) return "";

  const s = String(raw).trim();
  const direct = s.match(/^ward[_-](\d+)$/i);
  if (direct) return `ward_${direct[1].padStart(2, "0")}`;

  const digits = s.match(/\d+/);
  if (digits) return `ward_${digits[0].padStart(2, "0")}`;

  return s;
}

function healthForNode(node: SimNode | undefined): "good" | "problem" | "stressed" {
  if (!node) return "good";

  if (node.risk_level === "critical" || node.risk_level === "high") {
    return "stressed";
  }

  if (node.risk_level === "medium") {
    return "problem";
  }

  return "good";
}

function colorForHealth(health: "good" | "problem" | "stressed") {
  if (health === "stressed") return "#ef4444";
  if (health === "problem") return "#f97316";
  return "#22c55e";
}

function labelForHealth(health: "good" | "problem" | "stressed") {
  if (health === "stressed") return "Stressed";
  if (health === "problem") return "Problem";
  return "Doing good";
}

export function WardMap({
  geojsonUrl,
  zones,
  selectedZone,
  onSelectZone,
  simNodes = [],
}: Props) {
  const [baseGeoJson, setBaseGeoJson] = useState<GeoJSON.FeatureCollection | null>(null);
  const [mapRef, setMapRef] = useState<MapRef | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch(geojsonUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load wards: ${res.status}`);
        return res.json();
      })
      .then((data: GeoJSON.FeatureCollection) => {
        if (!cancelled) setBaseGeoJson(data);
      })
      .catch((error) => {
        console.error("WardMap failed to load ward GeoJSON", error);
      });

    return () => {
      cancelled = true;
    };
  }, [geojsonUrl]);

  const simByWard = useMemo(() => {
    const map = new globalThis.Map<string, SimNode>();

    for (const node of simNodes) {
      map.set(normalizeWardId(node.ward_id), node);
    }

    return map;
  }, [simNodes]);

  const mergedGeoJson = useMemo(() => {
    if (!baseGeoJson) return null;

    return {
      ...baseGeoJson,
      features: baseGeoJson.features.map((feature, index) => {
        const props = feature.properties ?? {};
        const zoneId = normalizeWardId(
          props.zone_id ??
            props.ward_id ??
            props.AREA_SHORT_CODE ??
            props.WARD_NUMBER ??
            index + 1
        );

        const live = zones.get(zoneId);
        const node = simByWard.get(zoneId);
        const health = healthForNode(node);
        const fillColor = colorForHealth(health);

        return {
          ...feature,
          properties: {
            ...props,
            ...live,
            zone_id: zoneId,
            ward_name:
              node?.ward_name ??
              props.WARD_NAME ??
              props.AREA_NAME ??
              zoneId.replace("_", " ").toUpperCase(),
            health,
            health_label: labelForHealth(health),
            fill_color: fillColor,
            risk_level: node?.risk_level ?? "normal",
            stress_score: node?.stress_score ?? 0,
            recommended_action: node?.recommended_action ?? "none",
            recommended_bid_mw: node?.recommended_bid_mw ?? 0,
            accepted_bid_mw: node?.accepted_bid_mw ?? 0,
          },
        };
      }),
    } satisfies GeoJSON.FeatureCollection;
  }, [baseGeoJson, zones, simByWard]);

  const selectedNormalized = selectedZone ? normalizeWardId(selectedZone) : null;
  const activeId = hoverId ?? selectedNormalized;

  const onClick = useCallback(
    (event: MapLayerMouseEvent) => {
      const feature = event.features?.[0];
      const zoneId = feature?.properties?.zone_id as string | undefined;
      onSelectZone(zoneId ?? null);
    },
    [onSelectZone]
  );

  const onMouseMove = useCallback((event: MapLayerMouseEvent) => {
    const feature = event.features?.[0];
    setHoverId((feature?.properties?.zone_id as string | undefined) ?? null);
  }, []);

  useEffect(() => {
    if (!mapRef || !selectedNormalized || !mergedGeoJson) return;

    const feature = mergedGeoJson.features.find(
      (f) => f.properties?.zone_id === selectedNormalized
    );

    if (!feature?.geometry) return;

    const coords: number[][] = [];
    const geom = feature.geometry;

    if (geom.type === "Polygon") {
      coords.push(...geom.coordinates[0]);
    } else if (geom.type === "MultiPolygon") {
      for (const poly of geom.coordinates) coords.push(...poly[0]);
    }

    if (!coords.length) return;

    const lngs = coords.map((c) => c[0]);
    const lats = coords.map((c) => c[1]);

    mapRef.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding: 70, duration: 650 }
    );
  }, [mapRef, selectedNormalized, mergedGeoJson]);

  const activeFeature = activeId
    ? mergedGeoJson?.features.find((f) => f.properties?.zone_id === activeId)
    : null;

  if (!mergedGeoJson) {
    return (
      <div className="gf-map-loading">
        <div>
          <span>Loading Toronto ward map…</span>
          <strong>GridFlex</strong>
        </div>
      </div>
    );
  }

  return (
    <div className="gf-ward-map">
      <MapLibreMap
        ref={setMapRef}
        initialViewState={INITIAL_VIEW}
        mapStyle={DARK_STYLE}
        style={{ width: "100%", height: "100%" }}
        interactiveLayerIds={["wards-fill"]}
        onClick={onClick}
        onMouseMove={onMouseMove}
        onMouseLeave={() => setHoverId(null)}
        attributionControl={false}
        dragRotate
        pitchWithRotate
        maxPitch={68}
      >
        <Source id="wards" type="geojson" data={mergedGeoJson} promoteId="zone_id">
          <Layer
            id="wards-fill"
            type="fill"
            paint={{
              "fill-color": ["get", "fill_color"],
              "fill-opacity": [
                "case",
                ["==", ["get", "zone_id"], activeId ?? ""],
                0.78,
                ["==", ["get", "health"], "stressed"],
                0.68,
                ["==", ["get", "health"], "problem"],
                0.58,
                0.42,
              ],
            }}
          />

          <Layer
            id="wards-line"
            type="line"
            paint={{
              "line-color": [
                "case",
                ["==", ["get", "zone_id"], activeId ?? ""],
                "#ffffff",
                ["get", "fill_color"],
              ],
              "line-opacity": [
                "case",
                ["==", ["get", "zone_id"], activeId ?? ""],
                0.95,
                0.72,
              ],
              "line-width": [
                "case",
                ["==", ["get", "zone_id"], activeId ?? ""],
                3.2,
                ["==", ["get", "health"], "stressed"],
                2.4,
                ["==", ["get", "health"], "problem"],
                2.0,
                1.35,
              ],
            }}
          />
        </Source>
      </MapLibreMap>

      <div className="gf-map-vignette" />

      {activeFeature && (
        <div className="gf-map-hover-card">
          <div className="gf-panel-kicker">{activeFeature.properties?.zone_id}</div>
          <h3>{activeFeature.properties?.ward_name}</h3>
          <div className="gf-map-hover-grid">
            <span>Health</span>
            <strong>{activeFeature.properties?.health_label}</strong>
            <span>Risk</span>
            <strong>{activeFeature.properties?.risk_level}</strong>
            <span>Action</span>
            <strong>{String(activeFeature.properties?.recommended_action ?? "none").replace(/_/g, " ")}</strong>
          </div>
        </div>
      )}
    </div>
  );
}
