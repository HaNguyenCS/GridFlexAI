// Ward overlay state manager.

import type { StreamEvent, StreamEventKind } from "./mapTypes";
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
  version = 0;

  apply(e: StreamEvent, now = Date.now()): void {
    if (e.targetType !== "ward") return;
    
    if (e.kind === "clear") {
      if (this.map.delete(e.buildingId)) this.version += 1;
      return;
    }
    const ttl = e.ttlMs ?? KIND_DEFAULT_TTL[e.kind];
    const color = e.color ? hexToRgba(e.color, e.kind === "annotate" ? 80 : 120) : undefined;
    const outlineColor = e.color ? hexToRgba(e.color, 255) : undefined;
    const outlineWidth =
      KIND_OUTLINE_WIDTH[e.kind] *
      (1 + (e.severity ?? 0.4) * (e.kind === "alert" ? 1.4 : 0.6));
    this.map.set(e.buildingId, {
      wardId: e.buildingId,
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

  get(id: string): WardOverlay | undefined {
    return this.map.get(id);
  }

  size(): number {
    return this.map.size;
  }

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

export const WARD_BASE_FILL: [number, number, number, number] = [232, 188, 110, 18];
export const WARD_BASE_OUTLINE: [number, number, number, number] = [232, 188, 110, 180];
export const WARD_BASE_LINE_WIDTH = 1.6;

export function pickWardLineWidth(
  overlay: WardOverlay | undefined
): number {
  if (overlay?.outlineWidth) return overlay.outlineWidth;
  return WARD_BASE_LINE_WIDTH;
}
