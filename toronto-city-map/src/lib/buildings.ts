// Toronto building data layer.
//
// Source of truth: City of Toronto Open Data — "Topographic Mapping —
// Building Outlines" (https://open.toronto.ca/dataset/topographic-mapping-building-outlines).
// The full dataset publishes polygon geometry in WGS84 with attributes
// like AREA, MAX_HEIGHT, MIN_HEIGHT, BLDG_USE, MAP_ID and CAPTURE_DATE.
//
// For an instant-loading demo we ship a curated procedural footprint
// of the downtown core (Financial District / Entertainment District /
// Waterfront) that resembles the real city block grid. The
// `fetchTorontoBuildings()` function fetches the published GeoJSON
// resource, clips it to the central-Toronto bounding box for
// memory-friendliness, and falls back to the procedural set on
// network / parse failure.

import type { Building, LngLat, Ring } from "./types";

const TORONTO_DOWNTOWN_CENTER: LngLat = [-79.3832, 43.6532]; // City Hall

/** Toronto Open Data CKAN package endpoint (left here for reference / future hookup). */
export const TORONTO_OPENDATA_PACKAGE_URL =
  "https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/package_show?id=topographic-mapping-building-outlines";

/**
 * Direct GeoJSON resource — published in EPSG:4326 (WGS84).
 * The full file is several hundred MB; callers should clip via bbox.
 */
export const TORONTO_BUILDING_OUTLINES_URL =
  "https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/09a930cc-2a52-49b2-866d-52ac7f769a73/resource/8364d47f-6a39-439d-8e9c-4ea1a7506e53/download/Building%20Outlines%20-%204326.geojson";

/**
 * Same-origin path served by the dev/preview server when
 * `npm run prefetch` has populated `server/data/`. Tried first to
 * dodge CORS on the upstream CKAN host.
 */
export const LOCAL_BUILDING_OUTLINES_URL = "/data/building-outlines-4326.geojson";

/**
 * Default bounding box covering central Toronto (Etobicoke ↔ East York,
 * Lakeshore ↔ Yorkdale). Tight enough to keep parse + render under
 * tens of thousands of polygons, generous enough that panning around
 * downtown still finds geometry on every block.
 */
export const TORONTO_CENTRAL_BBOX = {
  minLng: -79.48,
  maxLng: -79.28,
  minLat: 43.62,
  maxLat: 43.72,
} as const;

export interface BBox {
  minLng: number;
  maxLng: number;
  minLat: number;
  maxLat: number;
}

/** Approx metres-per-degree at Toronto latitude for our procedural grid. */
const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LNG = 111_320 * Math.cos((43.65 * Math.PI) / 180);

interface BlockSpec {
  /** Offset from center in metres: [east, north]. */
  offset: [number, number];
  /** Width and depth of the footprint in metres. */
  size: [number, number];
  /** Building height in metres. */
  height: number;
  /** Optional rotation around centroid in radians. */
  rotation?: number;
  category?: string;
  label?: string;
}

/**
 * Hand-tuned set of major downtown structures + a procedural block grid
 * around them. Coordinates are illustrative — the geometry approximates
 * the real Financial District footprint without redistributing the
 * actual open-data shapefile (which is ~1 GB).
 */
