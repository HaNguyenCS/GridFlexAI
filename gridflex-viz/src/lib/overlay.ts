// Overlay reducer — translates StreamEvents into per-building overlay state.

import type {
  Building,
  BuildingOverlay,
  StreamEvent,
  StreamEventKind,
} from "./mapTypes";
import { hexToRgba } from "./stream";
import { getPalette, interpolatePalette } from "./heightPalettes";

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

export const BASE_FILL: [number, number, number, number] = [40, 56, 76, 220];
export const BASE_OUTLINE: [number, number, number, number] = [88, 110, 138, 110];
export const HOVER_OUTLINE: [number, number, number, number] = [120, 240, 220, 235];

export function heightToColor(
  h: number,
  paletteId = 'elevation'
): [number, number, number, number] {
  const t = Math.min(1, Math.pow(h / 320, 0.85));
  const palette = getPalette(paletteId);
  return interpolatePalette(t, palette);
}

export function pickFill(
  building: Building,
  overlay: BuildingOverlay | undefined,
  paletteId = 'elevation'
): [number, number, number, number] {
  if (overlay?.color) return overlay.color;
  return heightToColor(building.height, paletteId);
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
