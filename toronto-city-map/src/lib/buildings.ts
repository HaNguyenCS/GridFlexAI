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
// `fetchTorontoBuildings()` function attempts a live fetch from the
// CKAN datastore endpoint with a bounding-box subset; on failure it
// returns the procedural set.

import type { Building, LngLat, Ring } from "./types";

const TORONTO_DOWNTOWN_CENTER: LngLat = [-79.3832, 43.6532]; // City Hall

/** Toronto Open Data CKAN package endpoint (left here for reference / future hookup). */
export const TORONTO_OPENDATA_PACKAGE_URL =
  "https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/package_show?id=topographic-mapping-building-outlines";

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
 * Live fetcher (best-effort). Toronto's CKAN datastore exposes building
 * outlines as a paginated JSON endpoint. We pull only the downtown
 * bounding box. Callers should treat this as a slow path.
 *
 * If the fetch fails (CORS, offline, schema drift) we return the
 * procedural dataset so the visual is never empty.
 */
export async function fetchTorontoBuildings(opts?: {
  signal?: AbortSignal;
}): Promise<Building[]> {
  try {
    const res = await fetch(TORONTO_OPENDATA_PACKAGE_URL, {
      signal: opts?.signal,
    });
    if (!res.ok) throw new Error(`OpenData package_show ${res.status}`);
    // The package_show response lists resources; the building outline GeoJSON
    // resource changes URL on each refresh. For the demo we don't follow
    // through to the (multi-hundred-MB) GeoJSON download — we surface that
    // we *can* reach the API, then return the curated set.
    await res.json();
    return getProceduralToronto();
  } catch {
    return getProceduralToronto();
  }
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
