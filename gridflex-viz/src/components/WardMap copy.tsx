import { useCallback, useEffect, useMemo, useState } from "react";
import Map, { Layer, Source } from "react-map-gl/maplibre";
import type { MapLayerMouseEvent, MapRef } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";

import { statusFillColor } from "../lib/format";
import type { KeplerFlow, KeplerNode } from "../lib/simulationTypes";
import type { ZoneMetrics } from "../lib/types";

const OFFLINE_MAP = import.meta.env.VITE_OFFLINE === "true";

const RISK_FILL: Record<string, string> = {
  critical: "#dc2626",
  high: "#f97316",
  medium: "#eab308",
  normal: "#22c55e",
};

function nodeFill(
  node: KeplerNode | undefined,
  supplyStatus: string | undefined
): string {
  if (!node) {
    return statusFillColor(supplyStatus as ZoneMetrics["status"]);
  }

  if (node.dispatch_status === "recovered") {
    return RISK_FILL.normal;
  }

  if (node.risk_level) {
    return RISK_FILL[node.risk_level] ?? RISK_FILL.medium;
  }

  return statusFillColor(supplyStatus as ZoneMetrics["status"]);
}

function nodeLineColor(node: KeplerNode | undefined, isActive: boolean): string {
  if (isActive) return "#ffffff";

  if (node?.dispatch_status === "recovered") return "#bbf7d0";
  if (node?.dispatch_status === "accepted") return "#ffffff";
  if (node?.risk_level === "critical") return "#fecaca";
  if (node?.risk_level === "high") return "#fed7aa";

  return "#1e293b";
}

function nodeLineWidth(node: KeplerNode | undefined, isActive: boolean): number {
  if (isActive) return 2.8;
  if (node?.dispatch_status === "recovered") return 2.2;
  if (node?.dispatch_status === "accepted") return 2;
  if (node?.risk_level === "critical") return 1.6;
  return 0.8;
}

const INITIAL_VIEW = {
  longitude: -79.3832,
  latitude: 43.703,
  zoom: 10.2,
  pitch: 0,
  bearing: 0,
};

const FALLBACK_STYLE_OFFLINE = {
  version: 8 as const,
  sources: {},
  layers: [
    {
      id: "bg",
      type: "background" as const,
      paint: { "background-color": "#0b1020" },
    },
  ],
};

const FALLBACK_STYLE_ONLINE = {
  version: 8 as const,
  sources: {
    osm: {
      type: "raster" as const,
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap",
    },
  },
  layers: [
    {
      id: "bg",
      type: "background" as const,
      paint: { "background-color": "#0b1020" },
    },
    {
      id: "osm",
      type: "raster" as const,
      source: "osm",
      paint: { "raster-opacity": 0.22, "raster-saturation": -0.8 },
    },
  ],
};

interface Props {
  geojsonUrl: string;
  zones: Map<string, ZoneMetrics>;
  selectedZone: string | null;
  onSelectZone: (zoneId: string | null) => void;
  flows?: KeplerFlow[];
  simNodes?: KeplerNode[];
}

