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
  const [stressModeActive, setStressModeActive] = useState(false);
  const [stressModeLoading, setStressModeLoading] = useState(false);
  const [stressModeError, setStressModeError] = useState<string | null>(null);

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

  const {
    tick: simTick,
    tickCount,
    history: simHistory,
    connection: simConnection,
  } = useSimulationStream();

  const displayTick = simTick;
  const displayConnection = simConnection;
  const stressPhase = displayTick?.snapshot?.stress_phase as string | undefined;
  const stressModeFromTick = Boolean(displayTick?.snapshot?.stress_mode_enabled);
  const isStressVisible = stressModeActive || stressModeFromTick;
  const simulationLabel = isStressVisible ? "stress-demo" : simConnection;

  const selectedHistory = selectedZone ? history.get(selectedZone) ?? [] : [];

  async function startStressMode() {
    setStressModeLoading(true);
    setStressModeError(null);

    try {
      const response = await fetch(`${apiBase}/simulation/stress-mode/start`, {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(`Stress mode failed: ${response.status}`);
      }

      const data = await response.json();
      console.log("STRESS MODE STARTED", data);

      setStressModeActive(true);
      setView("grid");
    } catch (error) {
      setStressModeError(error instanceof Error ? error.message : String(error));
    } finally {
      setStressModeLoading(false);
    }
  }

  async function stopStressMode() {
    setStressModeLoading(true);
    setStressModeError(null);

    try {
      const response = await fetch(`${apiBase}/simulation/stress-mode/stop`, {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(`Stop stress mode failed: ${response.status}`);
      }

      const data = await response.json();
      console.log("STRESS MODE STOPPED", data);

      setStressModeActive(false);
    } catch (error) {
      setStressModeError(error instanceof Error ? error.message : String(error));
    } finally {
      setStressModeLoading(false);
    }
  }

  const stressBefore =
    displayTick?.market_result?.clearing_result?.stress_score_before;
  const stressAfter =
    displayTick?.market_result?.clearing_result?.stress_score_after;
  const targetMw = displayTick?.grid_prediction?.target_reduction_mw;
  const submittedBids = displayTick?.submitted_bids?.length ?? 0;
  const acceptedBids = displayTick?.market_result?.accepted_bids?.length ?? 0;
  const flows = displayTick?.kepler_flows?.length ?? 0;
  const agentMode = displayTick?.snapshot?.agent_mode as string | undefined;

  return (
    <div
      className="app-shell"
      style={isStressVisible ? { paddingTop: 48 } : undefined}
    >
      {isStressVisible && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 9999,
            background: "#dc2626",
            color: "white",
            padding: "12px 20px",
            fontWeight: 800,
            textAlign: "center",
            letterSpacing: "0.04em",
          }}
        >
          STRESS SIMULATOR LIVE · PHASE: {(stressPhase ?? "starting").toUpperCase()} · TARGET{" "}
          {targetMw ?? 650} MW · STRESS {stressBefore ?? "?"} → {stressAfter ?? "?"} ·{" "}
          {submittedBids} BIDS · {acceptedBids} ACCEPTED · {flows} FLOWS
        </div>
      )}

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
            {isStressVisible && <> · live stress simulator active</>}
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

            {!isStressVisible ? (
              <button
                type="button"
                className="view-tab"
                onClick={startStressMode}
                disabled={stressModeLoading}
              >
                {stressModeLoading ? "Starting Stress Mode..." : "Simulate Grid Stress"}
              </button>
            ) : (
              <button
                type="button"
                className="view-tab"
                onClick={stopStressMode}
                disabled={stressModeLoading}
              >
                {stressModeLoading ? "Stopping..." : "Return to Live"}
              </button>
            )}
          </nav>

          <div className="flex flex-wrap gap-2 text-xs">
            {(["demand", "supply", "trades", "issues"] as const).map((key) => (
              <span key={key} className={`stream-pill stream-${connection[key]}`}>
                {key}: {connection[key]}
              </span>
            ))}

            <span className={`stream-pill stream-${displayConnection}`}>
              simulation: {simulationLabel}
            </span>
          </div>
        </div>
      </header>

      {view === "agents" ? (
        <AgentObservatory
          key={isStressVisible ? `stress-agents-${tickCount}` : "live-agents"}
          tick={displayTick}
          tickCount={tickCount}
          tickHistory={simHistory}
          simConnection={displayConnection}
          gridConnection={connection}
          supplySummary={summary}
          sim={sim}
          agentMode={
            agentMode ??
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
                key={isStressVisible ? `stress-map-${tickCount}` : "live-map"}
                geojsonUrl={`${apiBase}/zones/geojson`}
                zones={zones}
                selectedZone={selectedZone}
                onSelectZone={setSelectedZone}
                flows={[]}
                simNodes={displayTick?.kepler_nodes ?? []}
              />

              <div className="legend">
                {Object.entries(STATUS_COLORS).map(([status, color]) => (
                  <span key={status} className="legend-item">
                    <i style={{ background: color }} />
                    {status.replace("_", " ")}
                  </span>
                ))}

                {displayTick && (
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

            <WardTimeSeriesChart zoneId={selectedZone} points={selectedHistory} />
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

            {isStressVisible && (
              <section className="panel">
                <h2 className="text-sm font-semibold text-slate-100">
                  Stress Simulator Live
                </h2>

                <p className="text-xs text-slate-400">
                  Phase: {stressPhase ?? "starting"}
                </p>

                <p className="text-xs text-slate-400">
                  Mode: {agentMode ?? "stress_simulator_live"}
                </p>

                <p className="text-xs text-slate-400">
                  Risk: {displayTick?.grid_prediction?.risk_level ?? "critical"}
                </p>

                <p className="text-xs text-slate-400">
                  Target: {targetMw ?? 650} MW
                </p>

                <p className="text-xs text-slate-400">
                  Stress: {stressBefore ?? "?"} → {stressAfter ?? "?"}
                </p>

                <p className="text-xs text-slate-400">
                  Submitted bids: {submittedBids}
                </p>

                <p className="text-xs text-slate-400">
                  Accepted bids: {acceptedBids}
                </p>

                <p className="text-xs text-slate-400">Flows: {flows}</p>
              </section>
            )}

            {stressModeError && (
              <section className="panel">
                <h2 className="text-sm font-semibold text-red-300">
                  Stress Mode Error
                </h2>
                <p className="text-xs text-red-200">{stressModeError}</p>
              </section>
            )}

            <MarketPipeline
              key={isStressVisible ? `stress-pipeline-${tickCount}` : "live-pipeline"}
              tick={displayTick}
              connection={displayConnection}
            />

            <SimulationPanel
              key={isStressVisible ? `stress-panel-${tickCount}` : "live-panel"}
              stressBefore={
                displayTick?.market_result?.clearing_result?.stress_score_before
              }
              stressAfter={
                displayTick?.market_result?.clearing_result?.stress_score_after
              }
              clearing={displayTick?.market_result?.clearing_result}
              submittedBids={displayTick?.submitted_bids ?? []}
              acceptedBids={displayTick?.market_result?.accepted_bids ?? []}
              rejectedBids={displayTick?.market_result?.rejected_bids ?? []}
              alert={displayTick?.reporter?.alert}
              connection={displayConnection}
              targetMw={displayTick?.grid_prediction?.target_reduction_mw}
            />

            <TradePanel trades={trades} />
            <IssuePanel issues={issues} connection={connection} />
          </aside>
        </main>
      )}
    </div>
  );
}