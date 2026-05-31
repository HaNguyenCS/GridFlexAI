// Toronto wards data layer.

import type { LngLat, Ring, Ward } from "./mapTypes";

export async function fetchTorontoWards(opts?: {
  signal?: AbortSignal;
}): Promise<Ward[]> {
  const localUrl = "/data/city-wards-4326.geojson";
  const remoteUrl =
    "https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/5e7a8234-f805-43ac-820f-03d7c360b588/resource/737b29e0-8329-4260-b6af-21555ab24f28/download/City%20Wards%20Data%20-%204326.geojson";

  for (const url of [localUrl, remoteUrl]) {
    try {
      const res = await fetch(url, { signal: opts?.signal });
      if (!res.ok) continue;
      const geojson = await res.json();
      return parseWardsGeoJSON(geojson);
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") {
        return getFallbackWards();
      }
      if (url === remoteUrl) {
        console.warn("Failed to fetch Toronto wards, using fallback:", err);
      }
    }
  }
  return getFallbackWards();
}

function parseWardsGeoJSON(geojson: unknown): Ward[] {
  const collection = geojson as {
    type: "FeatureCollection";
    features: Array<{
      type: "Feature";
      properties: Record<string, unknown>;
      geometry: {
        type: "Polygon" | "MultiPolygon";
        coordinates: number[][][] | number[][][][];
      };
    }>;
  };

  if (!collection || collection.type !== "FeatureCollection") {
    throw new Error("Invalid GeoJSON: expected FeatureCollection");
  }

  return collection.features
    .map((feature, idx): Ward | null => {
      const props = feature.properties;
      const wardNumber = parseInt((props.AREA_SHORT_CODE as string) || String(idx + 1));
      const wardName = (props.AREA_NAME as string) || `Ward ${wardNumber}`;
      const wardId = `ward-${wardNumber}`;

      const geometry = feature.geometry;
      let contour: Ring;
      let holes: Ring[] | undefined;

      if (geometry.type === "Polygon") {
        contour = geometry.coordinates[0].map(([lng, lat]) => [lng, lat] as LngLat);
        if (geometry.coordinates.length > 1) {
          holes = geometry.coordinates.slice(1).map((ring) =>
            ring.map(([lng, lat]) => [lng, lat] as LngLat)
          );
        }
      } else if (geometry.type === "MultiPolygon") {
        let largestArea = 0;
        let largestIdx = 0;
        geometry.coordinates.forEach((polygon, polygonIdx) => {
          const area = (polygon as number[][][])[0].length;
          if (area > largestArea) {
            largestArea = area;
            largestIdx = polygonIdx;
          }
        });
        const largestPolygon = geometry.coordinates[largestIdx] as number[][][];
        contour = largestPolygon[0].map(([lng, lat]) => [lng, lat] as LngLat);
      } else {
        return null;
      }

      const centroid = computeCentroid(contour);
      const areaKm2 = props.AREA_SQ_KM as number | undefined;

      return {
        id: wardId,
        wardNumber,
        name: wardName,
        contour,
        holes,
        centroid,
        areaKm2,
      };
    })
    .filter((w): w is Ward => w !== null);
}

function computeCentroid(ring: Ring): LngLat {
  let lng = 0;
  let lat = 0;
  const n = ring.length - 1;
  for (let i = 0; i < n; i++) {
    lng += ring[i][0];
    lat += ring[i][1];
  }
  return [lng / n, lat / n];
}

function getFallbackWards(): Ward[] {
  const center: LngLat = [-79.3832, 43.6532];
  const wards: Ward[] = [];

  const gridSize = 5;
  const wardSizeKm = 8;
  const kmPerDegLat = 111.32;
  const kmPerDegLng = 111.32 * Math.cos((43.65 * Math.PI) / 180);

  const wardNames: Record<number, string> = {
    1: "Etobicoke North",
    2: "Etobicoke Centre",
    3: "Etobicoke-Lakeshore",
    4: "Parkdale-High Park",
    5: "York South-Weston",
    6: "York Centre",
    7: "Humber River-Black Creek",
    8: "Eglinton-Lawrence",
    9: "Davenport",
    10: "Spadina-Fort York",
    11: "Toronto-St. Paul's",
    12: "Toronto-Danforth",
    13: "Toronto Centre",
    14: "Toronto-Danforth",
    15: "Don Valley West",
    16: "Don Valley East",
    17: "Don Valley North",
    18: "Willowdale",
    19: "Beaches-East York",
    20: "Scarborough Southwest",
    21: "Scarborough Centre",
    22: "Scarborough-Agincourt",
    23: "Scarborough North",
    24: "Scarborough-Guildwood",
    25: "Etobicoke-Lakeshore",
  };

  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const wardNumber = row * gridSize + col + 1;
      const wardId = `ward-${wardNumber}`;
      const wardName = wardNames[wardNumber] || `Ward ${wardNumber}`;

      const centerLng = center[0] + (col - gridSize / 2 + 0.5) * (wardSizeKm / kmPerDegLng);
      const centerLat = center[1] + (row - gridSize / 2 + 0.5) * (wardSizeKm / kmPerDegLat);

      const halfSize = wardSizeKm / 2;
      const contour: Ring = [
        [centerLng - halfSize / kmPerDegLng, centerLat - halfSize / kmPerDegLat],
        [centerLng + halfSize / kmPerDegLng, centerLat - halfSize / kmPerDegLat],
        [centerLng + halfSize / kmPerDegLng, centerLat + halfSize / kmPerDegLat],
        [centerLng - halfSize / kmPerDegLng, centerLat + halfSize / kmPerDegLat],
        [centerLng - halfSize / kmPerDegLng, centerLat - halfSize / kmPerDegLat],
      ];

      wards.push({
        id: wardId,
        wardNumber,
        name: wardName,
        contour,
        centroid: [centerLng, centerLat],
        areaKm2: wardSizeKm * wardSizeKm,
      });
    }
  }

  return wards;
}

export function indexWardsById(wards: Ward[]): Map<string, Ward> {
  const map = new Map<string, Ward>();
  for (const ward of wards) {
    map.set(ward.id, ward);
  }
  return map;
}
