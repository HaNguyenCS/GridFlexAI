// Toronto annual energy consumption layer.
//
// Source: City of Toronto Open Data — "Annual Energy Consumption
// [City Owned/Operated Buildings]"
// https://open.toronto.ca/dataset/annual-energy-consumption/
//
// The dataset is published exclusively as XLSX, one resource per
// year, covering electricity / natural gas / chilled water / steam
// consumption for ~1,500 city-owned buildings. The records are keyed
// by operation name / address — there is no spatial geometry or
// building identifier we can join directly to the Building Outlines
// geometry on the canvas.
//
// Strategy:
//   1. Hit `package_show` to discover the latest yearly resource.
//   2. Download + parse the XLSX with SheetJS in the browser.
//   3. Aggregate the dataset into a single energy-intensity figure
//      (kWh per square metre per year) plus per-category averages.
//   4. Use that intensity to estimate consumption for every rendered
//      building footprint via `footprintArea × storeys × intensity`.
//   5. Surface the year + aggregate totals in the legend panel so
//      the visualisation stays anchored to real numbers even though
//      the per-building values are model-derived.

import * as XLSX from "xlsx";

import type { Building, LngLat, Ring } from "./types";

const PACKAGE_SHOW_URL =
  "https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/package_show?id=annual-energy-consumption";

/**
 * Same-origin manifest written by `npm run prefetch`. When present it
 * contains the path + year of the locally-cached XLSX so the browser
 * can avoid CORS on CKAN entirely.
 */
const LOCAL_MANIFEST_URL = "/data/manifest.json";

interface LocalManifest {
  entries?: Record<
    string,
    {
      path?: string;
      source?: string;
      meta?: { year?: number; resourceName?: string };
    }
  >;
}

/** Result of a successful fetch + parse. */
export interface EnergyDataset {
  /** Reporting year for the resource we ingested. */
  year: number;
  /** Resource title (e.g. "annual-energy-consumption-data-2023"). */
  resourceName: string;
  /** Direct URL to the XLSX we parsed. */
  resourceUrl: string;
  /** Number of building records in the workbook. */
  recordCount: number;
  /** Total electricity consumption across the dataset, kWh. */
  totalElectricityKWh: number;
  /** Total natural gas consumption converted to kWh-equivalent. */
  totalGasKWhEq: number;
  /** Total floor area covered, square metres. */
  totalFloorAreaSqM: number;
  /** Combined energy intensity, kWh per square metre per year. */
  intensityKWhPerSqM: number;
  /** Per-operation-type intensity, used as a category multiplier. */
  intensityByCategory: Record<string, number>;
  /** P5..P95 of per-record intensity, used to set the colour ramp domain. */
  intensityP5: number;
  intensityP95: number;
}

/** Per-building energy estimate, used by the renderer. */
export interface BuildingEnergy {
  /** Estimated annual consumption, kWh. */
  kWh: number;
  /** Energy intensity in kWh / m² used to drive the colour. */
  intensityKWhPerSqM: number;
  /** Normalised value in [0,1] mapped against the dataset domain. */
  normalised: number;
}

interface CkanResource {
  id: string;
  name: string;
  format: string;
  url: string;
  position: number;
}

interface CkanPackageShow {
  success: boolean;
  result: { resources: CkanResource[] };
}

/**
 * Fetch the latest yearly energy consumption resource and parse it
 * into an aggregate `EnergyDataset`. Returns null on any failure
 * (network, CORS, schema drift) so callers can keep their fallback
 * visualisation intact.
 */
export async function fetchEnergyDataset(opts?: {
  signal?: AbortSignal;
}): Promise<EnergyDataset | null> {
  // Path 1: same-origin prefetch manifest (preferred — no CORS).
  const local = await tryLocalEnergy(opts?.signal);
  if (local) return local;

  // Path 2: live CKAN discovery + download.
  try {
    const meta = await fetch(PACKAGE_SHOW_URL, { signal: opts?.signal });
    if (!meta.ok) throw new Error(`package_show ${meta.status}`);
    const pkg = (await meta.json()) as CkanPackageShow;
    const resources = pkg?.result?.resources ?? [];
    const yearly = resources
      .map((r) => ({ r, year: extractYear(r.name) }))
      .filter(
        (e): e is { r: CkanResource; year: number } =>
          e.year !== null && /xlsx$/i.test(e.r.format)
      )
      .sort((a, b) => b.year - a.year);
    if (yearly.length === 0) {
      throw new Error("No yearly XLSX resources discovered");
    }
    // Walk newest → oldest until one parses successfully. Some years
    // ship empty / malformed sheets; this fallback keeps us resilient.
    for (const entry of yearly) {
      try {
        const xlsx = await fetch(entry.r.url, { signal: opts?.signal });
        if (!xlsx.ok) continue;
        const buf = await xlsx.arrayBuffer();
        const dataset = parseEnergyWorkbook(buf, entry.year, entry.r);
        if (dataset && dataset.recordCount > 0) return dataset;
      } catch (innerErr) {
        if ((innerErr as { name?: string })?.name === "AbortError") throw innerErr;
        // try the next year
      }
    }
    throw new Error("All yearly resources failed to parse");
  } catch (err) {
    if ((err as { name?: string })?.name !== "AbortError") {
      console.warn("Energy dataset fetch failed:", err);
    }
    return null;
  }
}

