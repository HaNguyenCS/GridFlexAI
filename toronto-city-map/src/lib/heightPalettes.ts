/**
 * Height color palette presets for building visualization.
 * Each palette has 3 stops: low (short buildings), mid (mid-rise), high (tall buildings).
 * Designed for observability dashboard: distinct, purposeful, avoids clichés.
 */

export interface HeightPalette {
  id: string;
  name: string;
  description: string;
  stops: [string, string, string]; // [low, mid, high] hex colors
}

/**
 * Curated palette collection with complementary color relationships.
 * Each palette uses color theory principles for visual harmony:
 * - Elevation: blue-white elevation (deep navy to pure white)
 * - Solar: warm analogous (red-orange-yellow)
 * - RGB: triadic complement (blue-cyan-green)
 * - Blue: monochromatic depth (navy-steel-cream)
 * - Monochrome: neutral value scale
 * - Inferno: split-complementary (purple-red-orange)
 */
export const HEIGHT_PALETTES: HeightPalette[] = [
  {
    id: 'elevation',
    name: 'Elevation',
    description: 'Blue-white elevation visualization',
    stops: ['#0a1628', '#4a90d9', '#ffffff'], // Deep navy → steel blue → pure white
  },
  {
    id: 'solar',
    name: 'Solar',
    description: 'Warm analogous gradient',
    stops: ['#2d1b69', '#f72585', '#ffd60a'], // Deep purple → magenta → gold
  },
  {
    id: 'rgb',
    name: 'RGB',
    description: 'Triadic spectral',
    stops: ['#0a0e27', '#4361ee', '#4cc9f0'], // Navy → blue → cyan
  },
  {
    id: 'blue',
    name: 'Blue',
    description: 'Monochromatic depth',
    stops: ['#03045e', '#0077b6', '#caf0f8'], // Deep navy → ocean → ice
  },
  {
    id: 'monochrome',
    name: 'Mono',
    description: 'Neutral value scale',
    stops: ['#212529', '#6c757d', '#f8f9fa'], // Charcoal → gray → white
  },
  {
    id: 'inferno',
    name: 'Inferno',
    description: 'Split complementary',
    stops: ['#10002b', '#c1121f', '#f77f00'], // Indigo → crimson → amber
  },
];

/**
 * Get palette by ID, defaults to 'elevation' if not found.
 */
export function getPalette(id: string): HeightPalette {
  return HEIGHT_PALETTES.find((p) => p.id === id) || HEIGHT_PALETTES[0];
}

/**
 * Convert hex color to RGB array.
 */
function hexToRgb(hex: string): [number, number, number] {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return [0, 0, 0];
  return [
    parseInt(result[1], 16),
    parseInt(result[2], 16),
    parseInt(result[3], 16),
  ];
}

/**
 * Interpolate through 3 color stops based on normalized height (0-1).
 * Uses two-segment linear interpolation: 0-0.5 (low-mid) and 0.5-1 (mid-high).
 */
export function interpolatePalette(
  t: number,
  palette: HeightPalette
): [number, number, number, number] {
  const clampedT = Math.min(1, Math.max(0, t));
  const [low, mid, high] = palette.stops.map(hexToRgb);

  let rgb: [number, number, number];
  if (clampedT < 0.5) {
    const localT = clampedT * 2;
    rgb = [
      Math.round(low[0] + (mid[0] - low[0]) * localT),
      Math.round(low[1] + (mid[1] - low[1]) * localT),
      Math.round(low[2] + (mid[2] - low[2]) * localT),
    ];
  } else {
    const localT = (clampedT - 0.5) * 2;
    rgb = [
      Math.round(mid[0] + (high[0] - mid[0]) * localT),
      Math.round(mid[1] + (high[1] - mid[1]) * localT),
      Math.round(mid[2] + (high[2] - mid[2]) * localT),
    ];
  }

  return [...rgb, 230];
}