const LANDMARKS: BlockSpec[] = [
  // CN Tower (modeled as a tall slim tower — true geometry is a hexagon
  // with an antenna mast; the polygon layer gives a good visual proxy).
  {
    offset: [-260, -480],
    size: [42, 42],
    height: 553,
    label: "CN Tower",
    category: "civic",
  },
  // First Canadian Place
  {
    offset: [-90, -110],
    size: [70, 70],
    height: 298,
    label: "First Canadian Place",
    category: "commercial",
  },
  // Scotia Plaza
  {
    offset: [10, -90],
    size: [55, 60],
    height: 275,
    label: "Scotia Plaza",
    category: "commercial",
  },
  // TD Canada Trust Tower
  {
    offset: [-30, -180],
    size: [60, 50],
    height: 261,
    label: "TD Canada Trust Tower",
    category: "commercial",
  },
  // Commerce Court West
  {
    offset: [60, -150],
    size: [55, 55],
    height: 239,
    label: "Commerce Court West",
    category: "commercial",
  },
  // Bay Adelaide West
  {
    offset: [-30, 0],
    size: [60, 60],
    height: 218,
    label: "Bay Adelaide West",
    category: "commercial",
  },
  // L Tower
  {
    offset: [350, -230],
    size: [40, 40],
    height: 205,
    label: "L Tower",
    category: "residential",
  },
  // Trump / Adelaide Hotel
  {
    offset: [110, -40],
    size: [50, 50],
    height: 277,
    label: "Adelaide Hotel",
    category: "residential",
  },
  // Royal Bank Plaza South Tower
  {
    offset: [-10, -260],
    size: [55, 50],
    height: 180,
    label: "Royal Bank Plaza",
    category: "commercial",
  },
  // Toronto City Hall (squat civic)
  {
    offset: [-180, 220],
    size: [110, 80],
    height: 99,
    label: "Toronto City Hall",
    category: "civic",
  },
  // Roy Thomson Hall (low-slung)
  {
    offset: [-260, -180],
    size: [90, 70],
    height: 32,
    label: "Roy Thomson Hall",
    category: "civic",
  },
  // Union Station
  {
    offset: [-60, -360],
    size: [240, 70],
    height: 44,
    label: "Union Station",
    category: "civic",
  },
  // Rogers Centre (oval-ish — modelled as wide square)
  {
    offset: [-460, -550],
    size: [220, 200],
    height: 86,
    label: "Rogers Centre",
    category: "civic",
  },
  // Eaton Centre
  {
    offset: [70, 100],
    size: [70, 240],
    height: 35,
    label: "Eaton Centre",
    category: "commercial",
  },
];

function rotate([x, y]: [number, number], r: number): [number, number] {
  if (!r) return [x, y];
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [x * c - y * s, x * s + y * c];
}

function metersToLngLat(
  origin: LngLat,
  east: number,
  north: number
): LngLat {
  return [origin[0] + east / M_PER_DEG_LNG, origin[1] + north / M_PER_DEG_LAT];
}

function rectFromSpec(spec: BlockSpec, origin: LngLat): Ring {
  const [w, d] = spec.size;
  const corners: [number, number][] = [
    [-w / 2, -d / 2],
    [w / 2, -d / 2],
    [w / 2, d / 2],
    [-w / 2, d / 2],
    [-w / 2, -d / 2],
  ];
  const [ox, oy] = spec.offset;
  return corners.map(([x, y]) => {
    const [rx, ry] = rotate([x, y], spec.rotation ?? 0);
    return metersToLngLat(origin, ox + rx, oy + ry);
  });
}