export function WardMap({
  geojsonUrl,
  zones,
  selectedZone,
  onSelectZone,
  flows = [],
  simNodes = [],
}: Props) {
  const [baseGeoJson, setBaseGeoJson] =
    useState<GeoJSON.FeatureCollection | null>(null);
  const [mapRef, setMapRef] = useState<MapRef | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);

  useEffect(() => {
    fetch(geojsonUrl)
      .then((res) => res.json())
      .then((data: GeoJSON.FeatureCollection) => setBaseGeoJson(data))
      .catch(console.error);
  }, [geojsonUrl]);

  const simByWard = useMemo(() => {
    const map = new globalThis.Map<string, KeplerNode>();

    for (const node of simNodes) {
      map.set(node.ward_id, node);
    }

    return map;
  }, [simNodes]);

  const activeId = hoverId ?? selectedZone;

  const mergedGeoJson = useMemo(() => {
    if (!baseGeoJson) return null;

    return {
      ...baseGeoJson,
      features: baseGeoJson.features.map((feature) => {
        const zoneId = String(feature.properties?.zone_id ?? "");
        const live = zones.get(zoneId);
        const sim = simByWard.get(zoneId);
        const isActive = zoneId === activeId;
        const fill = nodeFill(sim, live?.status);
        const lineColor = nodeLineColor(sim, isActive);
        const lineWidth = nodeLineWidth(sim, isActive);

        return {
          ...feature,
          properties: {
            ...feature.properties,
            ...live,
            ...sim,
            dispatch_status: sim?.dispatch_status ?? "none",
            accepted_bid_mw: sim?.accepted_bid_mw ?? 0,
            status: live?.status ?? "ok",
            fill_color: fill,
            line_color: lineColor,
            line_width: lineWidth,
          },
        };
      }),
    } satisfies GeoJSON.FeatureCollection;
  }, [baseGeoJson, zones, simByWard, activeId]);

  const flowGeoJson = useMemo((): GeoJSON.FeatureCollection => {
    return {
      type: "FeatureCollection",
      features: flows.map((flow) => ({
        type: "Feature",
        properties: {
          flow_id: flow.flow_id,
          flow_mw: flow.flow_mw,
          risk_level: flow.risk_level,
        },
        geometry: {
          type: "LineString",
          coordinates: [
            [flow.source_lng, flow.source_lat],
            [flow.target_lng, flow.target_lat],
          ],
        },
      })),
    };
  }, [flows]);

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
    if (!mapRef || !selectedZone || !mergedGeoJson) return;

    const feature = mergedGeoJson.features.find(
      (f) => f.properties?.zone_id === selectedZone
    );

    if (!feature?.geometry) return;

    const coords: number[][] = [];
    const geom = feature.geometry;

    if (geom.type === "Polygon") {
      coords.push(...geom.coordinates[0]);
    } else if (geom.type === "MultiPolygon") {
      for (const poly of geom.coordinates) {
        coords.push(...poly[0]);
      }
    }

    if (!coords.length) return;

    const lngs = coords.map((coord) => coord[0]);
    const lats = coords.map((coord) => coord[1]);

    mapRef.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding: 80, duration: 700 }
    );
  }, [mapRef, selectedZone, mergedGeoJson]);

  if (!mergedGeoJson) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-400">
        Loading ward boundaries…
      </div>
    );
  }

  return (
    <Map
      ref={setMapRef}
      initialViewState={INITIAL_VIEW}
      mapStyle={OFFLINE_MAP ? FALLBACK_STYLE_OFFLINE : FALLBACK_STYLE_ONLINE}
      style={{ width: "100%", height: "100%" }}
      interactiveLayerIds={["wards-fill"]}
      onClick={onClick}
      onMouseMove={onMouseMove}
      onMouseLeave={() => setHoverId(null)}
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
              0.86,
              ["==", ["get", "dispatch_status"], "recovered"],
              0.8,
              ["==", ["get", "dispatch_status"], "accepted"],
              0.72,
              ["==", ["get", "risk_level"], "critical"],
              0.78,
              ["==", ["get", "risk_level"], "high"],
              0.7,
              0.52,
            ],
          }}
        />

        <Layer
          id="wards-line"
          type="line"
          paint={{
            "line-color": ["get", "line_color"],
            "line-width": ["get", "line_width"],
          }}
        />
      </Source>

      {flows.length > 0 && (
        <Source id="flex-flows" type="geojson" data={flowGeoJson}>
          <Layer
            id="flex-flow-lines"
            type="line"
            paint={{
              "line-color": "#38bdf8",
              "line-width": [
                "interpolate",
                ["linear"],
                ["get", "flow_mw"],
                0,
                1,
                200,
                6,
              ],
              "line-opacity": 0.55,
            }}
            layout={{ "line-cap": "round" }}
          />
        </Source>
      )}
    </Map>
  );
}