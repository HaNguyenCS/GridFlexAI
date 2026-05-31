// MapAgentPanel — floating card stack driven by useMapAgent.
//
// When a ward recovers from a non-green severity back to green the agent
// produces a message card here. Each card shows the transition, a plain-
// language justification, and an "Intervention" action button the operator
// can click to acknowledge and dispatch a field response.

import { useState } from "react";
import {
  Robot,
  Lightning,
  X,
  CaretDown,
  CaretUp,
  CheckCircle,
} from "@phosphor-icons/react";
import clsx from "clsx";
import type { AgentMessage } from "../lib/useMapAgent";
import { SEVERITY_COLORS, SEVERITY_LABELS } from "../lib/gridStreams";

interface Props {
  messages: AgentMessage[];
  unreadCount: number;
  onActioned: (id: string) => void;
  onDismiss: (id: string) => void;
}

const SEVERITY_DOT: Record<string, string> = {
  critical: SEVERITY_COLORS.critical,
  high: SEVERITY_COLORS.high,
  moderate: SEVERITY_COLORS.moderate,
  normal: SEVERITY_COLORS.normal,
};

export function MapAgentPanel({ messages, unreadCount, onActioned, onDismiss }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  if (messages.length === 0) return null;

  return (
    <section
      className={clsx(
        "pointer-events-auto absolute bottom-22 left-6 z-10 flex flex-col overflow-hidden rounded-[14px] transition-all duration-300 ease-in-out",
        "bg-[color-mix(in_oklch,var(--color-ink-1)_88%,transparent)] backdrop-blur-xl",
        collapsed
          ? "w-auto border-0 p-3"
          : "w-[380px] max-w-[calc(100vw-3rem)] border border-[var(--color-ink-3)]"
      )}
      aria-label="Map agent interventions"
    >
      {collapsed ? (
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          title="Expand agent inbox"
          className="flex h-9 items-center gap-2 rounded-full border-0 bg-[color-mix(in_oklch,var(--color-ink-1)_82%,transparent)] px-3 text-[12px] text-[var(--color-ink-7)] backdrop-blur-md transition-all hover:text-[var(--color-ink-8)] hover:bg-[color-mix(in_oklch,var(--color-ink-1)_92%,transparent)] active:translate-y-[1px]"
        >
          <Robot size={13} weight="bold" />
          <span className="font-mono text-[10px] uppercase tracking-[0.18em]">
            Agent
          </span>
          {unreadCount > 0 && (
            <span className="ml-1 grid h-4 min-w-4 place-items-center rounded-full bg-[var(--color-accent)] px-1 font-mono text-[9px] font-bold text-[var(--color-ink-0)] tabular-nums">
              {unreadCount}
            </span>
          )}
        </button>
      ) : (
        <>
          {/* Header */}
          <header className="flex items-center justify-between gap-3 border-b border-[var(--color-ink-3)] px-4 py-3">
            <div className="flex items-center gap-2.5">
              <span className="grid h-6 w-6 place-items-center rounded-md bg-[color-mix(in_oklch,var(--color-accent)_18%,var(--color-ink-2))]">
                <Robot size={13} weight="bold" className="text-[var(--color-accent)]" />
              </span>
              <span className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-[var(--color-ink-6)]">
                Map agent
              </span>
              {unreadCount > 0 && (
                <span className="grid h-4 min-w-4 place-items-center rounded-full bg-[var(--color-accent)] px-1 font-mono text-[9px] font-bold text-[var(--color-ink-0)] tabular-nums">
                  {unreadCount}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              className="grid h-7 w-7 place-items-center rounded-md text-[var(--color-ink-6)] transition-colors hover:bg-[var(--color-ink-2)] hover:text-[var(--color-ink-8)] active:translate-y-px"
              title="Collapse agent panel"
            >
              <CaretDown size={14} weight="bold" />
            </button>
          </header>

          {/* Card stack */}
          <ol className="flex max-h-[380px] flex-col divide-y divide-[var(--color-ink-2)] overflow-y-auto">
            {messages.map((msg) => (
              <AgentCard
                key={msg.id}
                message={msg}
                onActioned={onActioned}
                onDismiss={onDismiss}
              />
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

// ── Individual card ──────────────────────────────────────────────────────────

interface CardProps {
  message: AgentMessage;
  onActioned: (id: string) => void;
  onDismiss: (id: string) => void;
}

function AgentCard({ message, onActioned, onDismiss }: CardProps) {
  const [expanded, setExpanded] = useState(false);
  const fromColor = SEVERITY_DOT[message.fromSeverity] ?? "#6b7280";
  const toColor = SEVERITY_DOT.normal;
  const fromLabel = SEVERITY_LABELS[message.fromSeverity] ?? message.fromSeverity;

  return (
    <li
      className={clsx(
        "event-row-enter flex flex-col gap-2.5 px-4 py-3 transition-colors",
        message.actioned && "opacity-55"
      )}
    >
      {/* Top row: ward label + dismiss */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className="grid h-5 w-5 shrink-0 place-items-center rounded-[5px]"
            style={{ backgroundColor: "rgba(34,197,94,0.14)", color: "#22c55e" }}
          >
            <Lightning size={11} weight="bold" />
          </span>
          <span className="text-[12.5px] font-medium leading-tight text-[var(--color-ink-8)]">
            {message.wardLabel}
          </span>
        </div>
        <button
          type="button"
          onClick={() => onDismiss(message.id)}
          className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded text-[var(--color-ink-5)] transition-colors hover:bg-[var(--color-ink-2)] hover:text-[var(--color-ink-7)] active:translate-y-px"
          title="Dismiss"
        >
          <X size={11} weight="bold" />
        </button>
      </div>

      {/* Severity transition badge */}
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.14em]"
          style={{ backgroundColor: fromColor + "22", color: fromColor }}
        >
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: fromColor }}
          />
          {fromLabel}
        </span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="shrink-0 text-[var(--color-ink-5)]">
          <path d="M2 5h6M6 3l2 2-2 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span className="flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.14em]"
          style={{ backgroundColor: toColor + "22", color: toColor }}
        >
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: toColor }}
          />
          Normal
        </span>
        <span className="ml-auto font-mono text-[10px] tabular-nums text-[var(--color-ink-5)]">
          {timeOf(message.ts)}
        </span>
      </div>

      {/* Metric line */}
      <p className="text-[11.5px] text-[var(--color-ink-6)]">
        <span className="font-medium text-[var(--color-ink-7)]">{message.metric}</span>
        {" "}was <span className="font-mono tabular-nums">{message.value.toFixed(1)}</span>
      </p>

      {/* Justification (expandable) */}
      <div>
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="flex items-center gap-1 text-[10.5px] text-[var(--color-ink-5)] transition-colors hover:text-[var(--color-ink-7)]"
        >
          {expanded ? <CaretUp size={10} weight="bold" /> : <CaretDown size={10} weight="bold" />}
          <span className="font-mono uppercase tracking-[0.15em]">Justification</span>
        </button>
        {expanded && (
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-[var(--color-ink-6)]">
            {message.justification}
          </p>
        )}
      </div>

      {/* Action row */}
      <div className="flex items-center gap-2 pt-0.5">
        {!message.actioned ? (
          <button
            type="button"
            onClick={() => onActioned(message.id)}
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-accent)] bg-[color-mix(in_oklch,var(--color-accent)_12%,transparent)] px-3 py-1 text-[11px] font-medium text-[var(--color-accent)] transition-all hover:bg-[color-mix(in_oklch,var(--color-accent)_22%,transparent)] active:translate-y-px"
          >
            <Lightning size={11} weight="bold" />
            Intervention
          </button>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--color-ok)]">
            <CheckCircle size={12} weight="bold" />
            Actioned
          </span>
        )}
      </div>
    </li>
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
