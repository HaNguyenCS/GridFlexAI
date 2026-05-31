import type { SimulationTick } from "../lib/simulationTypes";
import { formatMw } from "../lib/format";

interface PipelineSnapshot {
  forecast?: {
    stress_score: number;
    target_reduction_mw: number;
    risk_level: string;
    ward_predictions: number;
  };
  ward_agents?: {
    total: number;
    submitted: number;
    idle: number;
  };
  market_clearing?: {
    status: string;
    accepted_bids: number;
    rejected_bids: number;
    accepted_mw: number;
    unfilled_mw: number;
    clearing_price_per_mwh: number;
    stress_before: number;
    stress_after: number;
  };
  dispatch?: {
    flows: number;
    wards_accepted: number;
    wards_rejected: number;
  };
}

interface Props {
  tick: SimulationTick | null;
  connection: string;
}

const STEPS = [
  { key: "forecast", label: "ML Forecast", num: 1 },
  { key: "ward_agents", label: "25 Ward Agents", num: 2 },
  { key: "market_clearing", label: "Market Clear", num: 3 },
  { key: "dispatch", label: "Dispatch → Map", num: 4 },
] as const;

export function MarketPipeline({ tick, connection }: Props) {
  const pipeline = tick?.snapshot?.pipeline as PipelineSnapshot | undefined;
  const active = connection === "live" && tick != null;

  return (
    <section className="panel market-pipeline">
      <header className="flex items-center justify-between gap-2">
        <h2 className="panel-title mb-0">Agent → Market Pipeline</h2>
        <span className={`stream-pill stream-${connection}`}>{connection}</span>
      </header>
      <p className="text-xs text-slate-500">
        ML on GX10 → 25 agents bid → market selects → map & stress update
      </p>

      <div className="pipeline-steps">
        {STEPS.map((step, index) => (
          <div key={step.key} className="pipeline-step-wrap">
            {index > 0 && <span className="pipeline-step-arrow">→</span>}
            <PipelineStep
              step={step}
              active={active}
              data={pipeline?.[step.key]}
              tick={tick}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

function PipelineStep({
  step,
  active,
  data,
  tick,
}: {
  step: (typeof STEPS)[number];
  active: boolean;
  data: PipelineSnapshot[keyof PipelineSnapshot] | undefined;
  tick: SimulationTick | null;
}) {
  let detail = "Waiting…";
  let metric = "—";
  let status: "idle" | "active" | "done" = "idle";

  if (active && tick) {
    status = "active";
    if (step.key === "forecast") {
      const f = data as PipelineSnapshot["forecast"];
      detail = `${tick.grid_prediction.risk_level} · ${(tick.grid_prediction.grid_stress_probability * 100).toFixed(0)}%`;
      metric = `${f?.ward_predictions ?? tick.ward_predictions.length} wards`;
      status = "done";
    } else if (step.key === "ward_agents") {
      const w = data as PipelineSnapshot["ward_agents"];
      const submitted = w?.submitted ?? tick.submitted_bids.length;
      const total = w?.total ?? tick.ward_agent_decisions.length;
      detail = `${submitted} bids submitted`;
      metric = `${total - submitted} idle`;
      status = submitted > 0 ? "done" : "active";
    } else if (step.key === "market_clearing") {
      const m = data as PipelineSnapshot["market_clearing"];
      const cr = tick.market_result.clearing_result;
      detail = m?.status ?? cr.clearing_status;
      metric = `${formatMw(m?.accepted_mw ?? cr.accepted_reduction_mw)} cleared`;
      status = (m?.accepted_bids ?? tick.market_result.accepted_bids.length) > 0 ? "done" : "active";
    } else if (step.key === "dispatch") {
      const d = data as PipelineSnapshot["dispatch"];
      const flows = d?.flows ?? tick.kepler_flows.length;
      const accepted = d?.wards_accepted ?? tick.market_result.accepted_bids.length;
      detail = `${flows} flow arcs`;
      metric = `${accepted} wards dispatched`;
      status = flows > 0 ? "done" : "active";
    }
  }

  return (
    <div className={`pipeline-step pipeline-step-${status}`}>
      <span className="pipeline-step-num">{step.num}</span>
      <p className="text-[10px] font-semibold text-slate-300">{step.label}</p>
      <p className="text-xs text-indigo-300">{detail}</p>
      <p className="text-[10px] text-slate-500">{metric}</p>
    </div>
  );
}
