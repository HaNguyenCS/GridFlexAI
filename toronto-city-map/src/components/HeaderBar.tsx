// Top header bar — brand mark + connection status.
//
// Layout: left chunk is the brand mark with a typographic identity.
// Right chunk is the connection status pill. Single line on desktop,
// height capped per the impeccable / taste rules.

import { Pulse, Broadcast, WifiSlash, WarningCircle, Plug, CornersIn, CornersOut, SquaresFour } from "@phosphor-icons/react";
import clsx from "clsx";
import type { ConnectionStatus } from "../lib/types";

interface Props {
  status: ConnectionStatus;
  streamUrl: string | null;
  buildingsLoaded: number;
  overlaysActive: number;
  eventsTotal: number;
  sourcesEnabled: number;
  sourcesTotal: number;
  onOpenSources: () => void;
  /** Whether all panels are currently collapsed. */
  allPanelsCollapsed: boolean;
  /** Toggle collapse/expand all panels. */
  onToggleCollapseAll: () => void;
  /** Whether the Command Center panel is currently open. */
  commandOpen: boolean;
  /** Open the Command Center panel. */
  onOpenCommand: () => void;
}

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  idle: "Idle",
  connecting: "Connecting",
  live: "Live",
  reconnecting: "Reconnecting",
  error: "Stream error",
  offline: "Mock simulator",
};

export function HeaderBar({
  status,
  streamUrl,
  buildingsLoaded,
  overlaysActive,
  eventsTotal,
  sourcesEnabled,
  sourcesTotal,
  onOpenSources,
  allPanelsCollapsed,
  onToggleCollapseAll,
  commandOpen,
  onOpenCommand,
}: Props) {
  const live = status === "live";
  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-10 flex h-[64px] items-center justify-between gap-6 px-6">
      <div className="pointer-events-auto flex items-center gap-3">
        <BrandMark />
        <div className="hidden flex-col leading-none sm:flex">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-[var(--color-ink-5)]">
            Toronto · ON
          </span>
          <span className="mt-1 font-medium tracking-tight text-[var(--color-ink-8)]">
            Live City Topology
          </span>
        </div>
      </div>

      <div className="pointer-events-auto flex items-center gap-3">
        <Stat label="Footprints" value={buildingsLoaded.toLocaleString()} />
        <Stat
          label="Active overlays"
          value={overlaysActive.toLocaleString()}
          accent={overlaysActive > 0}
        />
        <Stat label="Events" value={eventsTotal.toLocaleString()} mono />
        <SourcesTrigger
          enabled={sourcesEnabled}
          total={sourcesTotal}
          onClick={onOpenSources}
        />
        <StatusPill status={status} url={streamUrl} live={live} />
        {!commandOpen && (
          <button
            type="button"
            onClick={onOpenCommand}
            title="Open Command Center"
            className="flex h-9 items-center gap-2 rounded-full border border-[var(--color-ink-3)] bg-[color-mix(in_oklch,var(--color-ink-1)_82%,transparent)] px-3 text-[12px] text-[var(--color-ink-7)] backdrop-blur-md transition-all hover:text-[var(--color-ink-8)] hover:border-[var(--color-ink-4)] active:translate-y-px"
          >
            <SquaresFour size={13} weight="bold" />
            <span className="font-mono text-[10px] uppercase tracking-[0.18em]">
              Command
            </span>
          </button>
        )}
        <button
          type="button"
          onClick={onToggleCollapseAll}
          className="grid h-9 w-9 place-items-center rounded-full border border-[var(--color-ink-3)] bg-[color-mix(in_oklch,var(--color-ink-1)_82%,transparent)] text-[var(--color-ink-6)] backdrop-blur-md transition-all hover:text-[var(--color-ink-8)] hover:bg-[color-mix(in_oklch,var(--color-ink-1)_92%,transparent)] active:translate-y-px"
          title={allPanelsCollapsed ? "Expand all panels" : "Collapse all panels"}
        >
          {allPanelsCollapsed ? (
            <CornersOut size={16} weight="bold" />
          ) : (
            <CornersIn size={16} weight="bold" />
          )}
        </button>
      </div>
    </header>
  );
}

