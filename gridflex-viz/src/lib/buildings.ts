// Building data loader — fetches Toronto building footprints.

import type { Building, LngLat, Ring } from "./mapTypes";

export const TORONTO_CENTRAL_BBOX = {
  minLng: -79.48,
  maxLng: -79.28,
  minLat: 43.62,
  maxLat: 43.72,
};

export interface BBox {
  minLng: number;
  maxLng: number;
  minLat: number;
  maxLat: number;
}

export async function fetchTorontoBuildings(opts?: {
  signal?: AbortSignal;
  bbox?: BBox;
}): Promise<Building[]> {
  const localUrl = "/data/building-outlines-4326.geojson";
  const bbox = opts?.bbox ?? TORONTO_CENTRAL_BBOX;

  try {
    const res = await fetch(localUrl, { signal: opts?.signal });
    if (!res.ok) {
      console.warn("Building data not available, using generated buildings");
      return generateFallbackBuildings();
    }
    const geojson = await res.json();
    return parseBuildingsGeoJSON(geojson, bbox);
  } catch (err) {
    console.warn("Failed to load building data, using generated buildings:", err);
    return generateFallbackBuildings();
  }
}

function parseBuildingsGeoJSON(geojson: unknown, bbox: BBox): Building[] {
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
    return generateFallbackBuildings();
  }

  const buildings: Building[] = [];

  for (const feature of collection.features) {
    const props = feature.properties;
    const geometry = feature.geometry;
    
    // Quick bbox filter using geometry bounds
    if (!geometryInBBox(geometry, bbox)) continue;
    
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
      // Use the largest polygon
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
      continue;
    }

    const height = parseFloat((props.DERIVED_HEIGHT as string) || "10") || 10;
    const id = String(props.OBJECTID || props._id || `bldg-${buildings.length}`);
    const category = (props.SUBTYPE_DESC as string) || (props.SUBTYPE_CODE as string);
    const label = category;

    buildings.push({
      id,
      contour,
      holes,
      height,
      category,
      label,
    });
  }

  return buildings;
}

/** Check if a geometry intersects with the bounding box. */
function geometryInBBox(
  geometry: { type: string; coordinates: any },
  bbox: BBox
): boolean {
  // Extract all coordinates and check if any point is within bbox
  const coords = extractCoordinates(geometry.coordinates);
  for (const [lng, lat] of coords) {
    if (
      lng >= bbox.minLng &&
      lng <= bbox.maxLng &&
      lat >= bbox.minLat &&
      lat <= bbox.maxLat
    ) {
      return true;
    }
  }
  return false;
}

/** Recursively extract [lng, lat] pairs from nested coordinate arrays. */
function extractCoordinates(coords: any): [number, number][] {
  const result: [number, number][] = [];
  
  function traverse(arr: any) {
    if (Array.isArray(arr)) {
      if (arr.length === 2 && typeof arr[0] === 'number' && typeof arr[1] === 'number') {
        result.push([arr[0], arr[1]]);
      } else {
        for (const item of arr) {
          traverse(item);
        }
      }
    }
  }
  
  traverse(coords);
  return result;
}

/**
 * Generate a synthetic set of buildings for demonstration.
 * Creates a grid of buildings around downtown Toronto.
 */
function generateFallbackBuildings(): Building[] {
  const buildings: Building[] = [];
  const center: LngLat = [-79.3832, 43.6532];
  const gridSize = 20;
  const spacing = 0.002;

  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const lng = center[0] + (col - gridSize / 2) * spacing;
      const lat = center[1] + (row - gridSize / 2) * spacing;
      const height = 10 + Math.random() * 80;
      const size = 0.0008 + Math.random() * 0.0004;

      const contour: Ring = [
        [lng - size, lat - size],
        [lng + size, lat - size],
        [lng + size, lat + size],
        [lng - size, lat + size],
        [lng - size, lat - size],
      ];

      buildings.push({
        id: `bldg-${row}-${col}`,
        contour,
        height,
        label: `Building ${buildings.length + 1}`,
      });
    }
  }

  return buildings;
}

export function indexById(buildings: Building[]): Map<string, Building> {
  const map = new Map<string, Building>();
  for (const b of buildings) {
    map.set(b.id, b);
  }
  return map;
}
