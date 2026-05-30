// Live event feed — bottom-right column showing the stream as it lands.
//
// Treats the feed as the pulse of the page. Newest event slides in at
// the top, older ones fade and shrink. We cap visible rows to 8 so the
// panel never grows tall enough to compete with the map.

import { useMemo } from "react";
import {
  ArrowSquareOut,
  Broadcast,
  Crosshair,
  PauseCircle,
  PlayCircle,
  Sparkle,
  Warning,
} from "@phosphor-icons/react";
import clsx from "clsx";
import type { StreamEvent, GridStreamEvent } from "../lib/types";
import { SEVERITY_LABELS } from "../lib/gridStreams";

interface FeedItem extends StreamEvent {
  buildingLabel?: string;
  arrivedAt: number;
}

interface GridFeedItem extends GridStreamEvent {
  arrivedAt: number;
}

interface Props {
  items: FeedItem[];
  paused: boolean;
  onTogglePause: () => void;
  onFocus: (buildingId: string) => void;
  onInjectAlert: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  /** Grid stream events to interleave in the feed. */
  gridItems?: GridFeedItem[];
}

const KIND_META: Record<
  StreamEvent["kind"],
  { label: string; tone: string; Icon: typeof Sparkle }
> = {
  highlight: {
    label: "Highlight",
    tone: "text-[var(--color-accent)]",
    Icon: Sparkle,
  },
  annotate: {
    label: "Annotate",
    tone: "text-[#7ad4ff]",
    Icon: Crosshair,
  },
  alert: {
    label: "Alert",
    tone: "text-[var(--color-alert)]",
    Icon: Warning,
  },
  clear: {
    label: "Clear",
    tone: "text-[var(--color-ink-6)]",
    Icon: Broadcast,
  },
};