/**
 * Read the prefetch manifest and, if it points at a locally cached
 * XLSX, parse that file directly. Returns null if anything is missing
 * — the caller will then fall back to the live CKAN endpoint.
 */
async function tryLocalEnergy(
  signal: AbortSignal | undefined
): Promise<EnergyDataset | null> {
  try {
    const res = await fetch(LOCAL_MANIFEST_URL, { signal });
    if (!res.ok) return null;
    const manifest = (await res.json()) as LocalManifest;
    const entry = manifest.entries?.energy;
    if (!entry?.path) return null;
    const xlsx = await fetch(entry.path, { signal });
    if (!xlsx.ok) return null;
    const buf = await xlsx.arrayBuffer();
    const year =
      typeof entry.meta?.year === "number"
        ? entry.meta.year
        : extractYear(entry.meta?.resourceName) ?? new Date().getFullYear();
    const fakeResource: CkanResource = {
      id: "local",
      name: entry.meta?.resourceName ?? `annual-energy-consumption-${year}`,
      format: "XLSX",
      url: entry.source ?? entry.path,
      position: 0,
    };
    const dataset = parseEnergyWorkbook(buf, year, fakeResource);
    if (dataset && dataset.recordCount > 0) return dataset;
    return null;
  } catch (err) {
    if ((err as { name?: string })?.name === "AbortError") throw err;
    return null;
  }
}

