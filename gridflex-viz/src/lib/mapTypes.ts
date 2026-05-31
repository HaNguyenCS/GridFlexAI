// Domain types for Toronto buildings and wards.

export type LngLat = [number, number];
export type Ring = LngLat[];

/** A single building footprint, ready for deck.gl PolygonLayer ingestion. */
export interface Building {
  id: string;
  contour: Ring;
  holes?: Ring[];
  height: number;
  baseElevation?: number;
  category?: string;
  label?: string;
}

/** A Toronto ward boundary. */
export interface Ward {
  id: string;
  wardNumber: number;
  name: string;
  contour: Ring;
  holes?: Ring[];
  centroid: LngLat;
  areaKm2?: number;
}

/** Stream event kinds. */
export type StreamEventKind =
  | "highlight"
  | "annotate"
  | "alert"
  | "clear";

export interface StreamEvent {
  ts: string;
  buildingId: string;
  kind: StreamEventKind;
  color?: string;
  note?: string;
  ttlMs?: number;
  severity?: number;
  sourceId?: string;
  targetType?: "building" | "ward";
}

export interface BuildingOverlay {
  buildingId: string;
  color?: [number, number, number, number];
  outlineColor?: [number, number, number, number];
  outlineWidth?: number;
  note?: string;
  expiresAt?: number;
  startedAt?: number;
  ttlMs?: number;
  severity?: number;
  kind: StreamEventKind;
  sourceId?: string;
  hex?: string;
}

/** Grid stream severity types. */
export type GridSeverity = "critical" | "high" | "moderate" | "normal";

export interface GridStreamEvent {
  ts: string;
  wardId: string;
  severity: GridSeverity;
  color: string;
  metric: string;
  value: number;
  ttlMs: number;
}

export interface WardGridColor {
  wardId: string;
  severity: GridSeverity;
  fill: [number, number, number, number];
  outline: [number, number, number, number];
  expiresAt: number;
  metric: string;
  value: number;
}
