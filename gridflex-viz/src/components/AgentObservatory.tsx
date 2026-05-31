import type { SimulationTick, TickSummary } from "../lib/simulationTypes";
import type {
  ActiveSpike,
  Issue,
  SimClock,
  StreamConnection,
  SupplySummary,
  Trade,
} from "../lib/types";
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
  trades: Trade[];
  issues: Issue[];
  spikes: ActiveSpike[];
  agentMode?: string;
}

type AgentStatus = "idle" | "active" | "error" | "waiting";

function connStatus(live: boolean, error: boolean): AgentStatus {
  if (error) return "error";
  if (live) return "active";
  return "waiting";
}

function streamConnStatus(keys: (keyof StreamConnection)[], gridConnection: StreamConnection): AgentStatus {
  const live = keys.every((k) => gridConnection[k] === "live");
  const error = keys.some((k) => gridConnection[k] === "error");
  return connStatus(live, error);
}

function stressPhase(tick: SimulationTick | null): string {
  const phase = tick?.snapshot?.stress_phase;

  if (typeof phase === "string" && phase.length > 0) {
    return phase;
  }

  return "live simulation";
}

function agentModeLabel(agentMode: string): string {
  if (agentMode === "nemoclaw") return "NemoClaw agent runtime";
  if (agentMode === "llm") return "LLM agent runtime";
  if (agentMode === "ml_service") return "ML service agents";
  if (agentMode === "stress_simulator_live") return "Stress simulator";
  return "Deterministic agents";
}

function inferOrchestration(
  supplySummary: SupplySummary,
  spikes: ActiveSpike[],
  issues: Issue[],
  trades: Trade[]
) {
  const criticalIssues = issues.filter((i) => i.status === "issue");
  const imbalancedCount = issues.filter(
    (i) => i.status === "issue" || i.status === "warning" || i.over_capacity > 0
  ).length;

  const traderAction =
    criticalIssues.length > 0
      ? "escalate"
      : trades.length > 0
        ? "review_trades"
        : "observe";

  const needsRebalance =
    supplySummary.fully_served === false ||
    (supplySummary.total_unmet_mw ?? 0) > 0.5 ||
    spikes.length > 0 ||
    imbalancedCount > 0;

  const balancerAction = needsRebalance ? "rebalance" : "observe";

  const notes: string[] = [];
  if (criticalIssues.length > 0) {
    notes.push(`Trader escalates ${criticalIssues.length} critical issue(s) first`);
  }
  if (trades.length > 0 && criticalIssues.length === 0) {
    notes.push("Trader reviewing active capacity trades");
  }
  if (needsRebalance) {
    notes.push(
      `Balancer rebalancing (unmet=${formatMw(supplySummary.total_unmet_mw ?? 0)}, spikes=${spikes.length})`
    );
  } else {
    notes.push("Grid balanced; Balancer observing");
  }
  if (traderAction === "observe") {
    notes.push("No trade or issue activity; Trader observing");
  }

  return { balancerAction, traderAction, notes };
}

