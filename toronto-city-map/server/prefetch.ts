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
// Usage:
//   npm run prefetch                  # all datasets
//   npm run prefetch -- buildings     # subset
//   npm run prefetch -- energy wards
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
      const top = yearly[0];
      return [
        {
          filename: `annual-energy-consumption-${top.year}.xlsx`,
          source: top.r.url,
          meta: { year: top.year, resourceName: top.r.name },
        },
      ];
    },
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
      manifest.entries[ds.key] = {
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
 * smooth over transient hiccups, and --continue-at to resume from a
 * prior partial when CKAN drops the connection mid-stream (which it
 * does often for the 600 MB Building Outlines resource).
 */
function downloadWithCurl(url: string, dest: string): void {
  const tmp = `${dest}.partial`;
  // Allow up to N retries with byte-range resume between attempts.
  const MAX_ATTEMPTS = 6;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const args = [
        "--show-error",
        "--fail",
        "--location",
        "--retry",
        "3",
        "--retry-delay",
        "2",
        "--retry-all-errors",
        "--connect-timeout",
        "30",
        // No --max-time: let big files run as long as they need.
      ];
      // Resume if a partial exists, otherwise start fresh.
      if (existsSync(tmp) && statSync(tmp).size > 0) {
        args.push("--continue-at", "-");
      }
      args.push("--output", tmp, url);
      execFileSync("curl", args, { stdio: ["ignore", "inherit", "inherit"] });
      lastError = null;
      break;
    } catch (err) {
      lastError = err;
      console.error(
        `    · attempt ${attempt}/${MAX_ATTEMPTS} failed: ${
          (err as Error).message.split("\n")[0]
        }`
      );
      // Brief backoff before resuming.
      const delaySec = Math.min(15, 2 * attempt);
      try {
        execFileSync("sleep", [String(delaySec)], { stdio: "ignore" });
      } catch {
        // sleep absent on minimal images — fall through.
      }
    }
  }
  if (lastError) {
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
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
