// CommandCenter — right-aligned operator drawer.
// Composes the GlobalStatusHeader (Reserve + Stress Score) and the
// DiagnosisPanel (qualitative narrative across three grouped sections).
// Opens via CommandCenterTrigger placed below the live indicator.

import { useEffect } from "react";
import { X } from "@phosphor-icons/react";
import { GlobalStatusHeader } from "./GlobalStatusHeader";
import { DiagnosisPanel } from "./DiagnosisPanel";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function CommandCenter({ open, onClose }: Props) {
  // Demo data — would be replaced with real-time data from streams.
  const reserveMW = 977;
  const reserveMargin = 4.1;
  const stressScore = 94;
  const stressTrajectory = "rising" as const;

  const narrative =
    "Grid operating under elevated stress through the afternoon peak. Downtown core feeders are inside the 5% reserve band, southern corridors are tightening, and import paths are constrained. Recommend close monitoring of the 16:00 to 19:00 window with pre-staged demand response.";

  const diagnosisSections = [
    {
      title: "Demand Pressure",
      icon: "demand" as const,
      paragraphs: [
        "Industrial load is running 12.4% above forecast as eastern manufacturing pulls extended cooling overtime through shift change.",
        "Commercial HVAC ramped two hours earlier than the typical diurnal curve, and residential pickup is following the same lead. Peak window now anticipated 16:00 to 19:00 EDT.",
      ],
    },
    {
      title: "Supply Tightness",
      icon: "supply" as const,
      paragraphs: [
        "Three generation units remain offline for scheduled maintenance, with wind output 8% below seasonal average across the southern fleet.",
        "Natural gas peakers are dispatched and holding at 87% of nameplate. Imports from neighboring grids are constrained by tie line ratings, leaving little upward headroom.",
      ],
    },
    {
      title: "Local Context",
      icon: "context" as const,
      paragraphs: [
        "Heat advisory in effect for Metro Toronto. Forecast 32°C / 90°F with high humidity and weak overnight cooling, sustaining baseline residential load into the evening shoulder.",
        "Transit is running extended service, commercial demand response programs are active, and field crews are pre-positioned for protective operations on the eastern feeders.",
      ],
    },
  ];

  // Close on Escape for keyboard parity with the SourcesPanel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      {/* Scrim */}
      <div
        aria-hidden
        className="command-center-scrim fixed inset-0 z-40 bg-[color-mix(in_oklch,var(--color-ink-0)_55%,transparent)]"
        onClick={onClose}
      />

      {/* Panel */}
      <aside
        role="dialog"
        aria-label="Command Center"
        className="command-center-panel fixed right-0 top-0 z-50 flex h-full w-[min(540px,92vw)] flex-col border-l border-[var(--color-ink-3)] bg-[var(--color-ink-0)] shadow-[-12px_0_36px_color-mix(in_oklch,var(--color-ink-0)_55%,transparent)]"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--color-ink-3)] px-6 py-4">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-accent)] shadow-[0_0_8px_color-mix(in_oklch,var(--color-accent)_55%,transparent)]"
            />
            <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-ink-5)]">
              Command Center
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-ink-4)]">
              · Toronto Grid
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-[var(--color-ink-5)] transition-colors hover:bg-[var(--color-ink-2)] hover:text-[var(--color-ink-8)] active:translate-y-[1px]"
            title="Close Command Center (Esc)"
            aria-label="Close Command Center"
          >
            <X size={16} weight="bold" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="flex flex-col gap-6 px-6 py-6">
            <GlobalStatusHeader
              reserveMW={reserveMW}
              reserveMargin={reserveMargin}
              stressScore={stressScore}
              stressTrajectory={stressTrajectory}
            />

            <DiagnosisPanel
              narrative={narrative}
              sections={diagnosisSections}
            />
          </div>
        </div>
      </aside>
    </>
  );
}
