// Domain types for the Toronto building topology stream.
//
// The on-disk dataset (Toronto Open Data: topographic-mapping-building-outlines)
// publishes polygon geometry in WGS84 with a small set of attributes per
// feature. We normalize to a flat record keyed by `id` for fast streaming
// updates without re-rendering the entire layer.

export type LngLat = [number, number];
export type Ring = LngLat[];

/** A single building footprint, ready for deck.gl PolygonLayer ingestion. */
export interface Building {
  /** Stable identifier from the open-data source (we hash if missing). */
  id: string;
  /** Outer ring (closed) — additional rings supported via `holes`. */
  contour: Ring;
  /** Optional inner rings (courtyards, atria). */
  holes?: Ring[];
  /** Building height in metres. Source field: MAX_HEIGHT (or estimated). */
  height: number;
  /** Roof / ground elevation reference, metres above sea level. */
  baseElevation?: number;
  /** Source category — residential, commercial, civic, etc. */
  category?: string;
  /** Free-form display name (street address or POI). */
  label?: string;
}

/** A live event coming over the websocket stream. */
export type StreamEventKind =
  | "highlight" // colour-fill change with TTL
  | "annotate" // outline annotation with text label
  | "alert" // sustained alert state (until cleared)
  | "clear"; // remove highlights / annotations

export interface StreamEvent {
  /** ISO timestamp from the source. */
  ts: string;
  /** Building target. */
  buildingId: string;
  kind: StreamEventKind;
  /** Optional CSS/hex colour for highlight + annotate kinds. */
  color?: string;
  /** Optional human-readable note (renders in the feed and as outline label). */
  note?: string;
  /** TTL in milliseconds. Defaults differ by kind. */
  ttlMs?: number;
  /** Severity score 0..1 — drives outline weight + accent intensity. */
  severity?: number;
}

/** Materialised state for a single building's overlay annotations. */
export interface BuildingOverlay {
  buildingId: string;
  color?: [number, number, number, number];
  outlineColor?: [number, number, number, number];
  outlineWidth?: number;
  note?: string;
  expiresAt?: number;
  severity?: number;
  kind: StreamEventKind;
}

export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "live"
  | "reconnecting"
  | "error"
  | "offline";
