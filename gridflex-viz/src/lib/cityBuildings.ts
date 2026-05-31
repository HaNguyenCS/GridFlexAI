export type LngLat = [number, number];
export type Ring = LngLat[];

export interface CityBuilding {
  id: string;
  contour: Ring;
  height: number;
  category?: string;
  label?: string;
}

const TORONTO_CENTER: LngLat = [-79.3832, 43.6532];

const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LNG = 111_320 * Math.cos((43.65 * Math.PI) / 180);

interface BuildingSpec {
  offset: [number, number];
  size: [number, number];
  height: number;
  rotation?: number;
  category?: string;
  label?: string;
}

const LANDMARKS: BuildingSpec[] = [
  {
    offset: [-260, -480],
    size: [42, 42],
    height: 553,
    label: "CN Tower",
    category: "civic",
  },
  {
    offset: [-90, -110],
    size: [70, 70],
    height: 298,
    label: "First Canadian Place",
    category: "commercial",
  },
  {
    offset: [10, -90],
    size: [55, 60],
    height: 275,
    label: "Scotia Plaza",
    category: "commercial",
  },
  {
    offset: [-30, -180],
    size: [60, 50],
    height: 261,
    label: "TD Canada Trust Tower",
    category: "commercial",
  },
  {
    offset: [60, -150],
    size: [55, 55],
    height: 239,
    label: "Commerce Court West",
    category: "commercial",
  },
  {
    offset: [-30, 0],
    size: [60, 60],
    height: 218,
    label: "Bay Adelaide West",
    category: "commercial",
  },
  {
    offset: [350, -230],
    size: [40, 40],
    height: 205,
    label: "L Tower",
    category: "residential",
  },
  {
    offset: [110, -40],
    size: [50, 50],
    height: 277,
    label: "Adelaide Hotel",
    category: "residential",
  },
  {
    offset: [-10, -260],
    size: [55, 50],
    height: 180,
    label: "Royal Bank Plaza",
    category: "commercial",
  },
  {
    offset: [-180, 220],
    size: [110, 80],
    height: 99,
    label: "Toronto City Hall",
    category: "civic",
  },
  {
    offset: [-260, -180],
    size: [90, 70],
    height: 32,
    label: "Roy Thomson Hall",
    category: "civic",
  },
  {
    offset: [-60, -360],
    size: [240, 70],
    height: 44,
    label: "Union Station",
    category: "civic",
  },
  {
    offset: [-460, -550],
    size: [220, 200],
    height: 86,
    label: "Rogers Centre",
    category: "civic",
  },
  {
    offset: [70, 100],
    size: [70, 240],
    height: 35,
    label: "Eaton Centre",
    category: "commercial",
  },
];

function rng(seed: number) {
  let t = seed;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function rotate([x, y]: [number, number], r: number): [number, number] {
  if (!r) return [x, y];
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [x * c - y * s, x * s + y * c];
}

function metersToLngLat(origin: LngLat, east: number, north: number): LngLat {
  return [origin[0] + east / M_PER_DEG_LNG, origin[1] + north / M_PER_DEG_LAT];
}

function rectFromSpec(spec: BuildingSpec, origin: LngLat): Ring {
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

function generateBlockGrid(seed = 1729): BuildingSpec[] {
  const random = rng(seed);
  const blocks: BuildingSpec[] = [];

  const block = 120;
  const street = 25;
  const cols = 12;
  const rows = 10;

  for (let cy = -rows; cy <= rows; cy++) {
    for (let cx = -cols; cx <= cols; cx++) {
      const blockEast = cx * (block + street);
      const blockNorth = cy * (block + street);

      if (
        blockEast > -350 &&
        blockEast < 200 &&
        blockNorth > -400 &&
        blockNorth < 150
      ) {
        continue;
      }

      const dist = Math.sqrt(blockEast * blockEast + blockNorth * blockNorth);
      const distNorm = Math.min(1, dist / 1500);
      const baseHeight = 185 * (1 - distNorm) + 18;

      const buildingsPerBlock = 2 + Math.floor(random() * 3);

      for (let b = 0; b < buildingsPerBlock; b++) {
        const w = 22 + random() * 38;
        const d = 22 + random() * 38;
        const ox = blockEast + (random() - 0.5) * (block - w);
        const oy = blockNorth + (random() - 0.5) * (block - d);
        const heightJitter = (random() - 0.3) * baseHeight * 0.9;
        const height = Math.max(10, baseHeight + heightJitter);

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
  specs: BuildingSpec[],
  origin: LngLat,
  prefix: string
): CityBuilding[] {
  return specs.map((spec, idx) => ({
    id: `${prefix}-${idx.toString(36)}`,
    contour: rectFromSpec(spec, origin),
    height: spec.height,
    category: spec.category,
    label: spec.label,
  }));
}

export function getProceduralTorontoBuildings(): CityBuilding[] {
  const landmarks = specsToBuildings(LANDMARKS, TORONTO_CENTER, "landmark");
  const grid = specsToBuildings(generateBlockGrid(), TORONTO_CENTER, "building");
  return [...landmarks, ...grid];
}
