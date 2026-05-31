// Stream sources registry.
//
// The Sources Panel (plugin UI) writes through to this module; App.tsx
// reads the active list and spawns one transport per enabled entry via
// the existing `connectStream` helper. Each source spawns its own
// StreamHandle; events get `sourceId` tagged at the manager layer.

import type { StreamSource, StreamEventKind } from "./types";

const STORAGE_KEY = "toronto-city-map/sources/v1";

export const MOCK_URL = "mock://built-in";

/**
 * Default source list. Always includes the in-process simulator so the
 * demo lights up offline. If a `VITE_STREAM_URL` is configured at build
 * time it is also seeded as an enabled source.
 */
export function getDefaultSources(): StreamSource[] {
  const seeded: StreamSource[] = [
    {
      id: "src-mock",
      name: "Built-in simulator",
      url: MOCK_URL,
      color: "#5cf2c8",
      enabled: false,
      tag: "Demo",
    },
  ];
  const fromEnv = import.meta.env.VITE_STREAM_URL as string | undefined;
  if (fromEnv) {
    seeded.unshift({
      id: "src-env",
      name: "VITE_STREAM_URL",
      url: fromEnv,
      color: "#7ad4ff",
      enabled: true,
      tag: "Env",
    });
  }
  return seeded;
}

export function loadSources(): StreamSource[] {
  if (typeof window === "undefined") return getDefaultSources();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return getDefaultSources();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return getDefaultSources();
    const cleaned = parsed
      .filter(isValidSource)
      .map((s) => ({ ...s, enabled: Boolean(s.enabled) }));
    if (cleaned.length === 0) return getDefaultSources();
    return cleaned;
  } catch {
    return getDefaultSources();
  }
}

export function saveSources(sources: StreamSource[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sources));
  } catch {
    /* quota or privacy mode — ignore */
  }
}

function isValidSource(s: unknown): s is StreamSource {
  if (!s || typeof s !== "object") return false;
  const r = s as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.name === "string" &&
    typeof r.url === "string" &&
    typeof r.color === "string"
  );
}

export function isMockSource(s: StreamSource): boolean {
  return s.url === MOCK_URL || s.url === "" || s.url.startsWith("mock://");
}

export function newSourceId(): string {
  const rnd = Math.random().toString(36).slice(2, 8);
  return `src-${Date.now().toString(36)}-${rnd}`;
}

/** Palette offered when the user adds a new source. Stays inside the brand spectrum. */
export const SOURCE_COLOR_PALETTE: { name: string; hex: string }[] = [
  { name: "Cyan", hex: "#5cf2c8" },
  { name: "Sky", hex: "#7ad4ff" },
  { name: "Amber", hex: "#ffc66e" },
  { name: "Rose", hex: "#ff8a8a" },
  { name: "Violet", hex: "#c89cff" },
  { name: "Mint", hex: "#9ef0c0" },
];

/** Human label for a kind, used by the legend and callouts. */
export const KIND_LABEL: Record<StreamEventKind, string> = {
  highlight: "Highlight",
  annotate: "Annotate",
  alert: "Alert",
  clear: "Clear",
};

/** Default brand colour for a kind when an event doesn't override it. */
export const KIND_COLOR: Record<StreamEventKind, string> = {
  highlight: "#5cf2c8",
  annotate: "#7ad4ff",
  alert: "#ff6b6b",
  clear: "#5b6e85",
};
