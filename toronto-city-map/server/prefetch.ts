// Pre-fetch script for Toronto Open Data resources.
//
// The City of Toronto CKAN portal does not always send the CORS headers
// the browser wants when loading large GeoJSON / XLSX resources through
// `fetch()`. This script downloads the same files server-side via
// `curl`, writes them under `server/data/`, and stamps a small
// `manifest.json` describing what's available. A tiny Vite plugin
// (configured in `vite.config.ts`) then serves that directory at
// `/data/*` so the frontend can hit a same-origin URL with no CORS
// to negotiate.
//
// Datasets:
//   buildings  — Topographic Mapping building outlines (GeoJSON)
//   wards      — City Ward boundaries 2018 (GeoJSON)
//   energy     — Annual Energy Consumption per city building (XLSX)
//   ieso       — IESO Generator Output by Fuel Type Hourly (XML → JSON)
//
// Usage:
//   npm run prefetch                  # all datasets
//   npm run prefetch -- buildings     # subset
//   npm run prefetch -- energy wards
//   npm run prefetch -- ieso          # IESO hourly only
//
// Re-running is idempotent: existing files are overwritten so each run
// captures whatever is published *now*.

import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  writeFileSync,
  existsSync,
  statSync,
  rmSync,
  renameSync,
  readFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// IESO XML parsing helpers
// ---------------------------------------------------------------------------

/**
 * Parse the IESO PUB_GenOutputbyFuelHourly.xml into a compact JSON
 * structure the frontend can consume without an XML parser.
 *
 * Output shape:
 *   { deliveryYear, createdAt, days: [ { date, hours: [ { hour, fuels: { NUCLEAR: MW, ... } } ] } ] }
 */
function parseIesoXml(xml: string): {
  deliveryYear: number;
  createdAt: string;
  days: Array<{
    date: string;
    hours: Array<{ hour: number; fuels: Record<string, number> }>;
  }>;
} {
  const days: Array<{
    date: string;
    hours: Array<{ hour: number; fuels: Record<string, number> }>;
  }> = [];

  // Extract delivery year
  const yearMatch = xml.match(/<DeliveryYear>(\d{4})<\/DeliveryYear>/);
  const deliveryYear = yearMatch ? Number(yearMatch[1]) : new Date().getFullYear();

  // Extract created timestamp
  const createdMatch = xml.match(/<CreatedAt>([^<]+)<\/CreatedAt>/);
  const createdAt = createdMatch ? createdMatch[1] : new Date().toISOString();

  // Split into DailyData blocks
  const dailyBlocks = xml.match(/<DailyData>[\s\S]*?<\/DailyData>/g) ?? [];

  for (const block of dailyBlocks) {
    const dayMatch = block.match(/<Day>([^<]+)<\/Day>/);
    if (!dayMatch) continue;
    const date = dayMatch[1];

    const hours: Array<{ hour: number; fuels: Record<string, number> }> = [];
    const hourlyBlocks = block.match(/<HourlyData>[\s\S]*?<\/HourlyData>/g) ?? [];

    for (const hb of hourlyBlocks) {
      const hourMatch = hb.match(/<Hour>(\d+)<\/Hour>/);
      if (!hourMatch) continue;
      const hour = Number(hourMatch[1]);
      const fuels: Record<string, number> = {};

      const fuelBlocks = hb.match(/<FuelTotal>[\s\S]*?<\/FuelTotal>/g) ?? [];
      for (const fb of fuelBlocks) {
        const fuelMatch = fb.match(/<Fuel>([^<]+)<\/Fuel>/);
        const outputMatch = fb.match(/<Output>(-?\d+(?:\.\d+)?)<\/Output>/);
        if (fuelMatch && outputMatch) {
          fuels[fuelMatch[1]] = Number(outputMatch[1]);
        }
      }
      hours.push({ hour, fuels });
    }
    days.push({ date, hours });
  }

  return { deliveryYear, createdAt, days };
}

function processIesoXml(xmlPath: string, jsonDest: string): number {
  const xml = readFileSync(xmlPath, "utf-8");
  const parsed = parseIesoXml(xml);
  writeFileSync(jsonDest, JSON.stringify(parsed));
  return statSync(jsonDest).size;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "data");
