// Bottom-left legend / control surface.
//
// Shows the height-encoded colour ramp, event-kind key, and quick filters.
// Designed as the second-most-glanceable element after the live status pill.

import { useMemo } from "react";

interface Props {
  /** All current overlay kinds (drives the live counts on the legend rows). */
  kindCounts: Record<string, number>;
  hoveredLabel: string | null;
  hoveredHeight: number | null;
  hoveredCategory: string | null;
}

export function LegendPanel({
  kindCounts,
  hoveredLabel,
  hoveredHeight,
  hoveredCategory,
}: Props) {
  const ramp = useMemo(
    () =>
      Array.from({ length: 24 }, (_, i) => {
        const t = i / 23;
        return colorAt(t);
      }),
    []
  );

  return (
    <aside className="pointer-events-auto absolute bottom-6 left-6 z-10 flex w-[280px] flex-col gap-4 rounded-[14px] border border-[var(--color-ink-3)] bg-[color-mix(in_oklch,var(--color-ink-1)_88%,transparent)] p-4 backdrop-blur-xl">
      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-[var(--color-ink-6)]">
            Building height
          </span>
          <span className="font-mono text-[10.5px] tabular-nums text-[var(--color-ink-5)]">
            metres
          </span>
        </div>
        <div className="flex h-2.5 w-full overflow-hidden rounded-full">
          {ramp.map((c, i) => (
            <span
              key={i}
              className="block h-full flex-1"
              style={{ background: c }}
            />
          ))}
        </div>
        <div className="mt-1.5 flex items-center justify-between font-mono text-[10.5px] tabular-nums text-[var(--color-ink-5)]">
          <span>10</span>
          <span>120</span>
          <span>320+</span>
        </div>
      </div>

      <div className="h-px bg-[var(--color-ink-2)]" />

      <div>
        <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.22em] text-[var(--color-ink-6)]">
          Event kinds
        </div>
        <ul className="grid grid-cols-1 gap-1.5">
          <KindRow
            color="var(--color-accent)"
            label="Highlight"
            count={kindCounts.highlight ?? 0}
            hint="TTL · 5s"
          />
          <KindRow
            color="#7ad4ff"
            label="Annotate"
            count={kindCounts.annotate ?? 0}
            hint="TTL · 14s"
          />
          <KindRow
            color="var(--color-alert)"
            label="Alert"
            count={kindCounts.alert ?? 0}
            hint="until cleared"
          />
        </ul>
      </div>

      <div className="h-px bg-[var(--color-ink-2)]" />

      <div className="min-h-[48px]">
        <div className="mb-1 font-mono text-[10.5px] uppercase tracking-[0.22em] text-[var(--color-ink-6)]">
          Cursor
        </div>
        {hoveredLabel ? (
          <div>
            <div className="truncate text-[13px] text-[var(--color-ink-8)]">
              {hoveredLabel}
            </div>
            <div className="mt-0.5 flex items-center gap-2 font-mono text-[11px] tabular-nums text-[var(--color-ink-5)]">
              <span>{Math.round(hoveredHeight ?? 0)} m</span>
              <span aria-hidden>·</span>
              <span className="capitalize">{hoveredCategory ?? "—"}</span>
            </div>
          </div>
        ) : (
          <div className="text-[12.5px] text-[var(--color-ink-5)]">
            Hover the model to inspect a footprint.
          </div>
        )}
      </div>
    </aside>
  );
}

function KindRow({
  color,
  label,
  count,
  hint,
}: {
  color: string;
  label: string;
  count: number;
  hint: string;
}) {
  return (
    <li className="flex items-center gap-3">
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
        style={{ backgroundColor: color }}
        aria-hidden
      />
      <span className="flex-1 text-[12.5px] text-[var(--color-ink-7)]">{label}</span>
      <span className="font-mono text-[10.5px] tabular-nums text-[var(--color-ink-5)]">
        {hint}
      </span>
      <span className="w-8 text-right font-mono text-[12px] tabular-nums text-[var(--color-ink-8)]">
        {count}
      </span>
    </li>
  );
}

// Mirrors `heightToColor` from overlay.ts but emits CSS rgb() strings for
// the static legend strip. Kept as a tiny duplicate to avoid an import
// cycle — both are derived from the same three-stop ramp.
function colorAt(t: number): string {
  const stops = [
    [32, 46, 64],
    [78, 124, 138],
    [212, 226, 220],
  ];
  const idx = t < 0.5 ? 0 : 1;
  const local = idx === 0 ? t * 2 : (t - 0.5) * 2;
  const a = stops[idx];
  const b = stops[idx + 1];
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * local)}, ${Math.round(
    a[1] + (b[1] - a[1]) * local
  )}, ${Math.round(a[2] + (b[2] - a[2]) * local)})`;
}
