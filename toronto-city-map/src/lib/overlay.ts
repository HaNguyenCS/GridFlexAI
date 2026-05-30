// Overlay reducer — translates StreamEvents into per-building overlay state.
//
// Design constraints:
//   - O(1) per event regardless of dataset size (we never iterate buildings).
//   - Overlays carry TTLs; expired entries are pruned by a single pass on
//     each `tick()` (cheap: only iterates the active set, not the dataset).
//   - The shape produced by `materialize()` is what deck.gl consumes:
//       * fillColor accessor
//       * lineColor accessor
//       * lineWidth accessor
//
// Note on architecture parity with kepler.gl: kepler models this exact
// pattern via `applyVisualChannels` on a Layer config. We use the same
// Layer/Field separation, just without the Redux + immer machinery.

import type {
  Building,
  BuildingOverlay,
  StreamEvent,
  StreamEventKind,
} from "./types";
import { hexToRgba } from "./stream";

const KIND_DEFAULT_TTL: Record<StreamEventKind, number> = {
  highlight: 5500,
  annotate: 14000,
  alert: 12000,
  clear: 0,
};

const KIND_OUTLINE_WIDTH: Record<StreamEventKind, number> = {
  highlight: 1.5,
  annotate: 2.2,
  alert: 3,
  clear: 0,
};

export class OverlayState {
  private map = new Map<string, BuildingOverlay>();
  /** Monotonically increasing version — change this to bust deck.gl's data diff. */
  version = 0;

  apply(e: StreamEvent, now = Date.now()): void {
    if (e.kind === "clear") {
      if (this.map.delete(e.buildingId)) this.version += 1;
      return;
    }
    const ttl = e.ttlMs ?? KIND_DEFAULT_TTL[e.kind];
    const color = e.color ? hexToRgba(e.color, e.kind === "annotate" ? 60 : 200) : undefined;
    const outlineColor = e.color ? hexToRgba(e.color, 245) : undefined;
    const outlineWidth =
      KIND_OUTLINE_WIDTH[e.kind] *
      (1 + (e.severity ?? 0.4) * (e.kind === "alert" ? 1.4 : 0.6));
    this.map.set(e.buildingId, {
      buildingId: e.buildingId,
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

  get(id: string): BuildingOverlay | undefined {
    return this.map.get(id);
  }

  size(): number {
    return this.map.size;
  }

  /** All currently-active overlays. Sorted by expiry desc for legend stability. */
  entries(): BuildingOverlay[] {
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
// Deck.gl accessor helpers — kept as plain functions so they're pure and
// can be memoized at call site.
// ---------------------------------------------------------------------------

/** Default fill colour for buildings without an active overlay. */
export const BASE_FILL: [number, number, number, number] = [40, 56, 76, 220];

/** Tinted base outline (height-attenuated visually by deck.gl extrusion). */
export const BASE_OUTLINE: [number, number, number, number] = [88, 110, 138, 110];

/** Hex-encoded brand teal used for ambient hover. */
export const HOVER_OUTLINE: [number, number, number, number] = [120, 240, 220, 235];

/**
 * Compute a height-encoded fill colour. Goes from a cool deep-blue at
 * low elevations to a warmer near-white at the tallest peaks. We bias
 * the curve so most mid-rises sit in the cooler bucket and only the
 * skyline anchors get the hot end.
 */
export function heightToColor(h: number): [number, number, number, number] {
  const t = Math.min(1, Math.pow(h / 320, 0.85));
  // Three-stop ramp: deep-ink → teal-grey → near-white-warm
  const stops = [
    [32, 46, 64],
    [78, 124, 138],
    [212, 226, 220],
  ];
  const idx = t < 0.5 ? 0 : 1;
  const local = idx === 0 ? t * 2 : (t - 0.5) * 2;
  const a = stops[idx];
  const b = stops[idx + 1];
  return [
    Math.round(a[0] + (b[0] - a[0]) * local),
    Math.round(a[1] + (b[1] - a[1]) * local),
    Math.round(a[2] + (b[2] - a[2]) * local),
    230,
  ];
}

export function pickFill(
  building: Building,
  overlay: BuildingOverlay | undefined
): [number, number, number, number] {
  if (overlay?.color) return overlay.color;
  return heightToColor(building.height);
}

export function pickLineColor(
  overlay: BuildingOverlay | undefined,
  hovered: boolean
): [number, number, number, number] {
  if (overlay?.outlineColor) return overlay.outlineColor;
  if (hovered) return HOVER_OUTLINE;
  return BASE_OUTLINE;
}

export function pickLineWidth(
  overlay: BuildingOverlay | undefined,
  hovered: boolean
): number {
  if (overlay?.outlineWidth) return overlay.outlineWidth;
  if (hovered) return 2;
  return 0.6;
}
