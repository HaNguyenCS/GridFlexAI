// LegendPanel — bottom-left control surface.
//
// Two responsibilities:
//   1. Show the height-encoded colour ramp (passive reference).
//   2. Render dynamic layer toggles for every annotation kind currently
//      seen on the wire, plus per-source rows. Toggling a row hides the
//      corresponding overlays both on the map and as floating callouts.
//
// Rows render by introspection: kinds and sources only appear once the
// system has actually observed them, so the legend grows organically
// while the stream runs. Disabling a layer fades the row in place
// rather than collapsing the panel — preserves spatial memory.

import { useMemo } from "react";
import { Eye, EyeSlash } from "@phosphor-icons/react";
import clsx from "clsx";
import type { StreamEventKind, StreamSource } from "../lib/types";
import { KIND_COLOR, KIND_LABEL } from "../lib/sources";

interface Props {
  kindCounts: Record<string, number>;
  sourceCounts: Record<string, number>;
  enabledKinds: Set<StreamEventKind>;
  enabledSources: Set<string>;
  onToggleKind: (kind: StreamEventKind) => void;
  onToggleSource: (sourceId: string) => void;
  /** All sources currently configured — drives the source rows. */
  sources: StreamSource[];
  /** Kinds that the system has ever observed, used to enumerate rows. */
  seenKinds: Set<StreamEventKind>;
  hoveredLabel: string | null;
  hoveredHeight: number | null;
  hoveredCategory: string | null;
}

const KIND_ORDER: StreamEventKind[] = ["highlight", "annotate", "alert"];

export function LegendPanel({
  kindCounts,
  sourceCounts,
  enabledKinds,
  enabledSources,
  onToggleKind,
  onToggleSource,
  sources,
  seenKinds,
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

  // Render kinds in canonical order, but only those we've actually seen.
  const kindRows = useMemo(
    () => KIND_ORDER.filter((k) => seenKinds.has(k)),
    [seenKinds]
  );

  return (
    <aside className="pointer-events-auto absolute bottom-6 left-6 z-10 flex w-[300px] flex-col gap-4 rounded-[14px] border border-[var(--color-ink-3)] bg-[color-mix(in_oklch,var(--color-ink-1)_88%,transparent)] p-4 backdrop-blur-xl">
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
        <div className="mb-2 flex items-baseline justify-between">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-[var(--color-ink-6)]">
            Annotation layers
          </span>
          <span className="font-mono text-[10.5px] tabular-nums text-[var(--color-ink-5)]">
            {enabledKinds.size}/{kindRows.length || "—"} on
          </span>
        </div>
        {kindRows.length === 0 ? (
          <p className="text-[12px] text-[var(--color-ink-5)]">
            Waiting for the first event<span className="ml-1">…</span>
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-1">
            {kindRows.map((k) => (
              <LayerRow
                key={k}
                color={KIND_COLOR[k]}
                label={KIND_LABEL[k]}
                count={kindCounts[k] ?? 0}
                enabled={enabledKinds.has(k)}
                onToggle={() => onToggleKind(k)}
              />
            ))}
          </ul>
        )}
      </div>

      {sources.length > 0 ? (
        <>
          <div className="h-px bg-[var(--color-ink-2)]" />
          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-[var(--color-ink-6)]">
                Source channels
              </span>
              <span className="font-mono text-[10.5px] tabular-nums text-[var(--color-ink-5)]">
                {enabledSources.size}/{sources.length} on
              </span>
            </div>
            <ul className="grid grid-cols-1 gap-1">
              {sources.map((s) => (
                <LayerRow
                  key={s.id}
                  color={s.color}
                  label={s.name}
                  count={sourceCounts[s.id] ?? 0}
                  enabled={enabledSources.has(s.id)}
                  onToggle={() => onToggleSource(s.id)}
                />
              ))}
            </ul>
          </div>
        </>
      ) : null}

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

function LayerRow({
  color,
  label,
  count,
  enabled,
  onToggle,
}: {
  color: string;
  label: string;
  count: number;
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="layer-row-enter">
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={enabled}
        className={clsx(
          "group flex w-full items-center gap-2.5 rounded-[8px] px-1.5 py-1.5 transition-colors active:translate-y-px",
          enabled
            ? "hover:bg-[var(--color-ink-2)]/70"
            : "opacity-50 hover:opacity-80"
        )}
      >
        <span
          aria-hidden
          className={clsx(
            "h-2.5 w-2.5 shrink-0 rounded-[2px] transition-transform",
            !enabled && "scale-90"
          )}
          style={{
            backgroundColor: enabled
              ? color
              : `color-mix(in oklch, ${color} 35%, transparent)`,
          }}
        />
        <span
          className={clsx(
            "flex-1 truncate text-left text-[12.5px] transition-colors",
            enabled ? "text-[var(--color-ink-8)]" : "text-[var(--color-ink-6)]"
          )}
        >
          {label}
        </span>
        <span className="font-mono text-[10.5px] tabular-nums text-[var(--color-ink-5)] tabular-nums">
          {count}
        </span>
        <span
          className={clsx(
            "grid h-5 w-5 place-items-center rounded-md transition-colors",
            enabled
              ? "text-[var(--color-accent)] group-hover:bg-[color-mix(in_oklch,var(--color-accent)_15%,transparent)]"
              : "text-[var(--color-ink-5)] group-hover:bg-[var(--color-ink-2)]"
          )}
        >
          {enabled ? (
            <Eye size={12} weight="bold" />
          ) : (
            <EyeSlash size={12} weight="bold" />
          )}
        </span>
      </button>
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