/** Pull a 4-digit year out of a CKAN resource name like `*-data-2023`. */
function extractYear(name: string | undefined): number | null {
  if (!name) return null;
  const match = name.match(/(20\d{2})/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

/** Parse an XLSX ArrayBuffer into an `EnergyDataset`. */
function parseEnergyWorkbook(
  buf: ArrayBuffer,
  year: number,
  resource: CkanResource
): EnergyDataset | null {
  const wb = XLSX.read(buf, { type: "array" });
  // Some workbooks ship a "Cover" or "ReadMe" sheet first — pick the
  // sheet with the most data rows.
  let bestRows: Record<string, unknown>[] = [];
  let bestSheet = wb.SheetNames[0];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const rows = sheetToObjects(ws);
    if (rows.length > bestRows.length) {
      bestRows = rows;
      bestSheet = name;
    }
  }
  if (bestRows.length === 0) return null;

  const electricityKey = pickKey(bestRows[0], [
    /electric.*\(?kwh\)?/i,
    /electric.*quantity/i,
    /electricity/i,
  ]);
  const gasKey = pickKey(bestRows[0], [
    /natural\s*gas.*\(?m\^?3\)?/i,
    /natural\s*gas.*quantity/i,
    /natural\s*gas/i,
  ]);
  const areaKey = pickKey(bestRows[0], [
    /total\s*floor\s*area/i,
    /floor\s*area.*sq.*ft/i,
    /floor\s*area/i,
    /gross.*area/i,
  ]);
  const areaUnitKey = pickKey(bestRows[0], [/floor\s*area\s*unit/i, /area\s*unit/i]);
  const typeKey = pickKey(bestRows[0], [/operation\s*type/i, /building\s*type/i, /type/i]);

  // Natural gas in m³ converts to ~10.55 kWh / m³ (HHV for typical NG).
  const NG_KWH_PER_M3 = 10.55;

  let totalElec = 0;
  let totalGas = 0;
  let totalArea = 0;
  let recordCount = 0;
  const byCategory = new Map<string, { kwh: number; area: number }>();
  const intensities: number[] = [];

  for (const row of bestRows) {
    const elec = electricityKey ? toNumber(row[electricityKey]) : 0;
    const gas = gasKey ? toNumber(row[gasKey]) : 0;
    const areaRaw = areaKey ? toNumber(row[areaKey]) : 0;
    const unit = areaUnitKey ? String(row[areaUnitKey] ?? "") : "";
    if (!elec && !gas) continue;
    const areaSqM = normaliseAreaToSqM(areaRaw, unit);
    if (areaSqM <= 1) continue;
    const energyKWh = elec + gas * NG_KWH_PER_M3;
    if (!Number.isFinite(energyKWh) || energyKWh <= 0) continue;
    totalElec += elec;
    totalGas += gas;
    totalArea += areaSqM;
    recordCount += 1;
    intensities.push(energyKWh / areaSqM);
    const cat = normaliseOperationType(typeKey ? String(row[typeKey] ?? "") : "");
    const slot = byCategory.get(cat) ?? { kwh: 0, area: 0 };
    slot.kwh += energyKWh;
    slot.area += areaSqM;
    byCategory.set(cat, slot);
  }

  if (recordCount === 0 || totalArea <= 0) {
    console.warn(`Energy workbook ${bestSheet} parsed 0 usable rows`);
    return null;
  }

  const totalEnergyKWh = totalElec + totalGas * NG_KWH_PER_M3;
  const intensityKWhPerSqM = totalEnergyKWh / totalArea;

  // Compute per-category intensity, falling back to the global mean.
  const intensityByCategory: Record<string, number> = {};
  for (const [cat, v] of byCategory) {
    intensityByCategory[cat] = v.kwh / Math.max(1, v.area);
  }

  intensities.sort((a, b) => a - b);
  const p5 = percentile(intensities, 0.05);
  const p95 = percentile(intensities, 0.95);

  return {
    year,
    resourceName: resource.name,
    resourceUrl: resource.url,
    recordCount,
    totalElectricityKWh: totalElec,
    totalGasKWhEq: totalGas * NG_KWH_PER_M3,
    totalFloorAreaSqM: totalArea,
    intensityKWhPerSqM,
    intensityByCategory,
    intensityP5: p5,
    intensityP95: p95,
  };
}

/** Convert a worksheet to JSON objects with the first non-empty row as header. */
function sheetToObjects(ws: XLSX.WorkSheet): Record<string, unknown>[] {
  // SheetJS' default `sheet_to_json` infers headers from row 1, but a few
  // of these workbooks prefix with a banner row. Iterate until we land
  // on the real header.
  for (let header = 0; header < 6; header++) {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
      range: header,
      defval: "",
      blankrows: false,
    });
    if (rows.length === 0) continue;
    const keys = Object.keys(rows[0]);
    const looksLikeHeader = keys.some((k) =>
      /(electric|gas|floor.*area|operation|address)/i.test(k)
    );
    if (looksLikeHeader) return rows;
  }
  // Fall back to the default behaviour.
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    defval: "",
    blankrows: false,
  });
}

/** Find the first column key matching any of the supplied regexes. */
function pickKey(
  sample: Record<string, unknown>,
  patterns: RegExp[]
): string | null {
  const keys = Object.keys(sample);
  for (const pat of patterns) {
    for (const k of keys) if (pat.test(k)) return k;
  }
  return null;
}

function toNumber(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const cleaned = v.replace(/[, ]/g, "").trim();
    if (!cleaned) return 0;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function normaliseAreaToSqM(value: number, unit: string): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const u = unit.toLowerCase();
  if (u.includes("ft") || u.includes("sqft")) return value * 0.092903;
  return value; // assume m² when the unit isn't declared
}

/** Map "Library", "Fire Hall", etc. into the renderer's coarse buckets. */
function normaliseOperationType(raw: string): string {
  const u = raw.toLowerCase();
  if (!u) return "civic";
  if (u.includes("library") || u.includes("court") || u.includes("city hall"))
    return "civic";
  if (u.includes("fire") || u.includes("police") || u.includes("ambulance"))
    return "civic";
  if (u.includes("pool") || u.includes("rink") || u.includes("arena"))
    return "civic";
  if (u.includes("comm") || u.includes("office") || u.includes("retail"))
    return "commercial";
  if (u.includes("shelter") || u.includes("housing") || u.includes("resid"))
    return "residential";
  if (u.includes("yard") || u.includes("garage") || u.includes("indust"))
    return "industrial";
  return "civic";
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * q)));
  return sorted[idx];
}

// ---------------------------------------------------------------------------
// Per-building estimation
// ---------------------------------------------------------------------------

/**
 * Estimate annual kWh per building using the dataset-derived intensity.
 * footprintArea_m² × storeys × categoryIntensity gives a usable proxy
 * that respects the real distribution of city buildings even though
 * we can't join records 1:1.
 */
