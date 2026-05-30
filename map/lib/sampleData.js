// Synthetic regional dataset over DOWNTOWN TORONTO neighborhoods.
// Each row represents one micro-region with three normalized scores (0-100):
//   risk    — composite incident / safety index (higher = riskier)
//   price   — relative cost of living / commerce density (higher = pricier)
//   traffic — pedestrian + vehicle throughput (higher = busier)
//
// All coordinates are real, scores are deterministically generated from a
// seeded pseudo-random function so results are reproducible without runtime randomness.

const SEED = 0x1f3b9a;
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const score = (base, spread) =>
  Math.max(0, Math.min(100, Math.round(base + (rand() - 0.5) * spread)));

// Neighborhood centroids (label, lat, lng, riskBase, priceBase, trafficBase)
// Focused on downtown Toronto and inner-city wards.
const REGIONS = [
  // Core / Financial
  ['Financial District', 43.6486, -79.3814, 28, 96, 94],
  ['Bay Street Corridor', 43.6534, -79.3839, 30, 92, 92],
  ['PATH / Union', 43.6453, -79.3806, 32, 88, 98],
  ['Harbourfront', 43.6385, -79.3811, 22, 86, 76],
  ['CityPlace', 43.6419, -79.3925, 24, 84, 78],
  ['Entertainment District', 43.6465, -79.3893, 46, 90, 92],
  ['King West', 43.6448, -79.3987, 36, 92, 88],
  ['Liberty Village', 43.6386, -79.4202, 28, 82, 74],
  // Old Town / East Core

  ['St. Lawrence', 43.6489, -79.3717, 26, 86, 78],
  ['Old Town', 43.6515, -79.3711, 28, 84, 72],
  ['Distillery District', 43.6503, -79.3597, 22, 88, 70],
  ['Corktown', 43.6560, -79.3603, 30, 78, 60],
  ['Riverside', 43.6597, -79.3450, 30, 76, 58],
  ['Leslieville', 43.6645, -79.3358, 26, 80, 60],
  // Yonge spine
  ['Downtown Yonge', 43.6555, -79.3805, 52, 84, 99],
  ['Yonge-Dundas Sq.', 43.6562, -79.3804, 64, 82, 100],
  ['Garden District', 43.6580, -79.3758, 50, 72, 78],
  ['Moss Park', 43.6586, -79.3724, 70, 60, 70],
  ['Regent Park', 43.6606, -79.3637, 64, 58, 64],
  ['Cabbagetown', 43.6678, -79.3673, 28, 80, 56],
  ['Church-Wellesley', 43.6651, -79.3835, 40, 78, 84],
  ['Rosedale', 43.6790, -79.3809, 14, 94, 50],
  // West / arts
  ['Discovery District', 43.6602, -79.3893, 26, 78, 80],
  ['University', 43.6629, -79.3957, 24, 76, 70],
  ['Grange Park', 43.6519, -79.3936, 36, 74, 76],
  ['Chinatown', 43.6532, -79.3987, 50, 66, 90],
  ['Kensington Market', 43.6547, -79.4011, 44, 68, 82],
  ['Queen West', 43.6479, -79.4082, 42, 80, 84],
  ['Trinity-Bellwoods', 43.6479, -79.4148, 30, 78, 70],
  ['West Queen West', 43.6432, -79.4192, 38, 82, 74],
  ['Little Portugal', 43.6479, -79.4291, 34, 70, 64],
  ['Dundas West', 43.6557, -79.4365, 36, 72, 66],
  ['Dovercourt', 43.6586, -79.4307, 34, 66, 56],
  ['Parkdale', 43.6385, -79.4344, 56, 60, 64],
  ['Junction Triangle', 43.6635, -79.4427, 30, 64, 52],
  // North of Bloor
  ['Yorkville', 43.6708, -79.3893, 16, 98, 70],
  ['The Annex', 43.6677, -79.4060, 24, 84, 64],
  ['Koreatown', 43.6649, -79.4143, 32, 70, 66],
  ['Christie Pits', 43.6648, -79.4204, 30, 68, 56],
  ['Forest Hill (S)', 43.6917, -79.4156, 12, 96, 48],
  ['Greektown', 43.6770, -79.3517, 26, 76, 64]
];

const FIELDS = [
  { name: 'region', format: '', type: 'string' },
  { name: 'lat', format: '', type: 'real' },
  { name: 'lng', format: '', type: 'real' },
  { name: 'risk', format: '', type: 'integer' },
  { name: 'price', format: '', type: 'integer' },
  { name: 'traffic', format: '', type: 'integer' }
];

// Densify each region into ~8 weighted sample points so heatmap kernels +
// hex aggregation render as organic regional density rather than isolated pixels.
function densifyRegion([label, lat, lng, riskBase, priceBase, trafficBase]) {
  const samples = 8;
  const radius = 0.0045; // ~450m, tuned for downtown TO scale
  const rows = [];
  for (let i = 0; i < samples; i++) {
    const dLat = (rand() - 0.5) * radius;
    const dLng = (rand() - 0.5) * radius * 1.35;
    rows.push([
      label,
      +(lat + dLat).toFixed(6),
      +(lng + dLng).toFixed(6),
      score(riskBase, 14),
      score(priceBase, 10),
      score(trafficBase, 12)
    ]);
  }
  return rows;
}

const ROWS = REGIONS.flatMap(densifyRegion);

export const REGION_DATASET = {
  fields: FIELDS,
  rows: ROWS
};

// Region-level summary used by the side panel (one entry per region).
export const REGION_SUMMARY = REGIONS.map(
  ([label, lat, lng, r, p, t]) => ({
    label,
    lat,
    lng,
    risk: r,
    price: p,
    traffic: t
  })
);

export const DATASET_ID = 'region_scores';
