// ModeSelector — Initial setup wizard to choose between Simulated and Predictive modes.
//
// Simulated mode: Uses localhost:3000 WebSocket streams
// Predictive mode: Uses localhost:8080 ML API for ward stress predictions

import { useState } from "react";
import { WifiHigh, Check, Lightning } from "@phosphor-icons/react";
import clsx from "clsx";

export type GridMode = "simulated" | "predictive";

interface Props {
  onSelect: (mode: GridMode) => void;
}

export function ModeSelector({ onSelect }: Props) {
  const [selectedMode, setSelectedMode] = useState<GridMode | null>(null);

  const handleSelect = (mode: GridMode) => {
    setSelectedMode(mode);
    setTimeout(() => onSelect(mode), 300);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-ink-0)]">
      <div className="max-w-md w-full mx-4">
        <div className="rounded-2xl border border-white/10 bg-[rgba(8,12,20,0.95)] p-8 backdrop-blur-xl shadow-2xl">
          <div className="mb-6 text-center">
            <h1 className="font-medium tracking-tight text-[var(--color-ink-8)]">
              Select Grid Mode
            </h1>
            <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-ink-5)]">
              Choose how you want to view the grid data
            </p>
          </div>

          <div className="space-y-4">
            {/* Simulated Mode Card */}
            <button
              type="button"
              onClick={() => handleSelect("simulated")}
              className={clsx(
                "group relative flex w-full items-start gap-4 rounded-xl border p-5 transition-all hover:shadow-lg",
                selectedMode === "simulated"
                  ? "border-[var(--color-accent)] bg-[color-mix(in_oklch,var(--color-accent)_10%,transparent)]"
                  : "border-white/10 bg-white/5 hover:border-white/20"
              )}
            >
              <div
                className={clsx(
                  "grid h-10 w-10 shrink-0 place-items-center rounded-lg",
                  selectedMode === "simulated"
                    ? "bg-[var(--color-accent)] text-white"
                    : "bg-white/10 text-[var(--color-ink-6)] group-hover:bg-white/20 group-hover:text-[var(--color-ink-8)]"
                )}
              >
                <WifiHigh size={20} weight="bold" />
              </div>
              <div className="flex-1 text-left">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium text-[var(--color-ink-8)]">
                    Simulated
                  </h3>
                  {selectedMode === "simulated" && (
                    <Check size={16} weight="bold" className="text-[var(--color-accent)]" />
                  )}
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-[var(--color-ink-5)]">
                  Real-time WebSocket streams from localhost:3000
                  <br />
                  Demand, Supply, Trades, Issues
                </p>
                <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-[var(--color-ink-1)] px-2.5 py-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-ink-5)]">
                    localhost:3000
                  </span>
                </div>
              </div>
            </button>

            {/* Predictive Mode Card */}
            <button
              type="button"
              onClick={() => handleSelect("predictive")}
              className={clsx(
                "group relative flex w-full items-start gap-4 rounded-xl border p-5 transition-all hover:shadow-lg",
                selectedMode === "predictive"
                  ? "border-[var(--color-accent)] bg-[color-mix(in_oklch,var(--color-accent)_10%,transparent)]"
                  : "border-white/10 bg-white/5 hover:border-white/20"
              )}
            >
              <div
                className={clsx(
                  "grid h-10 w-10 shrink-0 place-items-center rounded-lg",
                  selectedMode === "predictive"
                    ? "bg-[var(--color-accent)] text-white"
                    : "bg-white/10 text-[var(--color-ink-6)] group-hover:bg-white/20 group-hover:text-[var(--color-ink-8)]"
                )}
              >
                <Lightning size={20} weight="bold" />
              </div>
              <div className="flex-1 text-left">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium text-[var(--color-ink-8)]">
                    Predictive
                  </h3>
                  {selectedMode === "predictive" && (
                    <Check size={16} weight="bold" className="text-[var(--color-accent)]" />
                  )}
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-[var(--color-ink-5)]">
                  ML-based ward stress predictions from localhost:8080
                  <br />
                  Stress scores, drivers, and recommendations
                </p>
                <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-[var(--color-ink-1)] px-2.5 py-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-ink-5)]">
                    localhost:8080
                  </span>
                </div>
              </div>
            </button>
          </div>

          <div className="mt-8 text-center">
            <p className="text-[11px] leading-relaxed text-[var(--color-ink-5)]">
              You can switch modes later from the top-right toggle
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
