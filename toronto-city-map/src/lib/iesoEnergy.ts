// IESO Generator Output by Fuel Type — Hourly report.
//
// Source: Independent Electricity System Operator (Ontario)
// https://reports-public.ieso.ca/public/GenOutputbyFuelHourly/
//
// The XML report covers the current year's hourly generation output
// broken down by fuel type: NUCLEAR, GAS, HYDRO, WIND, SOLAR, BIOFUEL, OTHER.
// Values are in MW (megawatts) per hour.
//
// The prefetch script downloads the XML and converts it to a compact
// JSON that the frontend loads from `/data/ieso-gen-output-hourly.json`.

const LOCAL_JSON_URL = "/data/ieso-gen-output-hourly.json";

/** Canonical fuel type names from the IESO report. */
export type IesoFuelType =
  | "NUCLEAR"
  | "GAS"
  | "HYDRO"
  | "WIND"
  | "SOLAR"
  | "BIOFUEL"
  | "OTHER";

export const FUEL_TYPES: IesoFuelType[] = [
  "NUCLEAR",
  "GAS",
  "HYDRO",
  "WIND",
  "SOLAR",
  "BIOFUEL",
  "OTHER",
];

/** Human-friendly labels for each fuel type. */
export const FUEL_LABEL: Record<IesoFuelType, string> = {
  NUCLEAR: "Nuclear",
  GAS: "Natural Gas",
  HYDRO: "Hydro",
  WIND: "Wind",
  SOLAR: "Solar",
  BIOFUEL: "Biofuel",
  OTHER: "Other",
};

/**
 * Distinct colours for the stacked area chart and legend.
 * Chosen for perceptual separation on a dark background.
 */
export const FUEL_COLOR: Record<IesoFuelType, string> = {
  NUCLEAR: "#7aa8ff", // cool blue
  GAS: "#ff8c5a", // warm orange
  HYDRO: "#5ae0c8", // teal
  WIND: "#b8e06a", // lime green
  SOLAR: "#ffd45a", // amber yellow
  BIOFUEL: "#d98aff", // violet
  OTHER: "#8a8a8a", // neutral grey
};

/** One hour of generation data. */
export interface IesoHourData {
  /** Hour 1–24 (IESO convention: 1 = 00:00–01:00). */
  hour: number;
  /** Generation in MW per fuel type. */
  fuels: Record<IesoFuelType, number>;
}

/** One day of hourly generation data. */
export interface IesoDayData {
  /** ISO date string YYYY-MM-DD. */
  date: string;
  /** 24 hourly entries (may be fewer for partial days). */
  hours: IesoHourData[];
}

/** Raw JSON shape from the prefetch output. */
interface IesoJsonRaw {
  deliveryYear: number;
  createdAt: string;
  days: Array<{
    date: string;
    hours: Array<{
      hour: number;
      fuels: Record<string, number>;
    }>;
  }>;
}

/** Aggregate stats for a fuel type across the dataset. */
export interface FuelSummary {
  type: IesoFuelType;
  label: string;
  color: string;
  /** Peak generation observed, MW. */
  peakMW: number;
  /** Average generation across all hours, MW. */
  avgMW: number;
  /** Total generation across all hours, MWh (sum of MW × 1h). */
  totalMWh: number;
  /** Share of total generation, 0–1. */
  share: number;
}

/** The full parsed IESO energy dataset. */
export interface IesoEnergyDataset {
  /** Year the data covers. */
  deliveryYear: number;
  /** Timestamp the report was generated. */
  createdAt: string;
  /** Number of days in the dataset. */
  dayCount: number;
  /** Per-day hourly breakdown. */
  days: IesoDayData[];
  /** Per-fuel aggregate statistics. */
  fuelSummaries: FuelSummary[];
  /** Total generation across all fuels and hours, MWh. */
  totalGenerationMWh: number;
  /** Peak total generation in any single hour, MW. */
  peakTotalMW: number;
  /** Average total generation per hour, MW. */
  avgTotalMW: number;
  /** Most recent complete day's data (last entry). */
  latestDay: IesoDayData | null;
  /** Daily totals for charting. */
  dailyTotals: Array<{ date: string; totalMW: number; byFuel: Record<IesoFuelType, number> }>;
}

/**
 * Fetch the IESO hourly energy dataset from the local prefetch JSON.
 * Returns null on any failure.
 */
export async function fetchIesoEnergy(opts?: {
  signal?: AbortSignal;
}): Promise<IesoEnergyDataset | null> {
  try {
    const res = await fetch(LOCAL_JSON_URL, { signal: opts?.signal });
    if (!res.ok) {
      console.warn(`IESO energy HTTP ${res.status}`);
      return null;
    }
    const raw = (await res.json()) as IesoJsonRaw;
    return parseIesoDataset(raw);
  } catch (err) {
    if ((err as { name?: string })?.name === "AbortError") throw err;
    console.warn("IESO energy fetch failed:", err);
    return null;
  }
}