const MANIFEST_PATH = join(DATA_DIR, "manifest.json");

interface ManifestEntry {
  /** Stable client-facing path under `/data/`. */
  path: string;
  /** Direct upstream URL we downloaded from. */
  source: string;
  /** Size on disk, bytes. */
  bytes: number;
  /** ISO timestamp of the download. */
  fetchedAt: string;
  /** Optional metadata (e.g. year for energy resources). */
  meta?: Record<string, unknown>;
}

interface Manifest {
  generatedAt: string;
  entries: Record<string, ManifestEntry>;
}

// ---------------------------------------------------------------------------
// Dataset descriptors
// ---------------------------------------------------------------------------

interface CkanResource {
  id: string;
  name: string;
  format: string;
  url: string;
  position?: number;
}

interface CkanPackageShow {
  success: boolean;
  result: { resources: CkanResource[] };
}

interface DatasetSpec {
  /** Short slug used as the CLI selector and manifest key. */
  key: string;
  /** Human description for log lines. */
  label: string;
  /**
   * Resolves to one or more concrete files to download. Returns the
   * destination filename and upstream URL plus optional metadata that
   * gets written into the manifest entry.
   */
  resolve: () => Promise<
    Array<{ filename: string; source: string; meta?: Record<string, unknown> }>
  >;
}