export function EventFeed({ items, paused, onTogglePause, onFocus, onInjectAlert, collapsed, onToggleCollapse, gridItems = [] }: Props) {
  // Merge building events and grid events, sorted by arrival time desc.
  const merged = useMemo(() => {
    type MixedItem =
      | { type: "building"; item: FeedItem }
      | { type: "grid"; item: GridFeedItem };

    const all: MixedItem[] = [
      ...items.map((i) => ({ type: "building" as const, item: i })),
      ...gridItems.map((i) => ({ type: "grid" as const, item: i })),
    ];
    all.sort((a, b) => b.item.arrivedAt - a.item.arrivedAt);
    return all.slice(0, 8);
  }, [items, gridItems]);

  return (
    <section
      className="pointer-events-auto absolute bottom-6 right-6 z-10 flex w-[360px] max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-[14px] border border-[var(--color-ink-3)] bg-[color-mix(in_oklch,var(--color-ink-1)_88%,transparent)] backdrop-blur-xl transition-all duration-300 ease-in-out"
      aria-label="Live event feed"
    >
      <header className="flex items-center justify-between gap-3 border-b border-[var(--color-ink-3)] px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-6 w-6 place-items-center rounded-md bg-[color-mix(in_oklch,var(--color-accent)_18%,var(--color-ink-2))]">
            <Broadcast size={13} weight="bold" className="text-[var(--color-accent)]" />
          </span>
          <span className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-[var(--color-ink-6)]">
            Stream feed
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onInjectAlert}
            className="grid h-7 w-7 place-items-center rounded-md text-[var(--color-ink-6)] transition-colors hover:bg-[var(--color-ink-2)] hover:text-[var(--color-alert)] active:translate-y-px"
            title="Inject test alert"
          >
            <Warning size={14} weight="bold" />
          </button>
          <button
            type="button"
            onClick={onTogglePause}
            className="grid h-7 w-7 place-items-center rounded-md text-[var(--color-ink-6)] transition-colors hover:bg-[var(--color-ink-2)] hover:text-[var(--color-ink-8)] active:translate-y-px"
            title={paused ? "Resume stream" : "Pause stream"}
          >
            {paused ? (
              <PlayCircle size={16} weight="bold" />
            ) : (
              <PauseCircle size={16} weight="bold" />
            )}
          </button>
          <button
            type="button"
            onClick={onToggleCollapse}
            className="grid h-7 w-7 place-items-center rounded-md text-[var(--color-ink-6)] transition-colors hover:bg-[var(--color-ink-2)] hover:text-[var(--color-ink-8)] active:translate-y-px"
            title={collapsed ? "Expand feed" : "Collapse feed"}
          >
            {collapsed ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>
            )}
          </button>
        </div>
      </header>

      {!collapsed && (
        <ol className="flex max-h-[360px] flex-col divide-y divide-[var(--color-ink-2)] overflow-y-auto">
          {merged.length === 0 ? (
            <li className="px-4 py-10 text-center text-[12.5px] text-[var(--color-ink-5)]">
              Waiting for the first event<span className="ml-1">…</span>
            </li>
          ) : (
            merged.map((e) => {
              // ── Grid stream row ────────────────────────────────────────
              if (e.type === "grid") {
                const g = e.item as GridFeedItem;
                return (
                  <li
                    key={`grid-${g.ts}-${g.wardId}`}
                    className="event-row-enter group flex items-start gap-3 px-4 py-3"
                  >
                    <span
                      className="mt-[3px] grid h-5 w-5 shrink-0 place-items-center rounded-[5px]"
                      style={{ backgroundColor: g.color + "22", color: g.color }}
                    >
                      <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="1" width="6" height="6" rx="1"/><rect x="9" y="1" width="6" height="6" rx="1"/><rect x="1" y="9" width="6" height="6" rx="1"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg>
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span
                          className="font-mono text-[10px] uppercase tracking-[0.18em]"
                          style={{ color: g.color }}
                        >
                          {SEVERITY_LABELS[g.severity]}
                        </span>
                        <span className="font-mono text-[10.5px] tabular-nums text-[var(--color-ink-5)]">
                          {timeOf(g.ts)}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-[13px] text-[var(--color-ink-8)]">
                        {g.metric} — <span className="font-mono tabular-nums">{g.value.toFixed(1)}</span>
                      </p>
                      <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-[var(--color-ink-6)]">
                        <span className="font-mono tabular-nums">{g.wardId}</span>
                      </span>
                    </div>
                  </li>
                );
              }

              // ── Building stream row (existing) ────────────────────────
              const ev = e.item as FeedItem;
              const meta = KIND_META[ev.kind];
              const Icon = meta.Icon;
              return (
                <li
                  key={`${ev.ts}-${ev.buildingId}-${ev.kind}`}
                  className="event-row-enter group flex items-start gap-3 px-4 py-3"
                >
                  <span
                    className={clsx(
                      "mt-[3px] grid h-5 w-5 shrink-0 place-items-center rounded-[5px] bg-[var(--color-ink-2)]",
                      meta.tone
                    )}
                  >
                    <Icon size={11} weight="bold" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span
                        className={clsx(
                          "font-mono text-[10px] uppercase tracking-[0.18em]",
                          meta.tone
                        )}
                      >
                        {meta.label}
                      </span>
                      <span className="font-mono text-[10.5px] tabular-nums text-[var(--color-ink-5)]">
                        {timeOf(ev.ts)}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-[13px] text-[var(--color-ink-8)]">
                      {ev.note || "—"}
                    </p>
                    <button
                      type="button"
                      onClick={() => onFocus(ev.buildingId)}
                      className="mt-1 inline-flex items-center gap-1 text-[11px] text-[var(--color-ink-6)] transition-colors hover:text-[var(--color-accent)]"
                    >
                      <span className="font-mono tabular-nums">
                        {ev.buildingLabel ?? ev.buildingId}
                      </span>
                      <ArrowSquareOut size={11} weight="bold" />
                    </button>
                  </div>
                </li>
              );
            })
          )}
        </ol>
      )}
    </section>
  );
}

function timeOf(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export type { FeedItem, GridFeedItem };
