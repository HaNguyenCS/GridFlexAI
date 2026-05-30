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
import type { StreamEvent } from "../lib/types";

interface FeedItem extends StreamEvent {
  buildingLabel?: string;
  arrivedAt: number;
}

interface Props {
  items: FeedItem[];
  paused: boolean;
  onTogglePause: () => void;
  onFocus: (buildingId: string) => void;
  onInjectAlert: () => void;
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

export function EventFeed({ items, paused, onTogglePause, onFocus, onInjectAlert }: Props) {
  const visible = useMemo(() => items.slice(0, 8), [items]);

  return (
    <section
      className="pointer-events-auto absolute bottom-6 right-6 z-10 flex w-[360px] max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-[14px] border border-[var(--color-ink-3)] bg-[color-mix(in_oklch,var(--color-ink-1)_88%,transparent)] backdrop-blur-xl"
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
        </div>
      </header>

      <ol className="flex max-h-[360px] flex-col divide-y divide-[var(--color-ink-2)] overflow-y-auto">
        {visible.length === 0 ? (
          <li className="px-4 py-10 text-center text-[12.5px] text-[var(--color-ink-5)]">
            Waiting for the first event<span className="ml-1">…</span>
          </li>
        ) : (
          visible.map((e) => {
            const meta = KIND_META[e.kind];
            const Icon = meta.Icon;
            return (
              <li
                key={`${e.ts}-${e.buildingId}-${e.kind}`}
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
                      {timeOf(e.ts)}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-[13px] text-[var(--color-ink-8)]">
                    {e.note || "—"}
                  </p>
                  <button
                    type="button"
                    onClick={() => onFocus(e.buildingId)}
                    className="mt-1 inline-flex items-center gap-1 text-[11px] text-[var(--color-ink-6)] transition-colors hover:text-[var(--color-accent)]"
                  >
                    <span className="font-mono tabular-nums">
                      {e.buildingLabel ?? e.buildingId}
                    </span>
                    <ArrowSquareOut size={11} weight="bold" />
                  </button>
                </div>
              </li>
            );
          })
        )}
      </ol>
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

export type { FeedItem };