export function buildEnergyIndex(
  buildings: Building[],
  dataset: EnergyDataset
): Map<string, BuildingEnergy> {
  const byId = new Map<string, BuildingEnergy>();
  if (buildings.length === 0) return byId;

  const intensities: number[] = [];
  const tmp: Array<{
    id: string;
    intensity: number;
    floorArea: number;
  }> = [];

  for (const b of buildings) {
    const footprint = approxRingAreaSqM(b.contour);
    if (footprint <= 0) continue;
    const storeys = Math.max(1, Math.round(b.height / 3.2));
    const floorArea = footprint * storeys;
    const cat = b.category ?? "civic";
    const baseIntensity =
      dataset.intensityByCategory[cat] ?? dataset.intensityKWhPerSqM;
    // Light per-id jitter (±15%) so neighbouring buildings aren't flat.
    const jitter = 0.85 + 0.3 * hashUnit(b.id);
    const intensity = baseIntensity * jitter;
    intensities.push(intensity);
    tmp.push({ id: b.id, intensity, floorArea });
  }

  // Build a colour-mapping domain from this distribution rather than
  // the dataset's own P5/P95, so the on-screen ramp uses the full range
  // of values actually shown.
  intensities.sort((a, b) => a - b);
  const lo = percentile(intensities, 0.05);
  const hi = percentile(intensities, 0.95);
  const span = Math.max(1, hi - lo);

  for (const t of tmp) {
    const norm = Math.max(0, Math.min(1, (t.intensity - lo) / span));
    byId.set(t.id, {
      kWh: t.intensity * t.floorArea,
      intensityKWhPerSqM: t.intensity,
      normalised: norm,
    });
  }
  return byId;
}

/** Equirectangular shoelace area in square metres. Same formula as buildings.ts. */
function approxRingAreaSqM(ring: Ring): number {
  if (ring.length < 4) return 0;
  let cLng = 0;
  let cLat = 0;
  const n = ring.length - 1;
  for (let i = 0; i < n; i++) {
    cLng += ring[i][0];
    cLat += ring[i][1];
  }
  cLng /= n;
  cLat /= n;
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

function hashUnit(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

// ---------------------------------------------------------------------------
// Energy colour ramp — magma-ish: deep violet → orange → yellow.
// Distinct enough from the cool building-height ramp that the eye can
// read the toggle without re-checking the legend.
// ---------------------------------------------------------------------------

const ENERGY_STOPS: Array<[number, number, number]> = [
  [22, 14, 56], // deep indigo
  [86, 30, 94], // violet
  [180, 50, 92], // magenta
  [232, 120, 60], // orange
  [248, 220, 110], // warm yellow
];

function rampSample(t: number): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, t));
  const seg = clamped * (ENERGY_STOPS.length - 1);
  const idx = Math.min(ENERGY_STOPS.length - 2, Math.floor(seg));
  const local = seg - idx;
  const a = ENERGY_STOPS[idx];
  const b = ENERGY_STOPS[idx + 1];
  return [
    Math.round(a[0] + (b[0] - a[0]) * local),
    Math.round(a[1] + (b[1] - a[1]) * local),
    Math.round(a[2] + (b[2] - a[2]) * local),
  ];
}

/** Energy-encoded fill for deck.gl. Returns RGBA. */
export function energyToColor(t: number): [number, number, number, number] {
  const [r, g, b] = rampSample(t);
  return [r, g, b, 232];
}

/** Same ramp as a CSS `rgb()` string for the legend strip. */
export function energyToCss(t: number): string {
  const [r, g, b] = rampSample(t);
  return `rgb(${r}, ${g}, ${b})`;
}

/** A handful of representative samples for the legend strip. */
export function sampleEnergyRamp(steps = 24): string[] {
  return Array.from({ length: steps }, (_, i) => energyToCss(i / (steps - 1)));
}

/** Format kWh with a sensible unit (kWh / MWh / GWh). */
export function formatKWh(kwh: number): string {
  if (!Number.isFinite(kwh) || kwh <= 0) return "—";
  if (kwh >= 1_000_000) return `${(kwh / 1_000_000).toFixed(1)} GWh`;
  if (kwh >= 1_000) return `${(kwh / 1_000).toFixed(1)} MWh`;
  return `${Math.round(kwh).toLocaleString()} kWh`;
}

// Re-export `LngLat` so callers don't need to plumb types.ts directly.
export type { LngLat };
