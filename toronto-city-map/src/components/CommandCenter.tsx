// CommandCenter — floating operator panel.
// Composes the GlobalStatusHeader (Reserve + Stress Score) and the
// DiagnosisPanel (qualitative narrative across three grouped sections).
// Opens via CommandCenterTrigger placed below the live indicator.
// Styled consistently with LegendPanel and EventFeed as a floating glass panel.

import { useEffect } from "react";
import { X, SquaresFour } from "@phosphor-icons/react";
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
    <section
      className="pointer-events-auto absolute bottom-6 right-6 z-10 flex w-[540px] max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-[14px] border border-[var(--color-ink-3)] bg-[color-mix(in_oklch,var(--color-ink-1)_88%,transparent)] backdrop-blur-xl transition-all duration-300 ease-in-out"
      aria-label="Command Center"
    >
        {/* Header */}
        <header className="flex items-center justify-between gap-3 border-b border-[var(--color-ink-3)] px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className="grid h-6 w-6 place-items-center rounded-md bg-[color-mix(in_oklch,var(--color-accent)_18%,var(--color-ink-2))]">
              <SquaresFour size={13} weight="bold" className="text-[var(--color-accent)]" />
            </span>
            <span className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-[var(--color-ink-6)]">
              Command Center
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onClose}
              className="grid h-7 w-7 place-items-center rounded-md text-[var(--color-ink-6)] transition-colors hover:bg-[var(--color-ink-2)] hover:text-[var(--color-ink-8)] active:translate-y-px"
              title="Collapse Command Center"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="grid h-7 w-7 place-items-center rounded-md text-[var(--color-ink-6)] transition-colors hover:bg-[var(--color-ink-2)] hover:text-[var(--color-ink-8)] active:translate-y-px"
              title="Close Command Center (Esc)"
              aria-label="Close Command Center"
            >
              <X size={14} weight="bold" />
            </button>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="flex flex-col gap-6 px-4 py-4">
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
    </section>
  );
}
