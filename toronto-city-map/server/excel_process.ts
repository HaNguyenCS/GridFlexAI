// Excel → GeoJSON conversion library for Toronto energy consumption data.
//
// Converts annual-energy-consumption XLSX files under `server/data/` into
// GeoJSON FeatureCollections with Point geometries, geocoding each record's
// street address via the Government of Canada geolocator API.
//
// Handles two workbook schemas:
//   - **Legacy (2011-2019)**: flat government reporting template with a
//     banner header and a single data sheet. Columns include Operation Name,
//     Operation Type, Address, City, Postal Code, Total Floor Area, and
//     per-fuel consumption quantities.
//   - **Portfolio Manager (2020+)**: multi-sheet export with a "Properties"
//     sheet (addresses, floor area) and a "Meter Entries" sheet (monthly
//     consumption per meter). The library aggregates meter entries by
//     property + fuel type before joining to properties.
//
// Library usage:
//   import { convertExcelToGeoJSON, batchConvert } from './excel_process';
//   const fc = await convertExcelToGeoJSON('path/to/file.xlsx');
//
// CLI usage:
//   npm run geocode                               # all .xlsx in server/data/
//   npm run geocode -- --year 2024                # single year
//   npm run geocode -- --input path/to.xlsx       # single file

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LatLng {
  lat: number;
  lng: number;
}

export interface GeoJSONPoint {
  type: "Point";
  coordinates: [number, number]; // [lng, lat]
}

export interface GeoJSONFeature {
  type: "Feature";
  geometry: GeoJSONPoint | null;
  properties: Record<string, unknown>;
}

export interface GeoJSONFeatureCollection {
  type: "FeatureCollection";
  features: GeoJSONFeature[];
}

export interface ConvertOptions {
  /** Override the auto-detected reporting year. */
  year?: number;
  /** Path to the geocode cache JSON file. */
  cachePath?: string;
  /** Maximum concurrent geocode requests (default 5). */
  concurrency?: number;
  /** Progress callback invoked after each record is geocoded. */
  onProgress?: (done: number, total: number) => void;
}

export interface BatchConvertResult {
  geojsonPath: string;
  geocodedCount: number;
  totalCount: number;
  year: number;
}

/** Normalised per-building energy record, schema-agnostic. */
interface EnergyRecord {
  propertyName: string;
  operationType: string;
  address: string;
  city: string;
  postalCode: string;
  floorAreaSqM: number;
  electricityKWh: number;
  naturalGasM3: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "data");
const DEFAULT_CACHE_PATH = path.join(DATA_DIR, ".geocode-cache.json");

/** Natural gas m³ → kWh (HHV). */
const NG_KWH_PER_M3 = 10.55;

// ---------------------------------------------------------------------------
// Geocode cache
// ---------------------------------------------------------------------------

export class GeocodeCache {
  private data: Map<string, LatLng | null>;
  private filePath: string;
  private dirty = false;

  constructor(filePath: string = DEFAULT_CACHE_PATH) {
    this.filePath = filePath;
    this.data = new Map();
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
        for (const [k, v] of Object.entries(raw)) {
          this.data.set(k, v as LatLng | null);
        }
      }
    } catch {
      this.data = new Map();
    }
  }

  get(address: string): LatLng | null | undefined {
    return this.data.get(this.normalise(address));
  }

  set(address: string, coords: LatLng | null): void {
    this.data.set(this.normalise(address), coords);
    this.dirty = true;
  }

  get size(): number {
    return this.data.size;
  }

  save(): void {
    if (!this.dirty) return;
    const obj: Record<string, LatLng | null> = {};
    for (const [k, v] of this.data) obj[k] = v;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(obj, null, 2), "utf8");
    this.dirty = false;
  }

  private normalise(addr: string): string {
    return addr.toLowerCase().replace(/\s+/g, " ").trim();
  }
}

// ---------------------------------------------------------------------------
// Geocoding
// ---------------------------------------------------------------------------

/**
 * Geocode via the Government of Canada geolocator API.
 * Returns `{ lat, lng }` for the first candidate, or `null`.
 */
