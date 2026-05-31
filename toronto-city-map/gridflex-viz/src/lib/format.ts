import type { ZoneStatus } from "./types";

export const STATUS_COLORS: Record<ZoneStatus, string> = {
  ok: "#22c55e",
  over_capacity: "#eab308",
  warning: "#f97316",
  issue: "#ef4444",
};

export function statusFillColor(status: ZoneStatus | undefined): string {
  return STATUS_COLORS[status ?? "ok"];
}

export function formatMw(value: number | undefined): string {
  if (value == null) return "—";
  return `${value.toFixed(1)} MW`;
}

export function formatMoney(value: number | undefined): string {
  if (value == null) return "—";
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}