export function AgentObservatory({
  tick,
  tickCount,
  tickHistory,
  simConnection,
  gridConnection,
  supplySummary,
  sim,
  trades,
  issues,
  spikes,
  agentMode = "deterministic",
}: Props) {
  const gridLive = Object.values(gridConnection).every((status) => status === "live");
  const gridError = Object.values(gridConnection).some((status) => status === "error");
  const simLive = simConnection === "live";
  const simError = simConnection === "error";

  const activeAgentMode =
    (tick?.snapshot?.agent_mode as string | undefined) ?? agentMode;

  const phase = stressPhase(tick);

  const decisions = tick?.ward_agent_decisions ?? [];
  const submitted = decisions.filter((decision) => decision.decision === "submit_bid").length;

  const acceptedIds = new Set(
    (tick?.market_result.accepted_bids ?? []).map((bid) => bid.ward_id)
  );

  const recoveredIds = new Set(
    (tick?.kepler_nodes ?? [])
      .filter((node) => node.dispatch_status === "recovered")
      .map((node) => node.ward_id)
  );

  const criticalIssues = issues.filter((i) => i.status === "issue");
  const warnings = issues.filter((i) => i.status === "warning");
  const totalTradedMw = trades.reduce((sum, t) => sum + t.mw, 0);
  const { balancerAction, traderAction, notes } = inferOrchestration(
    supplySummary,
    spikes,
    issues,
    trades
  );

  const wardRole =
    activeAgentMode === "nemoclaw"
      ? "OpenClaw batch decisions (25 wards per tick)"
      : activeAgentMode === "llm"
        ? "NIM batch decisions (25 wards per call)"
        : activeAgentMode === "ml_service"
          ? "ML service POST /agent/ward-market"
          : "Parallel asyncio.gather (deterministic)";

  const orchestrator = {
    id: "orchestrator",
    name: "Orchestrator",
    role: "Oversees Balancer, Trader, and Ward Agents each tick",
    status: connStatus(gridLive, gridError),
    stream: "stream_agents runner",
    detail: `Balancer=${balancerAction} · Trader=${traderAction}`,
    metrics: [
      { label: "Phase", value: phase.replace(/_/g, " ") },
      { label: "Warnings", value: String(warnings.length) },
    ],
  };

  const subordinateAgents = [
    {
      id: "balancer",
      name: "Balancer",
      role: "Demand · supply · trades stream monitoring",
      status: streamConnStatus(["demand", "supply", "trades"], gridConnection),
      stream: "/ws/demand · /ws/supply · /ws/trades",
      detail:
        balancerAction === "rebalance"
          ? `Rebalancing · ${spikes.length} spike(s)`
          : "Observing · grid balanced",
      metrics: [
        { label: "Unmet MW", value: formatMw(supplySummary.total_unmet_mw) },
        {
          label: "Budget left",
          value:
            supplySummary.budget_remaining != null
              ? `$${(supplySummary.budget_remaining / 1000).toFixed(0)}k`
              : "—",
        },
      ],
    },
    {
      id: "trader",
      name: "Trader",
      role: "Trades · issues stream monitoring",
      status: streamConnStatus(["trades", "issues"], gridConnection),
      stream: "/ws/trades · /ws/issues",
      detail:
        traderAction === "escalate"
          ? `Escalating ${criticalIssues.length} critical issue(s)`
          : traderAction === "review_trades"
            ? `Reviewing ${trades.length} active trade(s)`
            : "Observing · no critical activity",
      metrics: [
        { label: "Trades", value: String(trades.length) },
        { label: "Traded MW", value: formatMw(totalTradedMw) },
      ],
    },
    {
      id: "ward",
      name: "Ward Agents ×25",
      role: wardRole,
      status: connStatus(simLive, simError),
      stream: "/ws/simulation/live",
      detail: tick
        ? `${submitted} bids · ${Math.max(0, decisions.length - submitted)} idle`
        : "Awaiting simulation tick…",
      metrics: [
        { label: "Submitted", value: String(submitted) },
        {
          label: "Accepted",
          value: tick ? String(tick.market_result.accepted_bids.length) : "—",
        },
      ],
    },
  ];

  return (
    <div className="agent-observatory">
      <header className="agent-obs-header">
        <div>
          <h2 className="text-base font-semibold text-slate-100">Agent Observatory</h2>
          <p className="text-xs text-slate-500">
            Orchestrator oversees Balancer · Trader · Ward Agents ×25
            {" · "}{agentModeLabel(activeAgentMode)}
            {" · "}{tickCount} simulation ticks
            {sim?.historical_date && ` · ${sim.historical_date} ${sim.sim_time}`}
          </p>
        </div>

        <div className="flex gap-2 text-xs">
          <StatusBadge label="Grid streams" status={connStatus(gridLive, gridError)} />
          <StatusBadge label="Ward agents" status={connStatus(simLive, simError)} />
        </div>
      </header>

      <section className="agent-hierarchy">
        <div className="agent-orchestrator-tier">
          <AgentCard agent={orchestrator} prominent />
        </div>

        <div className="agent-hierarchy-connector" aria-hidden="true">
          <span className="agent-hierarchy-label">coordinates</span>
        </div>

        <div className="agent-subordinates">
          {subordinateAgents.map((agent) => (
            <div key={agent.id} className="agent-subordinate-step">
              <AgentCard agent={agent} />
            </div>
          ))}
        </div>
      </section>

      {tick?.reporter?.alert && (
        <section className="panel agent-alert-banner">
          <div className="flex items-center justify-between gap-3">
            <p
              className="text-sm font-medium"
              style={{
                color: RISK_COLORS[tick.reporter.alert.severity] ?? "#94a3b8",
              }}
            >
              {tick.reporter.alert.title}
            </p>

            <span className="rounded-full bg-white/10 px-2 py-1 text-xs text-slate-300">
              {phase}
            </span>
          </div>

          <p className="mt-1 text-xs text-slate-400">
            {tick.reporter.alert.summary}
          </p>
        </section>
      )}

      {notes.length > 0 && (
        <section className="panel agent-alert-banner">
          <p className="text-sm font-medium text-indigo-300">Orchestrator tick</p>
          <ul className="mt-1 space-y-0.5 text-xs text-slate-400">
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </section>
      )}

      <div className="agent-obs-grid">
        <section className="panel">
          <h3 className="panel-title">Ward Agent Decisions</h3>

          <p className="mb-3 text-xs text-slate-500">
            Red = stressed · Amber = bid submitted · Purple = accepted · Green = recovered
          </p>

          <div className="ward-agent-matrix">
            {decisions.length === 0 && (
              <p className="text-xs text-slate-500">
                Connect simulation stream to see ward agents…
              </p>
            )}

            {decisions.map((decision) => {
              const pred = tick?.ward_predictions.find(
                (prediction) => prediction.ward_id === decision.ward_id
              );

              const accepted = acceptedIds.has(decision.ward_id);
              const recovered = recoveredIds.has(decision.ward_id);

              const state = recovered
                ? "recovered"
                : accepted
                  ? "accepted"
                  : decision.decision === "submit_bid"
                    ? "bid"
                    : pred?.risk_level === "critical" || pred?.risk_level === "high"
                      ? "stressed"
                      : "idle";

              return (
                <div
                  key={decision.agent_id}
                  className={`ward-agent-cell ward-agent-${state}`}
                  title={pred?.drivers.join(" · ") ?? decision.decision}
                >
                  <span className="ward-agent-id">
                    {decision.ward_id.replace("ward_", "")}
                  </span>

                  <span className="ward-agent-action">
                    {recovered
                      ? "stable"
                      : accepted
                        ? `${decision.bid?.quantity_mw?.toFixed(1) ?? "?"} MW ✓`
                        : decision.decision === "submit_bid"
                          ? `${decision.bid?.quantity_mw?.toFixed(1) ?? "?"} MW`
                          : "—"}
                  </span>

                  {pred && (
                    <span
                      className="ward-agent-risk"
                      style={{ color: RISK_COLORS[pred.risk_level] }}
                    >
                      {recovered ? "normal" : pred.risk_level}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="panel flex flex-col gap-3">
          <h3 className="panel-title">Trader · issues</h3>
          <ul className="max-h-32 space-y-1 overflow-y-auto text-xs">
            {issues.length === 0 && (
              <li className="text-slate-500">No open issues</li>
            )}
            {issues.slice(0, 6).map((issue) => (
              <li key={issue.zone_id} className="rounded bg-white/5 px-2 py-1">
                <span className="font-medium text-slate-300">{issue.zone_id}</span>
                {" · "}
                <span style={{ color: RISK_COLORS[issue.status === "issue" ? "critical" : "medium"] }}>
                  {issue.status}
                </span>
                <p className="mt-0.5 truncate text-slate-600">{issue.message}</p>
              </li>
            ))}
          </ul>

          <h3 className="panel-title mt-2">Active spikes</h3>
          <ul className="space-y-1 text-xs text-slate-400">
            {spikes.length === 0 && <li className="text-slate-500">No active demand spikes</li>}
            {spikes.map((spike) => (
              <li key={`${spike.scope}-${spike.zone_id ?? "grid"}`} className="rounded bg-white/5 px-2 py-1">
                {spike.zone_id ?? spike.scope} · ×{spike.multiplier.toFixed(2)} · {spike.spike_type}
              </li>
            ))}
          </ul>

          <h3 className="panel-title mt-2">Ward tick history</h3>
          <ul className="max-h-40 space-y-1 overflow-y-auto text-xs">
            {tickHistory.length === 0 && (
              <li className="text-slate-500">No simulation ticks yet</li>
            )}

            {tickHistory.map((historyTick) => (
              <li
                key={historyTick.timestamp}
                className="flex justify-between gap-2 rounded bg-white/5 px-2 py-1 tabular-nums"
              >
                <span className="truncate text-slate-500">
                  {new Date(historyTick.timestamp).toLocaleTimeString()}
                </span>

                <span className="text-slate-300">
                  σ {historyTick.stressBefore}→{historyTick.stressAfter}
                </span>

                <span className="text-slate-400">
                  {historyTick.bids}b / {historyTick.accepted}a
                </span>
              </li>
            ))}
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

function AgentCard({ agent, prominent = false }: AgentCardProps & { prominent?: boolean }) {
  return (
    <div className={`agent-card agent-card-${agent.status}${prominent ? " agent-card-orchestrator" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold text-slate-200">{agent.name}</p>
        <span className={`agent-status-dot agent-status-${agent.status}`} />
      </div>

      <p className="mt-0.5 text-[10px] text-slate-500">{agent.role}</p>
      <p className="mt-2 text-xs font-medium text-indigo-300">{agent.detail}</p>

      <div className="mt-2 grid grid-cols-2 gap-1">
        {agent.metrics.map((metric) => (
          <div key={metric.label} className="rounded bg-black/20 px-1.5 py-1">
            <p className="text-[9px] uppercase text-slate-600">{metric.label}</p>
            <p className="text-xs tabular-nums text-slate-300">{metric.value}</p>
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