export async function geocode(address: string): Promise<LatLng | null> {
  const url = `https://geolocator.api.geo.ca/?q=${encodeURIComponent(address)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const results = (await res.json()) as Array<{
      lat?: number;
      lng?: number;
    }>;
    if (!Array.isArray(results) || results.length === 0) return null;
    const first = results[0];
    if (typeof first.lat === "number" && typeof first.lng === "number") {
      return { lat: first.lat, lng: first.lng };
    }
    return null;
  } catch {
    return null;
  }
}

async function geocodeCached(
  address: string,
  cache: GeocodeCache
): Promise<LatLng | null> {
  const cached = cache.get(address);
  if (cached !== undefined) return cached;
  const coords = await geocode(address);
  cache.set(address, coords);
  return coords;
}

// ---------------------------------------------------------------------------
// Concurrency helper
// ---------------------------------------------------------------------------

async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const workers = new Array(Math.min(limit, items.length))
    .fill(null)
    .map(async () => {
      while (true) {
        const idx = nextIndex++;
        if (idx >= items.length) return;
        results[idx] = await fn(items[idx], idx);
      }
    });
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

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
  return value; // assume m²
}

/** Extract a 4-digit year from a string like `*-data-2023`. */
export function extractYear(name: string | undefined): number | null {
  if (!name) return null;
  const match = name.match(/(20\d{2})/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

/** Read all rows from a worksheet as arrays (no header inference). */
function sheetToArrays(ws: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: "",
    blankrows: false,
  });
}

/**
 * Find the header row in a sheet — the first row (within the first 10)
 * whose cells match the given predicate. Returns -1 if not found.
 */
function findHeaderRow(
  rows: unknown[][],
  test: (cells: string[]) => boolean
): number {
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const cells = (rows[i] as unknown[]).map((c) => String(c ?? "").toLowerCase());
    if (test(cells)) return i;
  }
  return -1;
}

/** Build a column-index lookup from a header row. Returns -1 for missing cols. */
function colIndex(header: string[], pattern: RegExp): number {
  for (let i = 0; i < header.length; i++) {
    if (pattern.test(header[i])) return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Schema detection
// ---------------------------------------------------------------------------

/** Does the workbook look like a Portfolio Manager multi-sheet export? */
function isPortfolioManagerFormat(wb: XLSX.WorkBook): boolean {
  const names = wb.SheetNames.map((n) => n.toLowerCase());
  return names.includes("properties") && names.includes("meter entries");
}

/** Does the workbook have a single "Information and Metrics" sheet? (2021 format) */
function isInformationMetricsFormat(wb: XLSX.WorkBook): boolean {
  if (wb.SheetNames.length !== 1) return false;
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = sheetToArrays(ws);
  // Look for "Address 1" and "Property Name" in a header row.
  const hdr = findHeaderRow(rows, (cells) =>
    cells.some((c) => c.includes("address 1")) &&
    cells.some((c) => c.includes("property name"))
  );
  return hdr >= 0;
}

// ---------------------------------------------------------------------------
// Legacy parser (2011-2019)
// ---------------------------------------------------------------------------

/**
 * Parse the legacy government reporting template.
 *
 * Layout (rows are 0-indexed):
 *   Row 0-4: Banner / metadata
 *   Row 5:   Column headers ("Operation Name", "Address", ...)
 *   Row 6-7: Sub-headers ("Electricity Quantity", "Natural Gas Quantity")
 *   Row 8+:  Data
 *
 * Key column positions (0-based, from inspection):
 *   0  Operation Name
 *   1  Operation Type
 *   2  Address
 *   3  City
 *   4  Postal Code
 *   5  Total Floor Area
 *   6  Unit (Square meters / Square feet)
 *   9  Electricity Quantity (kWh)
 *   11 Natural Gas Quantity (m³)
 */
function parseLegacyWorkbook(wb: XLSX.WorkBook): EnergyRecord[] {
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = sheetToArrays(ws);
  if (rows.length < 9) return [];

  // Detect the header row (the one with "Operation Name" / "Address").
  let headerRow = -1;
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const cells = (rows[i] as unknown[]).map((c) => String(c ?? "").toLowerCase());
    if (cells.some((c) => c.includes("operation name")) && cells.some((c) => c.includes("address"))) {
      headerRow = i;
      break;
    }
  }
  if (headerRow === -1) headerRow = 5; // fallback

  // Build a column index map from the header row + sub-headers.
  const header = (rows[headerRow] as unknown[]).map((c) => String(c ?? "").toLowerCase());
  const subHeader1 = headerRow + 1 < rows.length
    ? (rows[headerRow + 1] as unknown[]).map((c) => String(c ?? "").toLowerCase())
    : [];
  const subHeader2 = headerRow + 2 < rows.length
    ? (rows[headerRow + 2] as unknown[]).map((c) => String(c ?? "").toLowerCase())
    : [];

  // Find column indices by scanning headers + sub-headers.
  const colIdx = {
    name: -1,
    type: -1,
    address: -1,
    city: -1,
    postal: -1,
    area: -1,
    areaUnit: -1,
    electricity: -1,
    gas: -1,
  };

  for (let i = 0; i < header.length; i++) {
    const h = header[i];
    if (h.includes("operation name")) colIdx.name = i;
    if (h.includes("operation type")) colIdx.type = i;
    if (/^address$/i.test(h.trim())) colIdx.address = i;
    if (/^city$/i.test(h.trim())) colIdx.city = i;
    if (h.includes("postal code") || h.includes("postal")) colIdx.postal = i;
    if (h.includes("total floor area") || h.includes("floor area")) colIdx.area = i;
    if (/^unit$/i.test(h.trim())) colIdx.areaUnit = i;
  }

  // Find electricity / gas columns in sub-headers.
  for (let i = 0; i < subHeader1.length; i++) {
    if (subHeader1[i].includes("electricity") && colIdx.electricity === -1) {
      // The actual quantity column is the next one (or this one if "Quantity" is in sub2).
      colIdx.electricity = i;
    }
    if (subHeader1[i].includes("natural gas") && colIdx.gas === -1) {
      colIdx.gas = i;
    }
  }

  // If sub-headers have "Quantity" columns, shift to the actual numeric column.
  if (colIdx.electricity >= 0 && subHeader2.length > 0) {
    for (let i = colIdx.electricity; i < Math.min(colIdx.electricity + 3, subHeader2.length); i++) {
      if (subHeader2[i].includes("quantity")) {
        colIdx.electricity = i;
        break;
      }
    }
  }
  if (colIdx.gas >= 0 && subHeader2.length > 0) {
    for (let i = colIdx.gas; i < Math.min(colIdx.gas + 3, subHeader2.length); i++) {
      if (subHeader2[i].includes("quantity")) {
        colIdx.gas = i;
        break;
      }
    }
  }

  // Parse data rows.
  const dataStart = headerRow + 3; // skip header + 2 sub-header rows
  const records: EnergyRecord[] = [];

  for (let i = dataStart; i < rows.length; i++) {
    const row = rows[i] as unknown[];
    if (!row || row.length === 0) continue;

    const name = colIdx.name >= 0 ? String(row[colIdx.name] ?? "").trim() : "";
    if (!name) continue; // skip blank / summary rows

    const address = colIdx.address >= 0 ? String(row[colIdx.address] ?? "").trim() : "";
    const city = colIdx.city >= 0 ? String(row[colIdx.city] ?? "").trim() : "";
    const postal = colIdx.postal >= 0 ? String(row[colIdx.postal] ?? "").trim() : "";
    const opType = colIdx.type >= 0 ? String(row[colIdx.type] ?? "").trim() : "";

    const areaRaw = colIdx.area >= 0 ? toNumber(row[colIdx.area]) : 0;
    const areaUnit = colIdx.areaUnit >= 0 ? String(row[colIdx.areaUnit] ?? "") : "";
    const floorAreaSqM = normaliseAreaToSqM(areaRaw, areaUnit);

    const electricityKWh = colIdx.electricity >= 0 ? toNumber(row[colIdx.electricity]) : 0;
    const naturalGasM3 = colIdx.gas >= 0 ? toNumber(row[colIdx.gas]) : 0;

    if (!address && !electricityKWh && !naturalGasM3) continue;

    records.push({
      propertyName: name,
      operationType: opType,
      address,
      city,
      postalCode: postal,
      floorAreaSqM,
      electricityKWh,
      naturalGasM3,
    });
  }

  return records;
}

// ---------------------------------------------------------------------------
// Portfolio Manager parser (2020+)
// ---------------------------------------------------------------------------

interface PmProperty {
  name: string;
  address: string;
  city: string;
  postalCode: string;
  propertyType: string;
  floorAreaSqM: number;
}

/**
 * Parse the "Properties" sheet. Auto-detects the header row (some exports
 * prefix with banner rows like "My Portfolio: ..." / date / count).
 */
function parsePropertiesSheet(ws: XLSX.WorkSheet): Map<string, PmProperty> {
  const rows = sheetToArrays(ws);
  if (rows.length < 2) return new Map();

  const headerIdx = findHeaderRow(rows, (cells) =>
    cells.some((c) => c.includes("property name")) &&
    cells.some((c) => /street address|address/i.test(c))
  );
  if (headerIdx < 0) return new Map();

  const header = (rows[headerIdx] as unknown[]).map((c) =>
    String(c ?? "").toLowerCase().trim()
  );

  const iName = colIndex(header, /property\s*name/);
  const iAddr = colIndex(header, /street\s*address|^address/);
  const iCity = colIndex(header, /city|municipality/);
  const iPostal = colIndex(header, /postal\s*code|zip/);
  const iType = colIndex(header, /property\s*type/);
  const iArea = colIndex(header, /gross\s*floor\s*area|floor\s*area/);
  const iAreaUnit = colIndex(header, /gfa\s*unit|area\s*unit|^unit$/);

  const props = new Map<string, PmProperty>();

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] as unknown[];
    if (!row || row.length === 0) continue;

    const name = iName >= 0 ? String(row[iName] ?? "").trim() : "";
    if (!name) continue;

    const areaRaw = iArea >= 0 ? toNumber(row[iArea]) : 0;
    const areaUnit = iAreaUnit >= 0 ? String(row[iAreaUnit] ?? "") : "";

    props.set(name, {
      name,
      address: iAddr >= 0 ? String(row[iAddr] ?? "").trim() : "",
      city: iCity >= 0 ? String(row[iCity] ?? "").trim() : "",
      postalCode: iPostal >= 0 ? String(row[iPostal] ?? "").trim() : "",
      propertyType: iType >= 0 ? String(row[iType] ?? "").trim() : "",
      floorAreaSqM: normaliseAreaToSqM(areaRaw, areaUnit),
    });
  }

  return props;
}

/**
 * Aggregate meter entries by property name. Sums electricity (kWh) and
 * natural gas (m³) across all monthly readings for each property.
 * Auto-detects the header row.
 */
function aggregateMeterEntries(
  ws: XLSX.WorkSheet
): Map<string, { electricityKWh: number; naturalGasM3: number }> {
  const rows = sheetToArrays(ws);
  if (rows.length < 2) return new Map();

  const headerIdx = findHeaderRow(rows, (cells) =>
    cells.some((c) => c.includes("property name")) &&
    cells.some((c) => c.includes("meter"))
  );
  if (headerIdx < 0) return new Map();

  const header = (rows[headerIdx] as unknown[]).map((c) =>
    String(c ?? "").toLowerCase().trim()
  );

  const iName = colIndex(header, /property\s*name/);
  const iMeterType = colIndex(header, /meter\s*type/);
  const iQty = colIndex(header, /usage.quantity/);
  const iUnit = colIndex(header, /usage\s*unit|^unit$/);

  const totals = new Map<string, { electricityKWh: number; naturalGasM3: number }>();

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] as unknown[];
    if (!row || row.length === 0) continue;

    const name = iName >= 0 ? String(row[iName] ?? "").trim() : "";
    if (!name) continue;

    const meterType = iMeterType >= 0 ? String(row[iMeterType] ?? "").toLowerCase() : "";
    const qty = iQty >= 0 ? toNumber(row[iQty]) : 0;
    const unit = iUnit >= 0 ? String(row[iUnit] ?? "").toLowerCase() : "";

    if (qty <= 0) continue;

    const slot = totals.get(name) ?? { electricityKWh: 0, naturalGasM3: 0 };

    if (meterType.includes("electric")) {
      slot.electricityKWh += qty;
    } else if (meterType.includes("natural gas") || meterType.includes("gas")) {
      slot.naturalGasM3 += qty;
    }

    totals.set(name, slot);
  }

  return totals;
}

function parsePortfolioManagerWorkbook(wb: XLSX.WorkBook): EnergyRecord[] {
  const propsWs = wb.Sheets["Properties"] ?? wb.Sheets["properties"];
  const metersWs = wb.Sheets["Meter Entries"] ?? wb.Sheets["meter entries"];

  if (!propsWs) {
    console.warn("Portfolio Manager workbook missing 'Properties' sheet");
    return [];
  }

  const properties = parsePropertiesSheet(propsWs);
  const meters = metersWs ? aggregateMeterEntries(metersWs) : new Map();

  const records: EnergyRecord[] = [];

  for (const [name, prop] of properties) {
    const energy = meters.get(name) ?? { electricityKWh: 0, naturalGasM3: 0 };
    records.push({
      propertyName: name,
      operationType: prop.propertyType,
      address: prop.address,
      city: prop.city,
      postalCode: prop.postalCode,
      floorAreaSqM: prop.floorAreaSqM,
      electricityKWh: energy.electricityKWh,
      naturalGasM3: energy.naturalGasM3,
    });
  }

  return records;
}

// ---------------------------------------------------------------------------
// Information & Metrics parser (2021 single-sheet format)
// ---------------------------------------------------------------------------

/** Therms → m³ natural gas (1 therm ≈ 2.832 m³). */
const THERMS_TO_M3 = 2.832;

/**
 * Parse the single-sheet "Information and Metrics" format used in 2021.
 * Header is auto-detected; key columns include:
 *   Property Name, Address 1, City, Postal Code,
 *   Property GFA (m²), Primary Property Type,
 *   Electricity Use - Grid Purchase (kWh),
 *   Natural Gas Use (therms).
 */
function parseInformationMetricsWorkbook(wb: XLSX.WorkBook): EnergyRecord[] {
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = sheetToArrays(ws);

  const headerIdx = findHeaderRow(rows, (cells) =>
    cells.some((c) => c.includes("address 1")) &&
    cells.some((c) => c.includes("property name"))
  );
  if (headerIdx < 0) return [];

  const header = (rows[headerIdx] as unknown[]).map((c) =>
    String(c ?? "").toLowerCase().trim()
  );

  const iName = colIndex(header, /property\s*name/);
  const iAddr = colIndex(header, /^address\s*1$|^address$/);
  const iCity = colIndex(header, /^city$/);
  const iPostal = colIndex(header, /postal\s*code/);
  const iArea = colIndex(header, /property\s*gfa|gross\s*floor\s*area|floor\s*area/);
  const iType = colIndex(header, /primary\s*property\s*type|property\s*type/);
  const iElec = colIndex(header, /electricity.*kwh|electric.*grid.*kwh/);
  const iGasTherms = colIndex(header, /natural\s*gas.*therm/);
  const iGasM3 = colIndex(header, /natural\s*gas.*m[³3]|natural\s*gas.*cubic/);

  const records: EnergyRecord[] = [];

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] as unknown[];
    if (!row || row.length === 0) continue;

    const name = iName >= 0 ? String(row[iName] ?? "").trim() : "";
    if (!name) continue;

    const address = iAddr >= 0 ? String(row[iAddr] ?? "").trim() : "";
    const city = iCity >= 0 ? String(row[iCity] ?? "").trim() : "";
    const postal = iPostal >= 0 ? String(row[iPostal] ?? "").trim() : "";
    const opType = iType >= 0 ? String(row[iType] ?? "").trim() : "";

    const areaRaw = iArea >= 0 ? toNumber(row[iArea]) : 0;
    // GFA is in m² for this format.
    const floorAreaSqM = areaRaw > 0 ? areaRaw : 0;

    const electricityKWh = iElec >= 0 ? toNumber(row[iElec]) : 0;
    let naturalGasM3 = 0;
    if (iGasM3 >= 0) {
      naturalGasM3 = toNumber(row[iGasM3]);
    } else if (iGasTherms >= 0) {
      naturalGasM3 = toNumber(row[iGasTherms]) * THERMS_TO_M3;
    }

    if (!address && !electricityKWh && !naturalGasM3) continue;

    records.push({
      propertyName: name,
      operationType: opType,
      address,
      city,
      postalCode: postal,
      floorAreaSqM,
      electricityKWh,
      naturalGasM3,
    });
  }

  return records;
}

// ---------------------------------------------------------------------------
// Unified parser
// ---------------------------------------------------------------------------

/**
 * Parse any supported energy workbook into normalised `EnergyRecord`s.
 * Auto-detects the schema (legacy vs Portfolio Manager).
 */
export function parseEnergyRecords(filePath: string): {
  records: EnergyRecord[];
  year: number | null;
} {
  const wb = XLSX.readFile(filePath);
  const year = extractYear(path.basename(filePath));
  let records: EnergyRecord[];
  if (isPortfolioManagerFormat(wb)) {
    records = parsePortfolioManagerWorkbook(wb);
  } else if (isInformationMetricsFormat(wb)) {
    records = parseInformationMetricsWorkbook(wb);
  } else {
    records = parseLegacyWorkbook(wb);
  }
  return { records, year };
}

// ---------------------------------------------------------------------------
// GeoJSON conversion
// ---------------------------------------------------------------------------

function recordToProperties(
  rec: EnergyRecord,
  year: number | null
): Record<string, unknown> {
  const gasKWhEq = rec.naturalGasM3 * NG_KWH_PER_M3;
  const totalKWh = rec.electricityKWh + gasKWhEq;
  const intensity =
    rec.floorAreaSqM > 0 ? totalKWh / rec.floorAreaSqM : null;

  return {
    name: rec.propertyName || null,
    operationType: rec.operationType || null,
    address: rec.address || null,
    city: rec.city || null,
    postalCode: rec.postalCode || null,
    year,
    electricityKWh: rec.electricityKWh || null,
    naturalGasM3: rec.naturalGasM3 || null,
    naturalGasKWhEq: gasKWhEq ? Math.round(gasKWhEq * 100) / 100 : null,
    totalEnergyKWh: totalKWh ? Math.round(totalKWh * 100) / 100 : null,
    floorAreaSqM: rec.floorAreaSqM
      ? Math.round(rec.floorAreaSqM * 100) / 100
      : null,
    intensityKWhPerSqM: intensity ? Math.round(intensity * 100) / 100 : null,
  };
}

/** Build a full geocoding address from an energy record. */
function buildFullAddress(rec: EnergyRecord): string {
  const parts = [rec.address, rec.city, "Ontario", rec.postalCode, "Canada"]
    .filter((p) => p && p.trim().length > 0);
  return parts.join(", ");
}

/**
 * Convert a single XLSX file into a GeoJSON FeatureCollection.
 *
 * Each record with a geocodable address becomes a Point Feature. Records
 * that fail geocoding still appear with `geometry: null`.
 */
export async function convertExcelToGeoJSON(
  filePath: string,
  options: ConvertOptions = {}
): Promise<GeoJSONFeatureCollection> {
  const cache = new GeocodeCache(options.cachePath ?? DEFAULT_CACHE_PATH);
  const { records, year: detectedYear } = parseEnergyRecords(filePath);
  const year = options.year ?? detectedYear;
  const concurrency = options.concurrency ?? 5;
  let done = 0;

  const features = await mapWithLimit(records, concurrency, async (rec) => {
    const props = recordToProperties(rec, year);
    const fullAddr = buildFullAddress(rec);
    let coords: LatLng | null = null;

    if (fullAddr) {
      coords = await geocodeCached(fullAddr, cache);
    }

    done++;
    options.onProgress?.(done, records.length);

    return {
      type: "Feature" as const,
      geometry: coords
        ? { type: "Point" as const, coordinates: [coords.lng, coords.lat] as [number, number] }
        : null,
      properties: props,
    };
  });

  cache.save();
  return { type: "FeatureCollection", features };
}

/**
 * Retry geocoding for features that previously had `null` geometry.
 */
export async function geocodeFeatures(
  fc: GeoJSONFeatureCollection,
  options: {
    cachePath?: string;
    concurrency?: number;
    onProgress?: (done: number, total: number) => void;
  } = {}
): Promise<GeoJSONFeatureCollection> {
  const cache = new GeocodeCache(options.cachePath ?? DEFAULT_CACHE_PATH);
  const concurrency = options.concurrency ?? 5;
  const nullGeom = fc.features.filter((f) => f.geometry === null);
  let done = 0;

  await mapWithLimit(nullGeom, concurrency, async (feature) => {
    const addr = feature.properties.address as string;
    const city = (feature.properties.city as string) ?? "";
    const postal = (feature.properties.postalCode as string) ?? "";
    const fullAddr = [addr, city, "Ontario", postal, "Canada"]
      .filter((p) => p && p.trim().length > 0)
      .join(", ");

    if (fullAddr) {
      const coords = await geocodeCached(fullAddr, cache);
      if (coords) {
        feature.geometry = {
          type: "Point",
          coordinates: [coords.lng, coords.lat],
        };
      }
    }
    done++;
    options.onProgress?.(done, nullGeom.length);
    return feature;
  });

  cache.save();
  return fc;
}

// ---------------------------------------------------------------------------
// Batch processing
// ---------------------------------------------------------------------------

/**
 * Process every `annual-energy-consumption-*.xlsx` file in a directory,
 * writing a companion `.geojson` next to each one.
 */
export async function batchConvert(
  dataDir: string = DATA_DIR,
  options: ConvertOptions = {}
): Promise<BatchConvertResult[]> {
  const xlsxFiles = fs
    .readdirSync(dataDir)
    .filter((f) => /^annual-energy-consumption-\d{4}.*\.xlsx$/i.test(f))
    .sort();

  if (xlsxFiles.length === 0) {
    console.warn(`No energy XLSX files found in ${dataDir}`);
    return [];
  }

  const cachePath = options.cachePath ?? DEFAULT_CACHE_PATH;
  const results: BatchConvertResult[] = [];

  for (const file of xlsxFiles) {
    const inputPath = path.join(dataDir, file);
    const year = extractYear(file) ?? 0;
    const outputFile = file.replace(/\.xlsx$/i, ".geojson");
    const outputPath = path.join(dataDir, outputFile);

    console.log(`\n▸ ${file} → ${outputFile}  (year: ${year || "unknown"})`);

    const fc = await convertExcelToGeoJSON(inputPath, {
      ...options,
      year,
      cachePath,
    });

    fs.writeFileSync(outputPath, JSON.stringify(fc, null, 2), "utf8");

    const geocodedCount = fc.features.filter(
      (f) => f.geometry !== null
    ).length;
    console.log(
      `  ✓ ${geocodedCount}/${fc.features.length} geocoded → ${outputPath}`
    );

    results.push({
      geojsonPath: outputPath,
      geocodedCount,
      totalCount: fc.features.length,
      year,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): {
  input?: string;
  year?: number;
  all: boolean;
} {
  const args: { input?: string; year?: number; all: boolean } = {
    all: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--input" && argv[i + 1]) {
      args.input = argv[++i];
    } else if (a === "--year" && argv[i + 1]) {
      args.year = Number(argv[++i]);
    } else if (a === "--all") {
      args.all = true;
    } else if (!a.startsWith("--")) {
      args.input = a;
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.input) {
    const inputPath = path.resolve(args.input);
    const outputPath = inputPath.replace(/\.xlsx$/i, ".geojson");

    console.log(`Converting ${inputPath}...`);
    const fc = await convertExcelToGeoJSON(inputPath, {
      year: args.year,
      onProgress: (done, total) => {
        if (done % 25 === 0 || done === total) {
          process.stdout.write(`\r  geocoding ${done}/${total}`);
        }
      },
    });
    console.log();

    fs.writeFileSync(outputPath, JSON.stringify(fc, null, 2), "utf8");
    const geocoded = fc.features.filter((f) => f.geometry !== null).length;
    console.log(
      `Wrote ${fc.features.length} features (${geocoded} geocoded) → ${outputPath}`
    );
  } else {
    console.log(`Batch converting all energy XLSX files in ${DATA_DIR}`);
    const results = await batchConvert(DATA_DIR, {
      year: args.year,
      onProgress: (done, total) => {
        if (done % 25 === 0 || done === total) {
          process.stdout.write(`\r  geocoding ${done}/${total}`);
        }
      },
    });

    if (results.length === 0) {
      console.log("Nothing to convert.");
      return;
    }

    const totalFeatures = results.reduce((s, r) => s + r.totalCount, 0);
    const totalGeocoded = results.reduce((s, r) => s + r.geocodedCount, 0);
    console.log(
      `\nDone: ${results.length} files, ${totalGeocoded}/${totalFeatures} features geocoded`
    );
  }
}

// Run CLI when executed directly.
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith("excel_process.ts") ||
    process.argv[1].endsWith("excel_process.js"));

if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
