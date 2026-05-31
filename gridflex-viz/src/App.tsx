import { useState } from "react";
import { MarketPipeline } from "./components/MarketPipeline";
import { AgentObservatory } from "./components/AgentObservatory";
import { IssuePanel } from "./components/IssuePanel";
import { SidePanel } from "./components/SidePanel";
import { SimulationPanel } from "./components/SimulationPanel";
import { TradePanel } from "./components/TradePanel";
import { WardMap } from "./components/WardMap";
import { WardMiniCharts } from "./components/WardMiniCharts";
import { WardTimeSeriesChart } from "./components/WardTimeSeriesChart";
import { STATUS_COLORS } from "./lib/format";
import { useGridStreams } from "./lib/useGridStreams";
import { useSimulationStream } from "./lib/useSimulationStream";

type AppView = "grid" | "agents";

export default function App() {
  const [view, setView] = useState<AppView>("grid");

  const {
    apiBase,
    zones,
    history,
    sim,
    trades,
    issues,
    spikes,
    summary,
    lastTs,
    connection,
    selectedZone,
    setSelectedZone,
  } = useGridStreams();

  const { tick: simTick, tickCount, history: simHistory, connection: simConnection } =
    useSimulationStream();

  const selectedHistory = selectedZone
    ? (history.get(selectedZone) ?? [])
    : [];

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">GridFlex Live</h1>
          <p className="text-xs text-slate-400">
            Toronto ward grid · {summary.agent ?? "supply agent"}
            {sim != null && (
              <>
                {" "}
                · {sim.historical_date ?? `Day ${sim.sim_day}`} {sim.sim_time}
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <nav className="view-tabs">
            <button
              type="button"
              className={view === "grid" ? "view-tab view-tab-active" : "view-tab"}
              onClick={() => setView("grid")}
            >
              Live Grid
            </button>
            <button
              type="button"
              className={view === "agents" ? "view-tab view-tab-active" : "view-tab"}
              onClick={() => setView("agents")}
            >
              Agent Observatory
            </button>
          </nav>
          <div className="flex flex-wrap gap-2 text-xs">
            {(["demand", "supply", "trades", "issues"] as const).map((key) => (
              <span key={key} className={`stream-pill stream-${connection[key]}`}>
                {key}: {connection[key]}
              </span>
            ))}
            <span className={`stream-pill stream-${simConnection}`}>
              simulation: {simConnection}
            </span>
          </div>
        </div>
      </header>

      {view === "agents" ? (
        <AgentObservatory
          tick={simTick}
          tickCount={tickCount}
          tickHistory={simHistory}
          simConnection={simConnection}
          gridConnection={connection}
          supplySummary={summary}
          sim={sim}
          agentMode={
            (simTick?.snapshot?.agent_mode as string | undefined) ??
            (summary.agent === "nemoclaw_supply_agent"
              ? "nemoclaw"
              : summary.agent === "llm_supply_agent"
                ? "llm"
                : "ml_service")
          }
        />
      ) : (
        <main className="layout">
          <div className="main-column">
            <div className="map-panel">
              <WardMap
                geojsonUrl={`${apiBase}/zones/geojson`}
                zones={zones}
                selectedZone={selectedZone}
                onSelectZone={setSelectedZone}
                flows={simTick?.kepler_flows ?? []}
                simNodes={simTick?.kepler_nodes ?? []}
              />
              <div className="legend">
                {Object.entries(STATUS_COLORS).map(([status, color]) => (
                  <span key={status} className="legend-item">
                    <i style={{ background: color }} />
                    {status.replace("_", " ")}
                  </span>
                ))}
                {simTick && (
                  <>
                    <span className="legend-item">
                      <i style={{ background: "#38bdf8" }} />
                      bid accepted
                    </span>
                    <span className="legend-item">
                      <i style={{ background: "#f97316" }} />
                      bid rejected
                    </span>
                  </>
                )}
              </div>
            </div>

            <WardTimeSeriesChart
              zoneId={selectedZone}
              points={selectedHistory}
            />
          </div>

          <aside className="sidebar">
            <SidePanel
              zones={zones}
              summary={summary}
              spikes={spikes}
              sim={sim}
              lastTs={lastTs}
              selectedZone={selectedZone}
            />
            <WardMiniCharts
              history={history}
              zones={zones}
              selectedZone={selectedZone}
              onSelectZone={setSelectedZone}
            />
            <MarketPipeline tick={simTick} connection={simConnection} />
            <SimulationPanel
              stressBefore={simTick?.market_result.clearing_result.stress_score_before}
              stressAfter={simTick?.market_result.clearing_result.stress_score_after}
              clearing={simTick?.market_result.clearing_result}
              submittedBids={simTick?.submitted_bids ?? []}
              acceptedBids={simTick?.market_result.accepted_bids ?? []}
              rejectedBids={simTick?.market_result.rejected_bids ?? []}
              alert={simTick?.reporter?.alert}
              connection={simConnection}
              targetMw={simTick?.grid_prediction.target_reduction_mw}
            />
            <TradePanel trades={trades} />
            <IssuePanel issues={issues} connection={connection} />
          </aside>
        </main>
      )}
    </div>
  );
}
