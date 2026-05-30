// SourcesPanel — the "plugin" surface for managing streaming endpoints.
//
// Behaviour:
//   - Slides in from the right as a focused drawer (peers cleanly with
//     the existing top header / bottom panels, never blocks the map).
//   - Each row is a source endpoint with: name, url, brand colour,
//     live status pill, per-second event rate, and an enable toggle.
//   - The "+ Add" affordance reveals an inline form (no modal — we
//     follow the impeccable rule against modals as the first reach).
//   - Edits are persisted via the parent (App.tsx writes to localStorage
//     through `saveSources`).
//
// Visual register: dark ops console. Single accent (teal). One radius
// scale (12–14px). All motion is opacity + transform (no layout
// properties), and the drawer uses an exponential ease-out curve.

import { useEffect, useMemo, useState } from "react";
import {
  Broadcast,
  Check,
  Pencil,
  Plug,
  Plus,
  Power,
  Trash,
  WarningCircle,
  WifiHigh,
  WifiSlash,
  X,
} from "@phosphor-icons/react";
import clsx from "clsx";
import type { ConnectionStatus, StreamSource } from "../lib/types";
import {
  MOCK_URL,
  SOURCE_COLOR_PALETTE,
  isMockSource,
  newSourceId,
} from "../lib/sources";

interface Props {
  open: boolean;
  onClose: () => void;
  sources: StreamSource[];
  onChange: (sources: StreamSource[]) => void;
  /** Live status per source id, fed by the multi-stream manager. */
  statuses: Record<string, ConnectionStatus>;
  /** Recent event count per source id (rolling window in App). */
  rates: Record<string, number>;
}

interface DraftSource {
  name: string;
  url: string;
  color: string;
}

const EMPTY_DRAFT: DraftSource = {
  name: "",
  url: "ws://",
  color: SOURCE_COLOR_PALETTE[0].hex,
};

