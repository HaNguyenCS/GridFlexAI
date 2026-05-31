import type { ActiveSpike, SimClock, SupplySummary, ZoneMetrics } from "../lib/types";
import { formatMoney, formatMw } from "../lib/format";

interface Props {
  zones: Map<string, ZoneMetrics>;
  summary: SupplySummary;
  spikes: ActiveSpike[];
  sim: SimClock | null;
  lastTs: string | null;
  selectedZone: string | null;
}

const PHASE_LABEL: Record<string, string> = {
  ramp_up: "climbing",
  hold: "peak",
  ramp_down: "easing",
};

export function SidePanel({
  zones,
  summary,
  spikes,
  sim,
  lastTs,
  selectedZone,
}: Props) {
  const selected = selectedZone ? zones.get(selectedZone) : null;
  const totalDemand = [...zones.values()].reduce(
    (sum, z) => sum + (z.demand ?? 0),
    0
  );
  const totalSupply = [...zones.values()].reduce(
    (sum, z) => sum + (z.supply ?? 0),
    0
  );

  return (
    <section className="panel flex flex-col gap-4">
      <header>
        <h2 className="panel-title">Grid Summary</h2>
        {sim && (
          <p className="mt-1 text-xs font-medium text-indigo-300">
            {sim.historical_date ?? `Day ${sim.sim_day}`} · {sim.sim_time}
            {sim.time_compression != null && ` · ${sim.time_compression}×`}
            {sim.demand_source && " · IESO replay"}
          </p>
        )}
        {lastTs && (
          <p className="mt-0.5 text-xs text-slate-500">
            Live tick {new Date(lastTs).toLocaleTimeString()}
          </p>
        )}
      </header>

      <div className="grid grid-cols-2 gap-2">
        <Metric label="City demand" value={formatMw(totalDemand)} />
        <Metric label="City supply" value={formatMw(totalSupply)} />
        <Metric label="Unmet" value={formatMw(summary.total_unmet_mw)} />
        <Metric label="Cost" value={formatMoney(summary.total_cost)} />
      </div>

      {summary.agent_note && (
        <p className="rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-100">
          {summary.agent_note}
        </p>
      )}

      {spikes.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-300">
            Active load events ({spikes.length})
          </h3>
          <ul className="space-y-1.5 text-xs text-slate-300">
            {spikes.map((spike, idx) => {
              const simMinsLeft =
                sim != null
                  ? spike.ticks_remaining * sim.sim_minutes_per_tick
                  : null;
              const label =
                spike.spike_type === "city" ? "City-wide" : spike.zone_id;
              const phase = spike.phase
                ? PHASE_LABEL[spike.phase] ?? spike.phase
                : "active";

              return (
                <li
                  key={`${spike.scope}-${idx}`}
                  className="rounded-lg border border-amber-500/15 bg-amber-500/5 px-2 py-1.5"
                >
                  <span className="font-medium text-amber-100">{label}</span>
                  {" · "}
                  {phase} ×{spike.multiplier.toFixed(2)}
                  {spike.peak_multiplier != null &&
                    spike.peak_multiplier > spike.multiplier && (
                      <span className="text-slate-500">
                        {" "}
                        (peak ×{spike.peak_multiplier.toFixed(2)})
                      </span>
                    )}
                  {simMinsLeft != null && (
                    <span className="text-slate-500">
                      {" "}
                      · ~{simMinsLeft}m sim left
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {selected && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-3">
          <h3 className="font-semibold">{selected.zone_id}</h3>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
            <Detail k="Demand" v={formatMw(selected.demand)} />
            <Detail k="Supply" v={formatMw(selected.supply)} />
            <Detail k="Owned cap." v={formatMw(selected.owned_capacity)} />
            <Detail k="Effective" v={formatMw(selected.effective_capacity)} />
            <Detail k="Imported" v={formatMw(selected.capacity_imported)} />
            <Detail k="Exported" v={formatMw(selected.capacity_exported)} />
            <Detail k="Unmet" v={formatMw(selected.unmet_demand)} />
            <Detail k="Status" v={selected.status ?? "ok"} />
          </dl>
        </div>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-box">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function Detail({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-slate-500">{k}</dt>
      <dd className="font-medium text-slate-200">{v}</dd>
    </>
  );
}
