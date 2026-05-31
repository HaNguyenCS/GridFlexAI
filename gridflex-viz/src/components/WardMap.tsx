import { useCallback, useEffect, useMemo, useState } from "react";
import Map, { Layer, Source } from "react-map-gl/maplibre";
import type { MapLayerMouseEvent, MapRef } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";

import { statusFillColor } from "../lib/format";
import type { KeplerFlow } from "../lib/simulationTypes";
import type { ZoneMetrics } from "../lib/types";

const INITIAL_VIEW = {
  longitude: -79.3832,
  latitude: 43.703,
  zoom: 10.2,
  pitch: 0,
  bearing: 0,
};

const FALLBACK_STYLE = {
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
      paint: { "raster-opacity": 0.28, "raster-saturation": -0.8 },
    },
  ],
};

interface Props {
  geojsonUrl: string;
  zones: Map<string, ZoneMetrics>;
  selectedZone: string | null;
  onSelectZone: (zoneId: string | null) => void;
  flows?: KeplerFlow[];
}

export function WardMap({ geojsonUrl, zones, selectedZone, onSelectZone, flows = [] }: Props) {
  const [baseGeoJson, setBaseGeoJson] = useState<GeoJSON.FeatureCollection | null>(
    null
  );
  const [mapRef, setMapRef] = useState<MapRef | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);

  useEffect(() => {
    fetch(geojsonUrl)
      .then((res) => res.json())
      .then((data: GeoJSON.FeatureCollection) => setBaseGeoJson(data))
      .catch(console.error);
  }, [geojsonUrl]);

  const mergedGeoJson = useMemo(() => {
    if (!baseGeoJson) return null;
    return {
      ...baseGeoJson,
      features: baseGeoJson.features.map((feature) => {
        const zoneId = String(feature.properties?.zone_id ?? "");
        const live = zones.get(zoneId);
        return {
          ...feature,
          properties: {
            ...feature.properties,
            ...live,
            status: live?.status ?? "ok",
            fill_color: statusFillColor(live?.status),
          },
        };
      }),
    } satisfies GeoJSON.FeatureCollection;
  }, [baseGeoJson, zones]);

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

  const activeId = hoverId ?? selectedZone;

  return (
    <Map
      ref={setMapRef}
      initialViewState={INITIAL_VIEW}
      mapStyle={FALLBACK_STYLE}
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
              0.82,
              ["==", ["get", "spike_active"], true],
              0.68,
              0.48,
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
              "#1e293b",
            ],
            "line-width": [
              "case",
              ["==", ["get", "zone_id"], activeId ?? ""],
              2.5,
              ["==", ["get", "status"], "issue"],
              2,
              0.8,
            ],
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
              "line-opacity": 0.75,
            }}
            layout={{ "line-cap": "round" }}
          />
        </Source>
      )}
    </Map>
  );
}