export function SourcesPanel({
  open,
  onClose,
  sources,
  onChange,
  statuses,
  rates,
}: Props) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<DraftSource>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Reset transient UI when the drawer closes.
  useEffect(() => {
    if (!open) {
      setAdding(false);
      setEditingId(null);
      setDraft(EMPTY_DRAFT);
    }
  }, [open]);

  const enabledCount = useMemo(
    () => sources.filter((s) => s.enabled).length,
    [sources]
  );

  function toggle(id: string) {
    onChange(
      sources.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s))
    );
  }

  function remove(id: string) {
    onChange(sources.filter((s) => s.id !== id));
  }

  function commitDraft() {
    const trimmedName = draft.name.trim() || "Untitled source";
    const trimmedUrl = draft.url.trim();
    if (!trimmedUrl) return;
    if (editingId) {
      onChange(
        sources.map((s) =>
          s.id === editingId
            ? { ...s, name: trimmedName, url: trimmedUrl, color: draft.color }
            : s
        )
      );
    } else {
      const next: StreamSource = {
        id: newSourceId(),
        name: trimmedName,
        url: trimmedUrl,
        color: draft.color,
        enabled: true,
      };
      onChange([...sources, next]);
    }
    setAdding(false);
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
  }

  function startEdit(s: StreamSource) {
    setEditingId(s.id);
    setAdding(true);
    setDraft({ name: s.name, url: s.url, color: s.color });
  }

  return (
    <>
      {/* Backdrop scrim — click to dismiss. Stays subtle. */}
      <div
        aria-hidden
        onClick={onClose}
        className={clsx(
          "absolute inset-0 z-20 bg-black/30 backdrop-blur-[2px] transition-opacity duration-300",
          open ? "opacity-100" : "pointer-events-none opacity-0"
        )}
      />

      <aside
        role="dialog"
        aria-label="Stream sources"
        aria-modal="false"
        className={clsx(
          "pointer-events-auto absolute right-0 top-0 z-30 flex h-[100dvh] w-[380px] max-w-[100vw] flex-col border-l border-[var(--color-ink-3)] bg-[color-mix(in_oklch,var(--color-ink-1)_94%,transparent)] backdrop-blur-2xl transition-transform duration-[420ms]",
          open ? "translate-x-0" : "translate-x-full"
        )}
        style={{ transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)" }}
      >
        <header className="flex items-center justify-between gap-3 border-b border-[var(--color-ink-3)] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-[color-mix(in_oklch,var(--color-accent)_18%,var(--color-ink-2))]">
              <Plug size={14} weight="bold" className="text-[var(--color-accent)]" />
            </span>
            <div>
              <div className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-[var(--color-ink-6)]">
                Stream sources
              </div>
              <div className="mt-0.5 text-[12.5px] text-[var(--color-ink-7)]">
                {enabledCount} active{" "}
                <span className="text-[var(--color-ink-5)]">
                  · {sources.length} configured
                </span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-md text-[var(--color-ink-6)] transition-colors hover:bg-[var(--color-ink-2)] hover:text-[var(--color-ink-8)] active:translate-y-px"
            aria-label="Close sources panel"
            title="Close"
          >
            <X size={14} weight="bold" />
          </button>
        </header>

        <ol className="flex flex-1 flex-col divide-y divide-[var(--color-ink-2)] overflow-y-auto">
          {sources.map((s) => (
            <SourceRow
              key={s.id}
              source={s}
              status={statuses[s.id] ?? "idle"}
              rate={rates[s.id] ?? 0}
              isEditing={editingId === s.id}
              onToggle={() => toggle(s.id)}
              onRemove={() => remove(s.id)}
              onEdit={() => startEdit(s)}
            />
          ))}

          {adding ? (
            <li className="source-row-enter px-5 py-4">
              <DraftForm
                draft={draft}
                isEditing={Boolean(editingId)}
                onChange={setDraft}
                onCommit={commitDraft}
                onCancel={() => {
                  setAdding(false);
                  setEditingId(null);
                  setDraft(EMPTY_DRAFT);
                }}
              />
            </li>
          ) : null}
        </ol>

        <footer className="border-t border-[var(--color-ink-3)] px-5 py-3.5">
          {!adding ? (
            <button
              type="button"
              onClick={() => {
                setAdding(true);
                setEditingId(null);
                setDraft(EMPTY_DRAFT);
              }}
              className="flex w-full items-center justify-center gap-2 rounded-[10px] border border-dashed border-[var(--color-ink-3)] bg-transparent px-3 py-2.5 text-[12.5px] text-[var(--color-ink-7)] transition-colors hover:border-[color-mix(in_oklch,var(--color-accent)_55%,var(--color-ink-3))] hover:text-[var(--color-accent)] active:translate-y-px"
            >
              <Plus size={13} weight="bold" />
              Add stream endpoint
            </button>
          ) : (
            <p className="text-center font-mono text-[10.5px] uppercase tracking-[0.18em] text-[var(--color-ink-5)]">
              {editingId ? "Editing source" : "New source"}
            </p>
          )}
        </footer>
      </aside>
    </>
  );
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

function SourceRow({
  source,
  status,
  rate,
  isEditing,
  onToggle,
  onRemove,
  onEdit,
}: {
  source: StreamSource;
  status: ConnectionStatus;
  rate: number;
  isEditing: boolean;
  onToggle: () => void;
  onRemove: () => void;
  onEdit: () => void;
}) {
  const mock = isMockSource(source);
  const live = source.enabled && status === "live";
  return (
    <li
      className={clsx(
        "group flex flex-col gap-2 px-5 py-3.5 transition-colors",
        isEditing && "bg-[var(--color-ink-2)]/40"
      )}
    >
      <div className="flex items-start gap-3">
        <SourceDot color={source.color} live={live} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-[13.5px] font-medium text-[var(--color-ink-8)]">
              {source.name}
            </span>
            {mock ? (
              <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-[var(--color-ink-5)]">
                Local
              </span>
            ) : null}
          </div>
          <div
            className="mt-0.5 truncate font-mono text-[11px] text-[var(--color-ink-5)]"
            title={source.url}
          >
            {source.url === MOCK_URL ? "in-process simulator" : source.url}
          </div>
        </div>
        <ToggleSwitch on={source.enabled} onChange={onToggle} />
      </div>

      <div className="flex items-center justify-between pl-7">
        <StatusInline status={status} enabled={source.enabled} />
        <div className="flex items-center gap-1.5">
          <RateMeter rate={rate} accent={source.color} />
          <button
            type="button"
            onClick={onEdit}
            className="grid h-6 w-6 place-items-center rounded-md text-[var(--color-ink-5)] opacity-0 transition-all hover:bg-[var(--color-ink-2)] hover:text-[var(--color-ink-8)] active:translate-y-px group-hover:opacity-100"
            title="Edit"
            aria-label={`Edit ${source.name}`}
          >
            <Pencil size={12} weight="bold" />
          </button>
          <button
            type="button"
            onClick={onRemove}
            disabled={mock}
            className="grid h-6 w-6 place-items-center rounded-md text-[var(--color-ink-5)] opacity-0 transition-all hover:bg-[color-mix(in_oklch,var(--color-alert)_15%,var(--color-ink-2))] hover:text-[var(--color-alert)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-0 group-hover:opacity-100"
            title={mock ? "Built-in source cannot be removed" : "Remove"}
            aria-label={`Remove ${source.name}`}
          >
            <Trash size={12} weight="bold" />
          </button>
        </div>
      </div>
    </li>
  );
}

function SourceDot({ color, live }: { color: string; live: boolean }) {
  return (
    <span
      aria-hidden
      className="relative mt-1 grid h-4 w-4 shrink-0 place-items-center"
    >
      <span
        className={clsx(
          "absolute inset-0 rounded-full",
          live && "source-pulse"
        )}
        style={{ backgroundColor: `color-mix(in oklch, ${color} 40%, transparent)` }}
      />
      <span
        className="relative h-2 w-2 rounded-full"
        style={{ backgroundColor: color }}
      />
    </span>
  );
}

function ToggleSwitch({
  on,
  onChange,
}: {
  on: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onChange}
      className={clsx(
        "relative h-[18px] w-[32px] shrink-0 rounded-full border transition-colors active:translate-y-px",
        on
          ? "border-[color-mix(in_oklch,var(--color-accent)_50%,transparent)] bg-[color-mix(in_oklch,var(--color-accent)_22%,var(--color-ink-1))]"
          : "border-[var(--color-ink-3)] bg-[var(--color-ink-2)]"
      )}
    >
      <span
        className={clsx(
          "absolute top-[1px] h-[14px] w-[14px] rounded-full transition-transform duration-200",
          on
            ? "translate-x-[15px] bg-[var(--color-accent)]"
            : "translate-x-[1px] bg-[var(--color-ink-5)]"
        )}
        style={{ transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)" }}
      />
    </button>
  );
}

function StatusInline({
  status,
  enabled,
}: {
  status: ConnectionStatus;
  enabled: boolean;
}) {
  if (!enabled) {
    return (
      <span className="flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.18em] text-[var(--color-ink-5)]">
        <Power size={10} weight="bold" />
        Disabled
      </span>
    );
  }
  const Icon =
    status === "error"
      ? WarningCircle
      : status === "offline"
      ? WifiSlash
      : status === "live"
      ? Broadcast
      : WifiHigh;
  const tone =
    status === "error"
      ? "text-[var(--color-alert)]"
      : status === "live"
      ? "text-[var(--color-accent)]"
      : "text-[var(--color-ink-6)]";
  const label =
    status === "live"
      ? "Live"
      : status === "connecting"
      ? "Connecting"
      : status === "reconnecting"
      ? "Reconnecting"
      : status === "error"
      ? "Error"
      : status === "offline"
      ? "Fallback"
      : "Idle";
  return (
    <span
      className={clsx(
        "flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.18em]",
        tone
      )}
    >
      <Icon size={10} weight="bold" />
      {label}
    </span>
  );
}

function RateMeter({ rate, accent }: { rate: number; accent: string }) {
  const bars = 5;
  const t = Math.min(1, rate / 6);
  const lit = Math.round(t * bars);
  return (
    <span
      className="flex h-[14px] items-end gap-[2px] px-1"
      title={`${rate.toFixed(1)} ev/s`}
      aria-label={`Event rate ${rate.toFixed(1)} per second`}
    >
      {Array.from({ length: bars }).map((_, i) => (
        <span
          key={i}
          className="w-[2px] rounded-[1px] transition-[height,background-color] duration-300"
          style={{
            height: `${4 + i * 2}px`,
            backgroundColor:
              i < lit
                ? accent
                : "color-mix(in oklch, var(--color-ink-5) 35%, transparent)",
          }}
        />
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Inline draft form (no modal)
// ---------------------------------------------------------------------------

function DraftForm({
  draft,
  isEditing,
  onChange,
  onCommit,
  onCancel,
}: {
  draft: DraftSource;
  isEditing: boolean;
  onChange: (d: DraftSource) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onCommit();
      }}
      className="flex flex-col gap-3 rounded-[12px] border border-[var(--color-ink-3)] bg-[var(--color-ink-1)] p-3.5"
    >
      <Field label="Name">
        <input
          autoFocus
          value={draft.name}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
          placeholder="e.g. Sensors gateway"
          className="h-9 w-full rounded-[8px] border border-[var(--color-ink-3)] bg-[var(--color-ink-0)] px-2.5 text-[13px] text-[var(--color-ink-8)] placeholder:text-[var(--color-ink-5)] focus:border-[color-mix(in_oklch,var(--color-accent)_55%,var(--color-ink-3))] focus:outline-none focus:ring-2 focus:ring-[color-mix(in_oklch,var(--color-accent)_30%,transparent)]"
        />
      </Field>
      <Field label="WebSocket URL">
        <input
          value={draft.url}
          onChange={(e) => onChange({ ...draft, url: e.target.value })}
          placeholder="ws://host:port/stream"
          spellCheck={false}
          className="h-9 w-full rounded-[8px] border border-[var(--color-ink-3)] bg-[var(--color-ink-0)] px-2.5 font-mono text-[12px] text-[var(--color-ink-8)] placeholder:text-[var(--color-ink-5)] focus:border-[color-mix(in_oklch,var(--color-accent)_55%,var(--color-ink-3))] focus:outline-none focus:ring-2 focus:ring-[color-mix(in_oklch,var(--color-accent)_30%,transparent)]"
        />
        <p className="mt-1 font-mono text-[10.5px] tracking-[0.04em] text-[var(--color-ink-5)]">
          Use {`"mock://built-in"`} for the in-process simulator.
        </p>
      </Field>
      <Field label="Layer colour">
        <div className="flex flex-wrap gap-1.5">
          {SOURCE_COLOR_PALETTE.map((c) => {
            const selected = c.hex === draft.color;
            return (
              <button
                key={c.hex}
                type="button"
                onClick={() => onChange({ ...draft, color: c.hex })}
                className={clsx(
                  "relative grid h-7 w-7 place-items-center rounded-[8px] border transition-transform active:translate-y-px",
                  selected
                    ? "border-[var(--color-ink-8)]"
                    : "border-transparent hover:scale-[1.04]"
                )}
                title={c.name}
                aria-label={`Use ${c.name}`}
              >
                <span
                  className="h-4 w-4 rounded-full"
                  style={{ backgroundColor: c.hex }}
                />
                {selected ? (
                  <Check
                    size={10}
                    weight="bold"
                    className="absolute text-[var(--color-ink-0)]"
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      </Field>
      <div className="mt-1 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="h-8 rounded-[8px] px-3 text-[12px] text-[var(--color-ink-6)] transition-colors hover:text-[var(--color-ink-8)] active:translate-y-px"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="h-8 rounded-[8px] bg-[var(--color-accent)] px-3.5 text-[12px] font-medium text-[var(--color-ink-0)] transition-[transform,box-shadow] hover:shadow-[0_0_0_3px_color-mix(in_oklch,var(--color-accent)_22%,transparent)] active:translate-y-px"
        >
          {isEditing ? "Save changes" : "Add source"}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-ink-6)]">
        {label}
      </span>
      {children}
    </label>
  );
}
