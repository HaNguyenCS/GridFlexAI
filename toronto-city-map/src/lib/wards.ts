// Toronto wards data layer.
//
// Source: City of Toronto Open Data — City Wards (2018 representation)
// https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/5e7a8234-f805-43ac-820f-03d7c360b588
//
// This module fetches the ward boundaries GeoJSON, normalizes it into
// a flat array of ward polygons, and provides utilities for ward lookup
// and event stream integration.

import type { LngLat, Ring } from "./types";

export interface Ward {
  /** Ward identifier (e.g., "ward-1", "ward-2", etc.). */
  id: string;
  /** Ward number (1-25). */
  wardNumber: number;
  /** Ward name (e.g., "Etobicoke North"). */
  name: string;
  /** Outer ring of the ward boundary. */
  contour: Ring;
  /** Optional inner rings (holes). */
  holes?: Ring[];
  /** Centroid of the ward for label placement. */
  centroid: LngLat;
  /** Area in square kilometers (if available). */
  areaKm2?: number;
}

/** Raw GeoJSON feature properties from the Toronto Open Data source. */
interface WardFeatureProperties {
  OBJECTID?: number;
  WARD_NUMBER?: number;
  WARD_NAME?: string;
  WARD_NAME_E?: string;
  WARD_NAME_F?: string;
  AREA_SQ_KM?: number;
  [key: string]: unknown;
}

/**
 * Fetch Toronto ward boundaries from the Open Data GeoJSON endpoint.
 * Returns a parsed array of Ward objects.
 */
export async function fetchTorontoWards(opts?: {
  signal?: AbortSignal;
}): Promise<Ward[]> {
  const localUrl = "/data/city-wards-4326.geojson";
  const remoteUrl =
    "https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/5e7a8234-f805-43ac-820f-03d7c360b588/resource/737b29e0-8329-4260-b6af-21555ab24f28/download/City%20Wards%20Data%20-%204326.geojson";

  // Prefer the same-origin prefetch staged by `npm run prefetch`.
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

/**
 * Parse a GeoJSON FeatureCollection into Ward objects.
 */
function parseWardsGeoJSON(geojson: unknown): Ward[] {
  const collection = geojson as {
    type: "FeatureCollection";
    features: Array<{
      type: "Feature";
      properties: WardFeatureProperties;
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
      const wardNumber = props.WARD_NUMBER ?? (idx + 1);
      const wardName = props.WARD_NAME_E || props.WARD_NAME || `Ward ${wardNumber}`;
      const wardId = `ward-${wardNumber}`;

      const geometry = feature.geometry;
      let contour: Ring;
      let holes: Ring[] | undefined;

      if (geometry.type === "Polygon") {
        // Polygon: coordinates[0] is outer ring, coordinates[1..] are holes
        contour = geometry.coordinates[0].map(([lng, lat]) => [lng, lat] as LngLat);
        if (geometry.coordinates.length > 1) {
          holes = geometry.coordinates.slice(1).map((ring) =>
            ring.map(([lng, lat]) => [lng, lat] as LngLat)
          );
        }
      } else if (geometry.type === "MultiPolygon") {
        // MultiPolygon: use the largest polygon as the main contour
        let largestArea = 0;
        let largestIdx = 0;
        geometry.coordinates.forEach((polygon, polygonIdx) => {
          const area = polygon[0].length;
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
      const areaKm2 = props.AREA_SQ_KM;

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

/**
 * Compute the centroid of a ring using the arithmetic mean of vertices.
 * This is a simplification — production code should use a proper
 * polygon centroid algorithm.
 */
function computeCentroid(ring: Ring): LngLat {
  let lng = 0;
  let lat = 0;
  const n = ring.length - 1; // Last point is duplicate of first
  for (let i = 0; i < n; i++) {
    lng += ring[i][0];
    lat += ring[i][1];
  }
  return [lng / n, lat / n];
}

/**
 * Fallback ward data — simplified approximate boundaries for the 25
 * Toronto wards. This ensures the demo works even when the Open Data
 * endpoint is unreachable.
 */
function getFallbackWards(): Ward[] {
  // Simplified ward boundaries centered around downtown Toronto
  const center: LngLat = [-79.3832, 43.6532];
  const wards: Ward[] = [];

  // Create a rough grid of 25 wards (5x5) around downtown
  const gridSize = 5;
  const wardSizeKm = 8; // Approximate ward size
  const kmPerDegLat = 111.32;
  const kmPerDegLng = 111.32 * Math.cos((43.65 * Math.PI) / 180);

  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const wardNumber = row * gridSize + col + 1;
      const wardId = `ward-${wardNumber}`;
      const wardName = getWardName(wardNumber);

      // Calculate ward center
      const centerLng = center[0] + (col - gridSize / 2 + 0.5) * (wardSizeKm / kmPerDegLng);
      const centerLat = center[1] + (row - gridSize / 2 + 0.5) * (wardSizeKm / kmPerDegLat);

      // Create ward boundary (square approximation)
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

/**
 * Get the official name for a Toronto ward number.
 * Based on the 2018 ward representation.
 */
function getWardName(wardNumber: number): string {
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
  return wardNames[wardNumber] || `Ward ${wardNumber}`;
}

/**
 * Index wards by ID for O(1) lookup.
 */
export function indexWardsById(wards: Ward[]): Map<string, Ward> {
  const map = new Map<string, Ward>();
  for (const ward of wards) {
    map.set(ward.id, ward);
  }
  return map;
}

/**
 * Find which ward contains a given point.
 * Uses simple point-in-polygon test.
 */
export function findWardAtPoint(
  wards: Ward[],
  point: LngLat
): Ward | undefined {
  for (const ward of wards) {
    if (pointInPolygon(point, ward.contour)) {
      return ward;
    }
  }
  return undefined;
}

/**
 * Ray-casting algorithm for point-in-polygon test.
 */
function pointInPolygon(point: LngLat, polygon: Ring): boolean {
  const [x, y] = point;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length - 1; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];

    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;

    if (intersect) inside = !inside;
  }

  return inside;
}
