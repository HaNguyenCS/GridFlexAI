// GlobalStatusHeader — primary status block at the top of the Command Center.
//
// Hierarchy: Reserve is the *primary* metric and leads visually with a
// larger numeral. Stress Score is the secondary metric, sized down a
// notch and paired with a state badge (Critical / Warning) plus a
// trajectory icon. The two metrics share one row on desktop and stack
// gracefully when the panel is narrow.

import {
  TrendUp,
  TrendDown,
  ArrowsHorizontal,
} from "@phosphor-icons/react";
import clsx from "clsx";

interface Props {
  reserveMW: number;
  reserveMargin: number;
  stressScore: number;
  stressTrajectory: "rising" | "falling" | "stable";
}

export function GlobalStatusHeader({
  reserveMW,
  reserveMargin,
  stressScore,
  stressTrajectory,
}: Props) {
  const isCritical = stressScore >= 85;
  const isWarning = stressScore >= 60 && stressScore < 85;

  const TrajectoryIcon =
    stressTrajectory === "rising"
      ? TrendUp
      : stressTrajectory === "falling"
      ? TrendDown
      : ArrowsHorizontal;

  // Margin tone keys to the reserve band. Below 5% reads as alert.
  const marginTone =
    reserveMargin < 5
      ? "text-[var(--color-alert)]"
      : reserveMargin < 10
      ? "text-[var(--color-warn)]"
      : "text-[var(--color-ok)]";

  const trajectoryTone =
    stressTrajectory === "rising"
      ? "text-[var(--color-alert)]"
      : stressTrajectory === "falling"
      ? "text-[var(--color-ok)]"
      : "text-[var(--color-ink-5)]";

  const stressTone = isCritical
    ? "text-[var(--color-alert)]"
    : isWarning
    ? "text-[var(--color-warn)]"
    : "text-[var(--color-ok)]";

  return (
    <section
      aria-label="Status header"
      className="rounded-xl border border-[var(--color-ink-3)] bg-[var(--color-ink-1)]"
    >
      {/* Eyebrow — labels this block as the status header. */}
      <div className="flex items-baseline justify-between border-b border-[var(--color-ink-3)] px-5 py-2.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-ink-5)]">
          Status Header
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-4)]">
          T+ live
        </span>
      </div>

      <div className="grid grid-cols-1 gap-5 px-5 py-5 sm:grid-cols-[1.15fr_auto_1fr]">
        {/* ── Reserve (primary) ─────────────────────────────────────── */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-ink-5)]">
              Reserve
            </span>
            <span className="rounded-sm bg-[var(--color-ink-2)] px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--color-ink-5)]">
              Primary
            </span>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-[40px] font-semibold leading-[1] tracking-[-0.02em] text-[var(--color-ink-8)] tabular-nums">
              {reserveMW.toLocaleString()}
            </span>
            <span className="text-[13px] font-medium text-[var(--color-ink-6)]">
              MW
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={clsx(
                "font-mono text-[12px] tabular-nums",
                marginTone
              )}
            >
              {reserveMargin.toFixed(1)}%
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-5)]">
              margin
            </span>
          </div>
        </div>

        {/* Vertical divider — visible only when the row is side-by-side. */}
        <div
          aria-hidden
          className="hidden w-px self-stretch bg-[var(--color-ink-3)] sm:block"
        />

        {/* ── Stress Score (secondary) ──────────────────────────────── */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-ink-5)]">
              Stress Score
            </span>
            {isCritical && (
              <span className="rounded-sm border border-[color-mix(in_oklch,var(--color-alert)_45%,transparent)] bg-[color-mix(in_oklch,var(--color-alert)_14%,var(--color-ink-2))] px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--color-alert)]">
                Critical
              </span>
            )}
            {isWarning && (
              <span className="rounded-sm border border-[color-mix(in_oklch,var(--color-warn)_40%,transparent)] bg-[color-mix(in_oklch,var(--color-warn)_14%,var(--color-ink-2))] px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--color-warn)]">
                Warning
              </span>
            )}
          </div>

          <div className="flex items-baseline gap-1.5">
            <span
              className={clsx(
                "text-[34px] font-semibold leading-[1] tabular-nums tracking-[-0.02em]",
                stressTone
              )}
            >
              {stressScore}
            </span>
            <span className="text-[13px] font-medium text-[var(--color-ink-5)]">
              / 100
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <TrajectoryIcon
              size={12}
              weight="bold"
              className={trajectoryTone}
            />
            <span
              className={clsx(
                "font-mono text-[11px] uppercase tracking-[0.18em]",
                trajectoryTone
              )}
            >
              {stressTrajectory}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
