// CommandCenterTrigger — compact button placed below the live indicator.
// Opens the Command Center panel when clicked.

import { SquaresFour } from "@phosphor-icons/react";
import clsx from "clsx";

interface Props {
  onClick: () => void;
  isActive: boolean;
}

export function CommandCenterTrigger({ onClick, isActive }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Open Command Center"
      className={clsx(
        "flex h-9 items-center gap-2 rounded-full border px-3 text-[12px] backdrop-blur-md transition-all active:translate-y-[1px]",
        isActive
          ? "border-[color-mix(in_oklch,var(--color-accent)_50%,transparent)] bg-[color-mix(in_oklch,var(--color-accent)_12%,var(--color-ink-1))] text-[var(--color-accent)] shadow-[0_0_12px_color-mix(in_oklch,var(--color-accent)_25%,transparent)]"
          : "border-[var(--color-ink-3)] bg-[color-mix(in_oklch,var(--color-ink-1)_82%,transparent)] text-[var(--color-ink-7)] hover:text-[var(--color-ink-8)] hover:border-[var(--color-ink-4)]"
      )}
    >
      <SquaresFour size={13} weight="bold" />
      <span className="font-mono text-[10px] uppercase tracking-[0.18em]">
        Command
      </span>
    </button>
  );
}