const DATASETS: DatasetSpec[] = [
  {
    key: "buildings",
    label: "Topographic Mapping — Building Outlines",
    resolve: async () => [
      {
        filename: "building-outlines-4326.geojson",
        source:
          "https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/09a930cc-2a52-49b2-866d-52ac7f769a73/resource/8364d47f-6a39-439d-8e9c-4ea1a7506e53/download/Building%20Outlines%20-%204326.geojson",
      },
    ],
  },
  {
    key: "wards",
    label: "City Wards (2018) boundaries",
    resolve: async () => [
      {
        filename: "city-wards-4326.geojson",
        source:
          "https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/5e7a8234-f805-43ac-820f-03d7c360b588/resource/737b29e0-8329-4260-b6af-21555ab24f28/download/City%20Wards%20Data%20-%204326.geojson",
      },
    ],
  },
  {
    key: "energy",
    label: "Annual Energy Consumption [City Owned/Operated]",
    resolve: async () => {
      const pkgUrl =
        "https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/package_show?id=annual-energy-consumption";
      const json = curlJson<CkanPackageShow>(pkgUrl);
      const resources = json?.result?.resources ?? [];
      const yearly = resources
        .map((r) => ({ r, year: extractYear(r.name) }))
        .filter(
          (e): e is { r: CkanResource; year: number } =>
            e.year !== null && /xlsx$/i.test(e.r.format)
        )
        .sort((a, b) => b.year - a.year);
      if (yearly.length === 0) {
        throw new Error("No yearly XLSX resources found in CKAN listing.");
      }
      return yearly.map(({ r, year }) => ({
        filename: `annual-energy-consumption-${year}.xlsx`,
        source: r.url,
        meta: { year, resourceName: r.name },
      }));
    },
  },
  {
    key: "ieso",
    label: "IESO Generator Output by Fuel Type (Hourly)",
    resolve: async () => [
      {
        filename: "ieso-gen-output-hourly.xml",
        source:
          "https://reports-public.ieso.ca/public/GenOutputbyFuelHourly/PUB_GenOutputbyFuelHourly.xml",
        meta: { publisher: "IESO", format: "xml" },
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  const requested = process.argv.slice(2);
  ensureCurl();
  mkdirSync(DATA_DIR, { recursive: true });

  const selected =
    requested.length === 0
      ? DATASETS
      : DATASETS.filter((d) => requested.includes(d.key));

  if (selected.length === 0) {
    console.error(
      `Unknown dataset(s): ${requested.join(", ")}\n` +
        `Known keys: ${DATASETS.map((d) => d.key).join(", ")}`
    );
    process.exit(2);
  }

  const manifest: Manifest = loadManifest();

  for (const ds of selected) {
    console.log(`\n▸ ${ds.label}`);
    let files: Awaited<ReturnType<DatasetSpec["resolve"]>>;
    try {
      files = await ds.resolve();
    } catch (err) {
      console.error(`  ! Resolve failed: ${(err as Error).message}`);
      continue;
    }

    for (const file of files) {
      const dest = join(DATA_DIR, file.filename);
      console.log(`  → ${file.filename}`);
      console.log(`    from ${file.source}`);
      try {
        downloadWithCurl(file.source, dest);
      } catch (err) {
        console.error(`    ! curl failed: ${(err as Error).message}`);
        continue;
      }
      const bytes = statSync(dest).size;
      console.log(`    ✓ ${formatBytes(bytes)} written`);

      // Post-process IESO XML → compact JSON for the frontend.
      if (file.filename.endsWith(".xml") && ds.key === "ieso") {
        const jsonDest = dest.replace(/\.xml$/, ".json");
        try {
          const jsonBytes = processIesoXml(dest, jsonDest);
          console.log(`    ✓ IESO JSON: ${formatBytes(jsonBytes)} → ${jsonDest.split("/").pop()}`);
        } catch (err) {
          console.error(`    ! IESO XML→JSON failed: ${(err as Error).message}`);
        }
      }

      const manifestKey = file.meta?.year
        ? `${ds.key}-${file.meta.year}`
        : ds.key;
      manifest.entries[manifestKey] = {
        path: `/data/${file.filename}`,
        source: file.source,
        bytes,
        fetchedAt: new Date().toISOString(),
        meta: file.meta,
      };
    }
  }

  manifest.generatedAt = new Date().toISOString();
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log(`\nManifest updated: ${MANIFEST_PATH}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureCurl(): void {
  const probe = spawnSync("curl", ["--version"], { stdio: "ignore" });
  if (probe.status !== 0) {
    console.error(
      "curl is required but not on PATH. Install it (or use Homebrew: `brew install curl`)."
    );
    process.exit(127);
  }
}

/**
 * Stream a URL to disk using curl. Uses --fail so HTTP errors surface
 * as a non-zero exit, --location to follow redirects, --retry to
 * smooth over transient hiccups, and --output to write atomically.
 */
function downloadWithCurl(url: string, dest: string): void {
  const tmp = `${dest}.partial`;
  if (existsSync(tmp)) rmSync(tmp);
  execFileSync(
    "curl",
    [
      "--silent",
      "--show-error",
      "--fail",
      "--location",
      "--retry",
      "3",
      "--retry-delay",
      "2",
      "--connect-timeout",
      "20",
      "--max-time",
      "900",
      "--output",
      tmp,
      url,
    ],
    { stdio: ["ignore", "inherit", "inherit"] }
  );
  // Promote .partial → final atomically once curl is done.
  if (existsSync(dest)) rmSync(dest);
  renameSync(tmp, dest);
}

/** GET + JSON parse via curl so we don't need a fetch polyfill on older Node. */
function curlJson<T>(url: string): T {
  const out = execFileSync(
    "curl",
    [
      "--silent",
      "--show-error",
      "--fail",
      "--location",
      "--retry",
      "3",
      "--retry-delay",
      "2",
      "--connect-timeout",
      "20",
      "--max-time",
      "60",
      url,
    ],
    { encoding: "utf-8" }
  );
  return JSON.parse(out) as T;
}

function loadManifest(): Manifest {
  if (!existsSync(MANIFEST_PATH)) {
    return { generatedAt: new Date().toISOString(), entries: {} };
  }
  try {
    const raw = readFileSync(MANIFEST_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Manifest;
    return {
      generatedAt: parsed.generatedAt ?? new Date().toISOString(),
      entries: parsed.entries ?? {},
    };
  } catch {
    return { generatedAt: new Date().toISOString(), entries: {} };
  }
}

function extractYear(name: string | undefined): number | null {
  if (!name) return null;
  const match = name.match(/(20\d{2})/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

function formatBytes(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)} GB`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)} MB`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)} kB`;
  return `${n} B`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