function Stat({
  label,
  value,
  accent,
  mono,
}: {
  label: string;
  value: string;
  accent?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="hidden h-9 items-center gap-2 rounded-full border border-[var(--color-ink-3)] bg-[color-mix(in_oklch,var(--color-ink-1)_82%,transparent)] px-3 text-[12px] backdrop-blur-md md:flex">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-5)]">
        {label}
      </span>
      <span
        className={clsx(
          mono && "font-mono",
          "tabular-nums text-[var(--color-ink-8)]",
          accent && "text-[var(--color-accent)]"
        )}
      >
        {value}
      </span>
    </div>
  );
}

function StatusPill({
  status,
  url,
  live,
}: {
  status: ConnectionStatus;
  url: string | null;
  live: boolean;
}) {
  const Icon =
    status === "error"
      ? WarningCircle
      : status === "offline"
      ? WifiSlash
      : status === "reconnecting" || status === "connecting"
      ? Pulse
      : Broadcast;

  return (
    <div
      className={clsx(
        "flex h-9 items-center gap-2.5 rounded-full border px-3.5 text-[12px] backdrop-blur-md transition-colors",
        live
          ? "border-[color-mix(in_oklch,var(--color-accent)_45%,transparent)] bg-[color-mix(in_oklch,var(--color-accent)_8%,var(--color-ink-1))] text-[var(--color-accent)]"
          : status === "error"
          ? "border-[color-mix(in_oklch,var(--color-alert)_50%,transparent)] bg-[color-mix(in_oklch,var(--color-alert)_10%,var(--color-ink-1))] text-[var(--color-alert)]"
          : "border-[var(--color-ink-3)] bg-[color-mix(in_oklch,var(--color-ink-1)_82%,transparent)] text-[var(--color-ink-7)]"
      )}
      title={url ?? "No WS URL configured — using built-in simulator"}
    >
      {live ? (
        <span
          aria-hidden
          className="live-dot inline-block h-2 w-2 rounded-full bg-[var(--color-accent)]"
        />
      ) : (
        <Icon size={14} weight="bold" />
      )}
      <span className="font-mono text-[11px] uppercase tracking-[0.18em]">
        {STATUS_LABEL[status]}
      </span>
    </div>
  );
}

function BrandMark() {
  return (
    <div className="grid h-9 w-9 place-items-center rounded-[10px] border border-[var(--color-ink-3)] bg-[var(--color-ink-1)]">
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
        <path
          d="M3 19 L8 7 L13 13 L18 4 L21 4 L21 21 L3 21 Z"
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="18" cy="4" r="1.5" fill="var(--color-accent)" />
      </svg>
    </div>
  );
}

function SourcesTrigger({
  enabled,
  total,
  onClick,
}: {
  enabled: number;
  total: number;
  onClick: () => void;
}) {
  const allOn = enabled > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      title="Manage stream sources"
      className={clsx(
        "flex h-9 items-center gap-2 rounded-full border px-3 text-[12px] backdrop-blur-md transition-colors active:translate-y-px",
        allOn
          ? "border-[color-mix(in_oklch,var(--color-accent)_38%,transparent)] bg-[color-mix(in_oklch,var(--color-accent)_8%,var(--color-ink-1))] text-[var(--color-accent)] hover:bg-[color-mix(in_oklch,var(--color-accent)_14%,var(--color-ink-1))]"
          : "border-[var(--color-ink-3)] bg-[color-mix(in_oklch,var(--color-ink-1)_82%,transparent)] text-[var(--color-ink-7)] hover:text-[var(--color-ink-8)]"
      )}
    >
      <Plug size={13} weight="bold" />
      <span className="font-mono text-[10px] uppercase tracking-[0.18em]">
        Sources
      </span>
      <span className="font-mono text-[11px] tabular-nums">
        {enabled}
        <span className="text-[var(--color-ink-5)]">/{total}</span>
      </span>
    </button>
  );
}