/** Deterministic mulberry32 PRNG so the demo loads identically every time. */
function rng(seed: number) {
  let t = seed;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * Build a procedural block grid that fills the area around the landmarks
 * with mid-rise + low-rise structures, mimicking the King–Bay corridor.
 */
function generateBlockGrid(seed = 1729): BlockSpec[] {
  const random = rng(seed);
  const blocks: BlockSpec[] = [];

  // Five-by-eight block grid centered on city hall area. Each "block" is
  // 120m square with 25m of street between blocks. Each block contains
  // 3 footprints of varying scale.
  const BLOCK = 120;
  const STREET = 25;
  const cols = 11;
  const rows = 9;

  for (let cy = -rows; cy <= rows; cy++) {
    for (let cx = -cols; cx <= cols; cx++) {
      const blockEast = cx * (BLOCK + STREET);
      const blockNorth = cy * (BLOCK + STREET);

      // Skip blocks that overlap the landmark zone (-300..+150 east, -350..+150 north)
      if (
        blockEast > -350 &&
        blockEast < 200 &&
        blockNorth > -400 &&
        blockNorth < 150
      ) {
        continue;
      }

      // Distance fall-off from downtown core drives heights.
      const dist = Math.sqrt(blockEast * blockEast + blockNorth * blockNorth);
      const distNorm = Math.min(1, dist / 1400);
      const baseHeight = 180 * (1 - distNorm) + 22; // metres

      const buildingsPerBlock = 2 + Math.floor(random() * 3);
      for (let b = 0; b < buildingsPerBlock; b++) {
        const w = 22 + random() * 36;
        const d = 22 + random() * 36;
        const ox = blockEast + (random() - 0.5) * (BLOCK - w);
        const oy = blockNorth + (random() - 0.5) * (BLOCK - d);
        const heightJitter = (random() - 0.3) * baseHeight * 0.9;
        const height = Math.max(12, baseHeight + heightJitter);
        blocks.push({
          offset: [ox, oy],
          size: [w, d],
          height,
          rotation: (random() - 0.5) * 0.12,
          category: random() < 0.55 ? "residential" : "commercial",
        });
      }
    }
  }

  return blocks;
}

function specsToBuildings(
  specs: BlockSpec[],
  origin: LngLat,
  prefix: string
): Building[] {
  return specs.map((spec, idx) => ({
    id: `${prefix}-${idx.toString(36)}`,
    contour: rectFromSpec(spec, origin),
    height: spec.height,
    category: spec.category,
    label: spec.label,
  }));
}

/**
 * Synchronous procedural dataset — used for instant first paint and
 * as fallback when the Open Data API is unreachable.
 */
export function getProceduralToronto(): Building[] {
  const landmarks = specsToBuildings(LANDMARKS, TORONTO_DOWNTOWN_CENTER, "lm");
  const grid = specsToBuildings(
    generateBlockGrid(),
    TORONTO_DOWNTOWN_CENTER,
    "g"
  );
  return [...landmarks, ...grid];
}

/**
 * Raw GeoJSON feature properties from the City of Toronto Open Data
 * "Building Outlines" resource. Field availability varies between
 * vintages of the publish — we treat every property as optional.
 */
interface BuildingFeatureProperties {
  OBJECTID?: number;
  STRUCTURE_ID?: number | string;
  MAP_ID?: string;
  BLDG_USE?: string;
  STATUS?: string;
  NAME?: string;
  /** Some publishes embed metric heights — try every spelling. */
  MAX_HEIGHT?: number;
  MAX_HEIGHT_M?: number;
  AVG_HEIGHT?: number;
  AVG_HEIGHT_M?: number;
  MIN_HEIGHT?: number;
  MIN_HEIGHT_M?: number;
  HEIGHT?: number;
  HEIGHT_M?: number;
  AREA?: number;
  AREA_SQ_M?: number;
  CAPTURE_DATE?: string;
  [key: string]: unknown;
}

type BuildingFeature = {
  type: "Feature";
  properties: BuildingFeatureProperties;
  geometry: {
    type: "Polygon" | "MultiPolygon";
    coordinates: number[][][] | number[][][][];
  } | null;
};

/**
 * Live fetcher. Pulls the published GeoJSON resource, clips features to
 * the requested bbox, and parses each polygon into a `Building` ready
 * for the deck.gl PolygonLayer.
 *
 * Failures (network / CORS / parse) reject the returned promise so
 * callers can render a proper error UI instead of silently swapping
 * in the procedural placeholder.
 */
export async function fetchTorontoBuildings(opts?: {
  signal?: AbortSignal;
  bbox?: BBox;
}): Promise<Building[]> {
  const bbox = opts?.bbox ?? TORONTO_CENTRAL_BBOX;
  // Try the same-origin prefetched copy first, then the live CKAN URL.
  const candidates = [LOCAL_BUILDING_OUTLINES_URL, TORONTO_BUILDING_OUTLINES_URL];
  let lastError: unknown = null;
  for (const url of candidates) {
    try {
      const res = await fetch(url, { signal: opts?.signal });
      if (!res.ok) {
        // 404 on the local path simply means prefetch hasn't run —
        // silently fall through to the upstream URL.
        lastError = new Error(`HTTP ${res.status} from ${url}`);
        continue;
      }
      const geojson = (await res.json()) as {
        type?: string;
        features?: BuildingFeature[];
      };
      if (!geojson || geojson.type !== "FeatureCollection" || !Array.isArray(geojson.features)) {
        throw new Error("Invalid GeoJSON: expected FeatureCollection");
      }
      return parseBuildingsGeoJSON(geojson.features, bbox);
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") throw err;
      lastError = err;
      // try the next URL in the candidate list
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Unable to fetch Toronto building outlines.");
}

/**
 * Parse a Building Outlines GeoJSON FeatureCollection into the flat
 * `Building` records expected by the renderer. Features outside the
 * bbox are skipped (their bounding box can't intersect the clip).
 * MultiPolygon features explode into one Building per ring.
 */
function parseBuildingsGeoJSON(
  features: BuildingFeature[],
  bbox: BBox
): Building[] {
  const out: Building[] = [];
  for (let f = 0; f < features.length; f++) {
    const feature = features[f];
    if (!feature || !feature.geometry) continue;
    const props = feature.properties ?? {};
    const baseId = stableFeatureId(props, f);
    const category = normalizeCategory(props.BLDG_USE);
    const label =
      typeof props.NAME === "string" && props.NAME.trim().length > 0
        ? props.NAME.trim()
        : undefined;
    const declaredHeight = pickDeclaredHeight(props);
    const declaredArea =
      typeof props.AREA_SQ_M === "number"
        ? props.AREA_SQ_M
        : typeof props.AREA === "number"
        ? props.AREA
        : undefined;

    const polygons = extractPolygonRings(feature.geometry);
    for (let p = 0; p < polygons.length; p++) {
      const rings = polygons[p];
      const outer = rings[0];
      if (!outer || outer.length < 4) continue;
      if (!ringIntersectsBBox(outer, bbox)) continue;
      const contour = closeRing(outer);
      const holes = rings.length > 1 ? rings.slice(1).map(closeRing) : undefined;
      const id = polygons.length > 1 ? `${baseId}-${p.toString(36)}` : baseId;
      const height =
        declaredHeight ??
        estimateHeight(contour, declaredArea, id);
      out.push({
        id,
        contour,
        holes,
        height,
        category,
        label,
      });
    }
  }
  return out;
}

/** Pull a stable id from the feature properties (falls back to the row index). */
function stableFeatureId(
  props: BuildingFeatureProperties,
  idx: number
): string {
  if (typeof props.STRUCTURE_ID === "number" || typeof props.STRUCTURE_ID === "string") {
    return `bld-${props.STRUCTURE_ID}`;
  }
  if (typeof props.OBJECTID === "number") {
    return `bld-${props.OBJECTID}`;
  }
  if (typeof props.MAP_ID === "string" && props.MAP_ID.length > 0) {
    return `bld-${props.MAP_ID}-${idx.toString(36)}`;
  }
  return `bld-${idx.toString(36)}`;
}

/** Try every height field spelling published over the years. */
function pickDeclaredHeight(
  props: BuildingFeatureProperties
): number | undefined {
  const candidates: Array<number | undefined> = [
    props.MAX_HEIGHT_M,
    props.MAX_HEIGHT,
    props.HEIGHT_M,
    props.HEIGHT,
    props.AVG_HEIGHT_M,
    props.AVG_HEIGHT,
  ];
  for (const v of candidates) {
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  }
  return undefined;
}

/** Normalise BLDG_USE codes into the limited palette we render. */
function normalizeCategory(use: string | undefined): string | undefined {
  if (!use || typeof use !== "string") return undefined;
  const u = use.toLowerCase();
  if (u.includes("resid")) return "residential";
  if (u.includes("comm") || u.includes("office") || u.includes("retail"))
    return "commercial";
  if (
    u.includes("civic") ||
    u.includes("gov") ||
    u.includes("school") ||
    u.includes("hospital") ||
    u.includes("insti") ||
    u.includes("public")
  )
    return "civic";
  if (u.includes("indust") || u.includes("warehouse")) return "industrial";
  return undefined;
}

/**
 * Bounding-box check on a ring — uses an axis-aligned overlap test
 * against the clipping bbox. Cheap and rejection-friendly: most of the
 * city falls outside any one bbox so we exit on the first ring corner
 * that crosses the threshold.
 */
function ringIntersectsBBox(ring: number[][], bbox: BBox): boolean {
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (let i = 0; i < ring.length; i++) {
    const pt = ring[i];
    if (!pt || pt.length < 2) continue;
    const lng = pt[0];
    const lat = pt[1];
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  if (!Number.isFinite(minLng)) return false;
  if (maxLng < bbox.minLng || minLng > bbox.maxLng) return false;
  if (maxLat < bbox.minLat || minLat > bbox.maxLat) return false;
  return true;
}

/** Extract every polygon (outer + holes) from a Polygon | MultiPolygon. */
function extractPolygonRings(
  geom: NonNullable<BuildingFeature["geometry"]>
): number[][][][] {
  if (geom.type === "Polygon") {
    return [geom.coordinates as number[][][]];
  }
  if (geom.type === "MultiPolygon") {
    return geom.coordinates as number[][][][];
  }
  return [];
}

/** Ensure the ring is closed (first point repeated at the end). */
function closeRing(ring: number[][]): Ring {
  const out: Ring = ring.map(([lng, lat]) => [lng, lat] as LngLat);
  if (out.length > 0) {
    const first = out[0];
    const last = out[out.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      out.push([first[0], first[1]]);
    }
  }
  return out;
}

/**
 * Deterministic height estimator for outlines that don't ship a
 * MAX_HEIGHT property. Combines:
 *   - footprint area (bigger plates → taller cores in the financial dist),
 *   - distance from City Hall (heights drop off toward the lake / suburbs),
 *   - a per-id hash for stable jitter so the skyline isn't a flat plate.
 */
function estimateHeight(
  contour: Ring,
  declaredArea: number | undefined,
  id: string
): number {
  const [cLng, cLat] = ringCentroid(contour);
  const dLng = (cLng - TORONTO_DOWNTOWN_CENTER[0]) * M_PER_DEG_LNG;
  const dLat = (cLat - TORONTO_DOWNTOWN_CENTER[1]) * M_PER_DEG_LAT;
  const distM = Math.hypot(dLng, dLat);
  const distNorm = Math.min(1, distM / 4500);
  const areaSqM =
    typeof declaredArea === "number" && declaredArea > 0
      ? declaredArea
      : approxRingAreaSqMeters(contour);
  const areaScore = Math.min(1, Math.log10(Math.max(50, areaSqM)) / 4); // 0..1
  const base = 14 + (1 - distNorm) * 165 + areaScore * 70;
  const jitter = (hashUnit(id) - 0.4) * base * 0.55;
  return Math.max(8, base + jitter);
}

function ringCentroid(ring: Ring): LngLat {
  let lng = 0;
  let lat = 0;
  const n = ring.length - 1; // last point repeats first
  if (n <= 0) return TORONTO_DOWNTOWN_CENTER;
  for (let i = 0; i < n; i++) {
    lng += ring[i][0];
    lat += ring[i][1];
  }
  return [lng / n, lat / n];
}

function approxRingAreaSqMeters(ring: Ring): number {
  // Shoelace in metres after equirectangular projection through the centroid.
  if (ring.length < 4) return 0;
  const [cLng, cLat] = ringCentroid(ring);
  const cosLat = Math.cos((cLat * Math.PI) / 180);
  let sum = 0;
  for (let i = 0, j = ring.length - 2; i < ring.length - 1; j = i++) {
    const xi = (ring[i][0] - cLng) * 111_320 * cosLat;
    const yi = (ring[i][1] - cLat) * 111_320;
    const xj = (ring[j][0] - cLng) * 111_320 * cosLat;
    const yj = (ring[j][1] - cLat) * 111_320;
    sum += xj * yi - xi * yj;
  }
  return Math.abs(sum) / 2;
}

/** Cheap string-hash → [0,1) for stable per-id jitter. */
function hashUnit(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

/** Index buildings by id for O(1) lookup during stream updates. */
export function indexById(buildings: Building[]): Map<string, Building> {
  const m = new Map<string, Building>();
  for (const b of buildings) m.set(b.id, b);
  return m;
}

/** Public list of named landmarks for the search/jump-to UI. */
export function listLandmarks(buildings: Building[]) {
  return buildings.filter((b) => !!b.label);
}
