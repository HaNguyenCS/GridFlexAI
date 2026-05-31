import type { ZoneHistory } from "../lib/history";
import type { ZoneMetrics } from "../lib/types";

interface Props {
  history: ZoneHistory;
  zones: Map<string, ZoneMetrics>;
  selectedZone: string | null;
  onSelectZone: (zoneId: string) => void;
}

export function WardMiniCharts({
  history,
  zones,
  selectedZone,
  onSelectZone,
}: Props) {
  const wardIds = [...zones.keys()].sort();

  return (
    <section className="panel flex flex-col gap-3">
      <header>
        <h2 className="panel-title">All wards</h2>
        <p className="mt-1 text-xs text-slate-500">
          Demand vs effective capacity · click to focus
        </p>
      </header>

      <ul className="grid max-h-52 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
        {wardIds.map((zoneId) => {
          const points = history.get(zoneId) ?? [];
          const live = zones.get(zoneId);
          const isSelected = zoneId === selectedZone;

          return (
            <li key={zoneId}>
              <button
                type="button"
                onClick={() => onSelectZone(zoneId)}
                className={`ward-mini ${isSelected ? "ward-mini-active" : ""}`}
              >
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-medium">{zoneId}</span>
                  <span className="text-slate-500">
                    {live?.demand?.toFixed(0) ?? "—"} /{" "}
                    {live?.effective_capacity?.toFixed(0) ?? "—"} MW
                  </span>
                </div>
                <MiniSparkline points={points} active={isSelected} />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function MiniSparkline({
  points,
  active,
}: {
  points: { demand?: number; effective_capacity?: number }[];
  active: boolean;
}) {
  const width = 140;
  const height = 36;
  const pad = 2;

  if (points.length < 2) {
    return (
      <svg viewBox={`0 0 ${width} ${height}`} className="mt-1 h-9 w-full opacity-40">
        <line
          x1={pad}
          x2={width - pad}
          y1={height / 2}
          y2={height / 2}
          stroke="#334155"
        />
      </svg>
    );
  }

  const demandVals = points.map((p) => p.demand).filter((v): v is number => v != null);
  const capVals = points
    .map((p) => p.effective_capacity)
    .filter((v): v is number => v != null);
  const all = [...demandVals, ...capVals];
  const min = Math.min(...all);
  const max = Math.max(...all, min + 1);

  const xAt = (i: number) => pad + (i / (points.length - 1)) * (width - pad * 2);
  const yAt = (v: number) =>
    pad + (height - pad * 2) * (1 - (v - min) / (max - min));

  const line = (key: "demand" | "effective_capacity", color: string) => {
    const d = points
      .map((p, i) => {
        const v = p[key];
        if (v == null) return null;
        return `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(1)} ${yAt(v).toFixed(1)}`;
      })
      .filter(Boolean)
      .join(" ");
    return d ? (
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={active ? 2 : 1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ) : null;
  };

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="mt-1 h-9 w-full">
      {line("effective_capacity", active ? "#818cf8" : "#475569")}
      {line("demand", active ? "#fbbf24" : "#92400e")}
    </svg>
  );
}
