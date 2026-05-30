// DiagnosisPanel — qualitative analysis surface inside the Command Center.
//
// Layout:
//   1. A leading narrative summary that frames the operational picture.
//   2. Three grouped sections (Demand Pressure, Supply Tightness, Local
//      Context) rendered as flowing paragraphs for high legibility on
//      long text strings.
//
// Visual treatment:
//   Each group carries a subtle background tint keyed to its semantic
//   role (warn / alert / accent), separating groups without visual
//   clutter. We avoid side-stripe borders and gradient text per the
//   design discipline; the tint plus a single small leading icon does
//   the categorisation work.

import { Gauge, Lightning, ThermometerSimple } from "@phosphor-icons/react";

interface DiagnosisSection {
  title: string;
  icon: "demand" | "supply" | "context";
  paragraphs: string[];
}

interface Props {
  narrative: string;
  sections: DiagnosisSection[];
}

const ICON_MAP = {
  demand: Gauge,
  supply: Lightning,
  context: ThermometerSimple,
} as const;

const TINT_MAP = {
  demand: {
    bg: "bg-[color-mix(in_oklch,var(--color-warn)_7%,var(--color-ink-1))]",
    border:
      "border-[color-mix(in_oklch,var(--color-warn)_18%,var(--color-ink-3))]",
    icon: "text-[var(--color-warn)]",
    label: "text-[color-mix(in_oklch,var(--color-warn)_65%,var(--color-ink-7))]",
  },
  supply: {
    bg: "bg-[color-mix(in_oklch,var(--color-alert)_7%,var(--color-ink-1))]",
    border:
      "border-[color-mix(in_oklch,var(--color-alert)_18%,var(--color-ink-3))]",
    icon: "text-[var(--color-alert)]",
    label:
      "text-[color-mix(in_oklch,var(--color-alert)_60%,var(--color-ink-7))]",
  },
  context: {
    bg: "bg-[color-mix(in_oklch,var(--color-accent)_6%,var(--color-ink-1))]",
    border:
      "border-[color-mix(in_oklch,var(--color-accent)_22%,var(--color-ink-3))]",
    icon: "text-[var(--color-accent)]",
    label:
      "text-[color-mix(in_oklch,var(--color-accent)_55%,var(--color-ink-7))]",
  },
} as const;

export function DiagnosisPanel({ narrative, sections }: Props) {
  return (
    <section
      aria-label="Diagnostic panel"
      className="flex flex-col gap-4"
    >
      {/* Section eyebrow — establishes this is the diagnostic surface. */}
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-ink-5)]">
          Diagnostic
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-4)]">
          {sections.length} groups
        </span>
      </div>

      {/* Narrative summary — quiet card, no nested cards inside. */}
      <div className="rounded-xl border border-[var(--color-ink-3)] bg-[var(--color-ink-1)] px-5 py-4">
        <p className="text-[14px] leading-[1.65] text-[var(--color-ink-7)]">
          {narrative}
        </p>
      </div>

      {/* Grouped sections — tinted backgrounds, full borders, no stripes. */}
      <div className="flex flex-col gap-3">
        {sections.map((section) => {
          const Icon = ICON_MAP[section.icon];
          const t = TINT_MAP[section.icon];

          return (
            <article
              key={section.title}
              className={`rounded-xl border ${t.border} ${t.bg} px-5 py-4`}
            >
              <header className="mb-3 flex items-center gap-2">
                <Icon size={13} weight="bold" className={t.icon} />
                <h3
                  className={`font-mono text-[10.5px] uppercase tracking-[0.22em] ${t.label}`}
                >
                  {section.title}
                </h3>
              </header>

              <div className="flex flex-col gap-2.5">
                {section.paragraphs.map((paragraph, idx) => (
                  <p
                    key={idx}
                    className="text-[13.5px] leading-[1.65] text-[var(--color-ink-7)]"
                  >
                    {paragraph}
                  </p>
                ))}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
