// Ward overlay state manager.
//
// Manages highlight/annotation state for Toronto wards, similar to how
// OverlayState manages building overlays. Wards can be highlighted with
// colors, outlines, and notes that have TTLs for automatic expiration.

import type { StreamEvent, StreamEventKind } from "./types";
import { hexToRgba } from "./stream";

export interface WardOverlay {
  wardId: string;
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

const KIND_DEFAULT_TTL: Record<StreamEventKind, number> = {
  highlight: 8000,
  annotate: 18000,
  alert: 15000,
  clear: 0,
};

const KIND_OUTLINE_WIDTH: Record<StreamEventKind, number> = {
  highlight: 3.5,
  annotate: 4.5,
  alert: 6,
  clear: 0,
};

export class WardOverlayState {
  private map = new Map<string, WardOverlay>();
  /** Monotonically increasing version — change this to bust deck.gl's data diff. */
  version = 0;

  apply(e: StreamEvent, now = Date.now()): void {
    // Only process ward-targeted events
    if (e.targetType !== "ward") return;
    
    if (e.kind === "clear") {
      if (this.map.delete(e.buildingId)) this.version += 1; // buildingId is reused for wardId
      return;
    }
    const ttl = e.ttlMs ?? KIND_DEFAULT_TTL[e.kind];
    const color = e.color ? hexToRgba(e.color, e.kind === "annotate" ? 80 : 120) : undefined;
    const outlineColor = e.color ? hexToRgba(e.color, 255) : undefined;
    const outlineWidth =
      KIND_OUTLINE_WIDTH[e.kind] *
      (1 + (e.severity ?? 0.4) * (e.kind === "alert" ? 1.4 : 0.6));
    this.map.set(e.buildingId, {
      wardId: e.buildingId, // buildingId field is reused for wardId
      color,
      outlineColor,
      outlineWidth,
      note: e.note,
      severity: e.severity,
      kind: e.kind,
      sourceId: e.sourceId,
      hex: e.color,
      startedAt: now,
      ttlMs: ttl || undefined,
      expiresAt: ttl ? now + ttl : undefined,
    });
    this.version += 1;
  }

  /** Drop expired overlays. Returns true if any were removed. */
  tick(now = Date.now()): boolean {
    let changed = false;
    for (const [k, v] of this.map) {
      if (v.expiresAt && v.expiresAt <= now) {
        this.map.delete(k);
        changed = true;
      }
    }
    if (changed) this.version += 1;
    return changed;
  }

  get(id: string): WardOverlay | undefined {
    return this.map.get(id);
  }

  size(): number {
    return this.map.size;
  }

  /** All currently-active overlays. */
  entries(): WardOverlay[] {
    return Array.from(this.map.values());
  }

  clear() {
    if (this.map.size) {
      this.map.clear();
      this.version += 1;
    }
  }
}

// ---------------------------------------------------------------------------
// Deck.gl accessor helpers for ward overlays
// ---------------------------------------------------------------------------
//
// Visual language:
//   - Base wards sit quietly on the map: a faint warm-gold tint and a
//     deliberate amber boundary line. Distinct from the cyan accent
//     reserved for buildings + UI chrome, so the two systems read as
//     separate strata.
//   - Highlighted wards “take over” — they paint with the event colour
//     and thicken the boundary so the affected district pops.

/** Faint warm wash so wards are perceptible without muddying the map. */
export const WARD_BASE_FILL: [number, number, number, number] = [232, 188, 110, 18];

/** Default boundary — warm gold, strong enough to read against dark basemap. */
export const WARD_BASE_OUTLINE: [number, number, number, number] = [232, 188, 110, 180];

/** Default boundary width in pixels (when no overlay is active). */
export const WARD_BASE_LINE_WIDTH = 1.6;

/**
 * Pick fill colour for a ward based on overlay state.
 */
export function pickWardFill(
  overlay: WardOverlay | undefined
): [number, number, number, number] {
  if (overlay?.color) return overlay.color;
  return WARD_BASE_FILL;
}

/**
 * Pick outline colour for a ward based on overlay state.
 */
export function pickWardLineColor(
  overlay: WardOverlay | undefined
): [number, number, number, number] {
  if (overlay?.outlineColor) return overlay.outlineColor;
  return WARD_BASE_OUTLINE;
}

/**
 * Pick outline width for a ward based on overlay state.
 */
export function pickWardLineWidth(
  overlay: WardOverlay | undefined
): number {
  if (overlay?.outlineWidth) return overlay.outlineWidth;
  return WARD_BASE_LINE_WIDTH;
}
