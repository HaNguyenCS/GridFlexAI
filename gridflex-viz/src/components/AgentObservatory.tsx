import type { SimulationTick, TickSummary } from "../lib/simulationTypes";
import type { SimClock, StreamConnection, SupplySummary } from "../lib/types";
import { formatMw } from "../lib/format";

const RISK_COLORS: Record<string, string> = {
  normal: "#22c55e",
  medium: "#eab308",
  high: "#f97316",
  critical: "#ef4444",
};

interface Props {
  tick: SimulationTick | null;
  tickCount: number;
  tickHistory: TickSummary[];
  simConnection: string;
  gridConnection: StreamConnection;
  supplySummary: SupplySummary;
  sim: SimClock | null;
}

type AgentStatus = "idle" | "active" | "error" | "waiting";

function connStatus(live: boolean, error: boolean): AgentStatus {
  if (error) return "error";
  if (live) return "active";
  return "waiting";
}

export function AgentObservatory({
  tick,
  tickCount,
  tickHistory,
  simConnection,
  gridConnection,
  supplySummary,
  sim,
}: Props) {
  const gridLive = Object.values(gridConnection).every((s) => s === "live");
  const gridError = Object.values(gridConnection).some((s) => s === "error");
  const simLive = simConnection === "live";
  const simError = simConnection === "error";

  const decisions = tick?.ward_agent_decisions ?? [];
  const submitted = decisions.filter((d) => d.decision === "submit_bid").length;
  const acceptedIds = new Set(
    (tick?.market_result.accepted_bids ?? []).map((b) => b.ward_id)
  );

  const agents = [
    {
      id: "supply",
      name: "Supply Agent",
      role: "Capacity allocation · inter-ward trades",
      status: connStatus(gridLive, gridError),
      stream: "/ws/supply",
      detail: supplySummary.agent ?? "default_capacity_agent",
      metrics: [
        { label: "Unmet MW", value: formatMw(supplySummary.total_unmet_mw) },
        { label: "Budget left", value: supplySummary.budget_remaining != null ? `$${(supplySummary.budget_remaining / 1000).toFixed(0)}k` : "—" },
      ],
    },
    {
      id: "forecast",
      name: "Grid Forecast Agent",
      role: "System stress + 25 ward predictions",
      status: connStatus(simLive, simError),
      stream: "/ws/simulation/live",
      detail: tick
        ? `${tick.grid_prediction.event_type} · ${tick.grid_prediction.risk_level}`
        : "Awaiting tick…",
      metrics: [
        { label: "Stress prob", value: tick ? `${(tick.grid_prediction.grid_stress_probability * 100).toFixed(0)}%` : "—" },
        { label: "Target MW", value: tick ? formatMw(tick.grid_prediction.target_reduction_mw) : "—" },
      ],
    },
    {
      id: "ward",
      name: "Ward Agents ×25",
      role: "Parallel bid decisions (asyncio.gather)",
      status: connStatus(simLive, simError),
      stream: "internal",
      detail: tick ? `${submitted} bids · ${decisions.length - submitted} idle` : "Awaiting tick…",
      metrics: [
        { label: "Submitted", value: String(submitted) },
        { label: "Predictions", value: tick ? String(tick.ward_predictions.length) : "—" },
      ],
    },
    {
      id: "market",
      name: "Market Clearing Agent",
      role: "Sort bids · fill target · stress after",
      status: connStatus(simLive, simError),
      stream: "internal",
      detail: tick?.market_result.clearing_result.clearing_status ?? "Awaiting tick…",
      metrics: [
        {
          label: "Accepted MW",
          value: tick ? formatMw(tick.market_result.clearing_result.accepted_reduction_mw) : "—",
        },
        {
          label: "Stress",
          value: tick
            ? `${tick.market_result.clearing_result.stress_score_before}→${tick.market_result.clearing_result.stress_score_after}`
            : "—",
        },
      ],
    },
    {
      id: "reporter",
      name: "Reporter Agent",
      role: "Template operator alert",
      status: connStatus(simLive, simError),
      stream: "internal",
      detail: tick?.reporter?.alert.severity ?? "Awaiting tick…",
      metrics: [
        { label: "Severity", value: tick?.reporter?.alert.severity ?? "—" },
        { label: "Flows", value: tick ? String(tick.kepler_flows.length) : "—" },
      ],
    },
  ];

  return (
    <div className="agent-observatory">
      <header className="agent-obs-header">
        <div>
          <h2 className="text-base font-semibold text-slate-100">Agent Observatory</h2>
          <p className="text-xs text-slate-500">
            Staged multi-agent pipeline · {tickCount} simulation ticks
            {sim?.historical_date && ` · ${sim.historical_date} ${sim.sim_time}`}
          </p>
        </div>
        <div className="flex gap-2 text-xs">
          <StatusBadge label="Grid streams" status={connStatus(gridLive, gridError)} />
          <StatusBadge label="Simulation" status={connStatus(simLive, simError)} />
        </div>
      </header>

      <section className="agent-pipeline">
        {agents.map((agent, index) => (
          <div key={agent.id} className="agent-pipeline-step">
            {index > 0 && <span className="agent-pipeline-arrow">→</span>}
            <AgentCard agent={agent} />
          </div>
        ))}
      </section>

      {tick?.reporter?.alert && (
        <section className="panel agent-alert-banner">
          <p className="text-sm font-medium" style={{ color: RISK_COLORS[tick.reporter.alert.severity] ?? "#94a3b8" }}>
            {tick.reporter.alert.title}
          </p>
          <p className="mt-1 text-xs text-slate-400">{tick.reporter.alert.summary}</p>
        </section>
      )}

      <div className="agent-obs-grid">
        <section className="panel">
          <h3 className="panel-title">Ward agent decisions</h3>
          <p className="mb-3 text-xs text-slate-500">
            Green = idle · Blue = bid submitted · Purple = accepted by market
          </p>
          <div className="ward-agent-matrix">
            {(tick?.ward_agent_decisions ?? []).length === 0 && (
              <p className="text-xs text-slate-500">Connect simulation stream to see ward agents…</p>
            )}
            {decisions.map((d) => {
              const pred = tick?.ward_predictions.find((p) => p.ward_id === d.ward_id);
              const accepted = acceptedIds.has(d.ward_id);
              const state = accepted ? "accepted" : d.decision === "submit_bid" ? "bid" : "idle";
              return (
                <div
                  key={d.agent_id}
                  className={`ward-agent-cell ward-agent-${state}`}
                  title={pred?.drivers.join(" · ") ?? d.decision}
                >
                  <span className="ward-agent-id">{d.ward_id.replace("ward_", "")}</span>
                  <span className="ward-agent-action">
                    {accepted
                      ? `${d.bid?.quantity_mw?.toFixed(1) ?? "?"} MW ✓`
                      : d.decision === "submit_bid"
                        ? `${d.bid?.quantity_mw?.toFixed(1) ?? "?"} MW`
                        : "—"}
                  </span>
                  {pred && (
                    <span className="ward-agent-risk" style={{ color: RISK_COLORS[pred.risk_level] }}>
                      {pred.risk_level}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="panel flex flex-col gap-3">
          <h3 className="panel-title">Forecast drivers</h3>
          <ul className="space-y-1 text-xs text-slate-400">
            {(tick?.grid_prediction.drivers ?? ["Waiting for forecast agent…"]).map((d) => (
              <li key={d} className="rounded bg-white/5 px-2 py-1">{d}</li>
            ))}
          </ul>

          <h3 className="panel-title mt-2">Tick history</h3>
          <ul className="max-h-48 space-y-1 overflow-y-auto text-xs">
            {tickHistory.length === 0 && (
              <li className="text-slate-500">No ticks yet</li>
            )}
            {tickHistory.map((t) => (
              <li key={t.timestamp} className="flex justify-between gap-2 rounded bg-white/5 px-2 py-1 tabular-nums">
                <span className="truncate text-slate-500">
                  {new Date(t.timestamp).toLocaleTimeString()}
                </span>
                <span className="text-slate-300">
                  σ {t.stressBefore}→{t.stressAfter}
                </span>
                <span className="text-slate-400">
                  {t.bids}b / {t.accepted}a
                </span>
              </li>
            ))}
          </ul>

          <h3 className="panel-title mt-2">Active ward predictions</h3>
          <ul className="max-h-40 space-y-1 overflow-y-auto text-xs">
            {(tick?.ward_predictions ?? [])
              .filter((p) => p.recommended_action !== "none")
              .slice(0, 8)
              .map((p) => (
                <li key={p.ward_id} className="rounded bg-white/5 px-2 py-1">
                  <span className="font-medium text-slate-300">{p.ward_name}</span>
                  {" · "}
                  <span className="text-slate-500">{p.recommended_action.replace(/_/g, " ")}</span>
                  {" · "}
                  <span className="tabular-nums text-indigo-300">{formatMw(p.recommended_bid_mw)}</span>
                  <p className="mt-0.5 truncate text-slate-600">{p.drivers[0]}</p>
                </li>
              ))}
            {tick && tick.ward_predictions.filter((p) => p.recommended_action !== "none").length === 0 && (
              <li className="text-slate-500">All wards normal this tick</li>
            )}
          </ul>
        </section>
      </div>
    </div>
  );
}

interface AgentCardProps {
  agent: {
    id: string;
    name: string;
    role: string;
    status: AgentStatus;
    stream: string;
    detail: string;
    metrics: Array<{ label: string; value: string }>;
  };
}

function AgentCard({ agent }: AgentCardProps) {
  return (
    <div className={`agent-card agent-card-${agent.status}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold text-slate-200">{agent.name}</p>
        <span className={`agent-status-dot agent-status-${agent.status}`} />
      </div>
      <p className="mt-0.5 text-[10px] text-slate-500">{agent.role}</p>
      <p className="mt-2 text-xs font-medium text-indigo-300">{agent.detail}</p>
      <div className="mt-2 grid grid-cols-2 gap-1">
        {agent.metrics.map((m) => (
          <div key={m.label} className="rounded bg-black/20 px-1.5 py-1">
            <p className="text-[9px] uppercase text-slate-600">{m.label}</p>
            <p className="text-xs tabular-nums text-slate-300">{m.value}</p>
          </div>
        ))}
      </div>
      <p className="mt-1.5 truncate text-[9px] text-slate-600">{agent.stream}</p>
    </div>
  );
}

function StatusBadge({ label, status }: { label: string; status: AgentStatus }) {
  return (
    <span className={`agent-status-badge agent-status-${status}`}>
      {label}: {status}
    </span>
  );
}