function parseIesoDataset(raw: IesoJsonRaw): IesoEnergyDataset | null {
  if (!raw.days || raw.days.length === 0) return null;

  const days: IesoDayData[] = raw.days.map((d) => ({
    date: d.date,
    hours: d.hours.map((h) => ({
      hour: h.hour,
      fuels: normalizeFuels(h.fuels),
    })),
  }));

  // Accumulate per-fuel stats.
  const fuelTotals = new Map<IesoFuelType, { sum: number; peak: number; count: number }>();
  for (const ft of FUEL_TYPES) {
    fuelTotals.set(ft, { sum: 0, peak: 0, count: 0 });
  }
  let totalGenerationMWh = 0;
  let peakTotalMW = 0;
  let totalHourCount = 0;
  let totalHourlySum = 0;

  const dailyTotals: IesoEnergyDataset["dailyTotals"] = [];

  for (const day of days) {
    const byFuel: Record<IesoFuelType, number> = {} as Record<IesoFuelType, number>;
    let dayTotal = 0;

    for (const h of day.hours) {
      let hourTotal = 0;
      for (const ft of FUEL_TYPES) {
        const v = h.fuels[ft] ?? 0;
        const acc = fuelTotals.get(ft)!;
        acc.sum += v;
        acc.count += 1;
        if (v > acc.peak) acc.peak = v;
        byFuel[ft] = (byFuel[ft] ?? 0) + v;
        hourTotal += v;
      }
      totalGenerationMWh += hourTotal; // MW × 1h = MWh
      totalHourlySum += hourTotal;
      totalHourCount += 1;
      if (hourTotal > peakTotalMW) peakTotalMW = hourTotal;
    }
    dayTotal = Object.values(byFuel).reduce((a, b) => a + b, 0);
    dailyTotals.push({ date: day.date, totalMW: dayTotal / Math.max(1, day.hours.length), byFuel });
  }

  const fuelSummaries: FuelSummary[] = FUEL_TYPES.map((ft) => {
    const acc = fuelTotals.get(ft)!;
    return {
      type: ft,
      label: FUEL_LABEL[ft],
      color: FUEL_COLOR[ft],
      peakMW: acc.peak,
      avgMW: acc.count > 0 ? acc.sum / acc.count : 0,
      totalMWh: acc.sum,
      share: totalGenerationMWh > 0 ? acc.sum / totalGenerationMWh : 0,
    };
  });

  // Sort by totalMWh descending for display.
  fuelSummaries.sort((a, b) => b.totalMWh - a.totalMWh);

  return {
    deliveryYear: raw.deliveryYear,
    createdAt: raw.createdAt,
    dayCount: days.length,
    days,
    fuelSummaries,
    totalGenerationMWh,
    peakTotalMW,
    avgTotalMW: totalHourCount > 0 ? totalHourlySum / totalHourCount : 0,
    latestDay: days.length > 0 ? days[days.length - 1] : null,
    dailyTotals,
  };
}

function normalizeFuels(raw: Record<string, number>): Record<IesoFuelType, number> {
  const out = {} as Record<IesoFuelType, number>;
  for (const ft of FUEL_TYPES) {
    out[ft] = typeof raw[ft] === "number" ? raw[ft] : 0;
  }
  return out;
}

/** Format MW with sensible unit. */
export function formatMW(mw: number): string {
  if (!Number.isFinite(mw) || mw <= 0) return "—";
  if (mw >= 1_000) return `${(mw / 1_000).toFixed(1)} GW`;
  if (mw >= 1) return `${Math.round(mw).toLocaleString()} MW`;
  return `${(mw * 1_000).toFixed(0)} kW`;
}

/** Format MWh with sensible unit. */
export function formatMWh(mwh: number): string {
  if (!Number.isFinite(mwh) || mwh <= 0) return "—";
  if (mwh >= 1_000_000) return `${(mwh / 1_000_000).toFixed(2)} TWh`;
  if (mwh >= 1_000) return `${(mwh / 1_000).toFixed(1)} GWh`;
  return `${Math.round(mwh).toLocaleString()} MWh`;
}

/** Get the current hour's data from the latest day (or latest available). */
export function getCurrentHourData(
  dataset: IesoEnergyDataset
): IesoHourData | null {
  const day = dataset.latestDay;
  if (!day || day.hours.length === 0) return null;
  // IESO hours are 1-indexed. Current hour in ET.
  const now = new Date();
  const currentHour = now.getHours() + 1; // 0–23 → 1–24
  const h = day.hours.find((h) => h.hour === currentHour);
  return h ?? day.hours[day.hours.length - 1] ?? null;
}
