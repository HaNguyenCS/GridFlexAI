import { useMemo, useState } from "react";
import { AgentObservatory } from "./components/AgentObservatory";
import { GridFlexEventFeed } from "./components/GridFlexEventFeed";
import { WardMap } from "./components/WardMap";
import { useGridStreams } from "./lib/useGridStreams";
import { useSimulationStream } from "./lib/useSimulationStream";
import { useWardColorsFromSimulation } from "./lib/useWardColorsFromSimulation";
import type { StreamConnection } from "./lib/types";
import { fetchTorontoWards } from "./lib/wards";
import type { Ward } from "./lib/mapTypes";

type AppView = "grid" | "agents";

function connectionState(values: StreamConnection, simConnection: string) {
  const gridValues = Object.values(values);
  const gridError = gridValues.some((v) => v === "error");
  const gridLive = gridValues.length > 0 && gridValues.every((v) => v === "live");

  return {
    gridLabel: gridError ? "error" : gridLive ? "live" : "connecting",
    simLabel: simConnection === "error" ? "error" : simConnection === "live" ? "live" : "connecting",
    dataLabel: gridError || simConnection === "error" ? "error" : gridLive && simConnection === "live" ? "connected" : "connecting",
  };
}

export default function App() {
  const [view, setView] = useState<AppView>("grid");
  const [stressModeActive, setStressModeActive] = useState(false);
  const [stressModeLoading, setStressModeLoading] = useState(false);
  const [stressModeError, setStressModeError] = useState<string | null>(null);
  const [feedCollapsed, setFeedCollapsed] = useState(false);
  const [wards, setWards] = useState<Ward[]>([]);

  const {
    apiBase,
    zones,
    sim,
    summary,
    trades,
    issues,
    spikes,
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

  // Load wards for map grid streams
  useMemo(() => {
    fetchTorontoWards().then(setWards).catch(console.error);
  }, []);

  // Use real-time simulation data for ward colors instead of mock stream
  const keplerNodes = simTick?.kepler_nodes ?? [];
  const { wardColors } = useWardColorsFromSimulation({
    keplerNodes,
    ttlMs: 10000, // Colors expire after 10 seconds if no update
  });

  const stressPhase = simTick?.snapshot?.stress_phase as string | undefined;
  const stressModeFromTick = Boolean(simTick?.snapshot?.stress_mode_enabled);
  const isStressVisible = stressModeActive || stressModeFromTick;

  const clearing = simTick?.market_result?.clearing_result;
  const stressBefore = clearing?.stress_score_before;
  const stressAfter = clearing?.stress_score_after;
  const targetMw = simTick?.grid_prediction?.target_reduction_mw;
  const acceptedMw = clearing?.accepted_reduction_mw;
  const unfilledMw = clearing?.unfilled_reduction_mw;

  const status = useMemo(
    () => connectionState(connection, simConnection),
    [connection, simConnection]
  );

  const wardCounts = useMemo(() => {
    const counts = {
      stable: 0,
      problem: 0,
      stressed: 0,
    };

    const nodes = simTick?.kepler_nodes ?? [];

    if (nodes.length === 0) {
      counts.stable = zones.size || 25;
      return counts;
    }

    for (const node of nodes) {
      const risk = node.risk_level;

      if (risk === "critical" || risk === "high") {
        counts.stressed += 1;
      } else if (risk === "medium") {
        counts.problem += 1;
      } else {
        counts.stable += 1;
      }
    }

    return counts;
  }, [simTick, zones.size]);

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

      setStressModeActive(false);
    } catch (error) {
      setStressModeError(error instanceof Error ? error.message : String(error));
    } finally {
      setStressModeLoading(false);
    }
  }

  return (
    <div className="gf-app-shell">
      <header className="gf-topbar">
        <div className="gf-brand-block">
          <div className="gf-brand-mark">
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
              <path
                d="M4 18 L9 7 L14 13 L19 4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="19" cy="4" r="1.7" fill="currentColor" />
            </svg>
          </div>

          <div>
            <div className="gf-eyebrow">Toronto ward stress simulator</div>
            <h1>GridFlex Live</h1>
          </div>
        </div>

        <div className="gf-status-strip">
          <StatusPill label="Grid" value={status.gridLabel} />
          <StatusPill label="Sim" value={status.simLabel} />
          <StatusPill label="Data" value={status.dataLabel} />
        </div>

        <div className="gf-actions">
          {!isStressVisible ? (
            <button
              type="button"
              className="gf-primary-action gf-danger-action"
              onClick={startStressMode}
              disabled={stressModeLoading}
            >
              {stressModeLoading ? "Starting…" : "Simulate Stress"}
            </button>
          ) : (
            <button
              type="button"
              className="gf-primary-action"
              onClick={stopStressMode}
              disabled={stressModeLoading}
            >
              {stressModeLoading ? "Stopping…" : "Return Live"}
            </button>
          )}

          <button
            type="button"
            className="gf-secondary-action"
            onClick={() => setView(view === "agents" ? "grid" : "agents")}
          >
            {view === "agents" ? "Live Grid" : "Agent Observatory"}
          </button>
        </div>

        <div className="gf-headline-metrics">
          <Metric label="Stress" value={stressBefore != null && stressAfter != null ? `${stressBefore} → ${stressAfter}` : "—"} />
          <Metric label="Target" value={targetMw != null ? `${targetMw} MW` : "—"} />
          <Metric label="Phase" value={(stressPhase ?? "waiting").replace(/_/g, " ")} wide />
        </div>
      </header>

      {view === "agents" ? (
        <main className="gf-agents-page">
          <AgentObservatory
            tick={simTick}
            tickCount={tickCount}
            tickHistory={simHistory}
            simConnection={simConnection}
            gridConnection={connection}
            supplySummary={summary}
            sim={sim}
            trades={trades}
            issues={issues}
            spikes={spikes}
            agentMode={simTick?.snapshot?.agent_mode as string | undefined}
          />
        </main>
      ) : (
        <main className="gf-grid-page">
          <section className="gf-map-card">
            <WardMap
              geojsonUrl={`${apiBase}/zones/geojson`}
              zones={zones}
              selectedZone={selectedZone}
              onSelectZone={setSelectedZone}
              flows={[]}
              simNodes={simTick?.kepler_nodes ?? []}
              wardGridColors={wardColors}
              trades={trades}
            />
          </section>

          <aside className="gf-side-panel">
            <section className="gf-panel gf-system-card">
              <div className="gf-panel-kicker">System status</div>
              <h2>{isStressVisible ? "Stress simulator live" : "Live grid monitor"}</h2>

              <div className="gf-status-grid">
                <BigStat label="Stress" value={stressBefore != null && stressAfter != null ? `${stressBefore} → ${stressAfter}` : "—"} />
                <BigStat label="Target" value={targetMw != null ? `${targetMw} MW` : "—"} />
                <BigStat label="Accepted flex" value={acceptedMw != null ? `${acceptedMw.toFixed(1)} MW` : "—"} />
                <BigStat label="Unfilled" value={unfilledMw != null ? `${unfilledMw.toFixed(1)} MW` : "—"} />
              </div>

              <div className="gf-phase-card">
                <span>Current phase</span>
                <strong>{(stressPhase ?? "waiting").replace(/_/g, " ")}</strong>
              </div>
            </section>

            <section className="gf-panel">
              <div className="gf-panel-kicker">Ward health</div>
              <div className="gf-ward-counts">
                <WardCount color="green" label="Doing good" value={wardCounts.stable} />
                <WardCount color="orange" label="Problem" value={wardCounts.problem} />
                <WardCount color="red" label="Stressed" value={wardCounts.stressed} />
              </div>
            </section>

            <GridFlexEventFeed
              tick={simTick}
              tickHistory={simHistory}
              collapsed={feedCollapsed}
              onToggleCollapse={() => setFeedCollapsed((v) => !v)}
            />
          </aside>

          <section className="gf-legend-bar">
            <span className="gf-legend-title">Legend</span>
            <LegendItem color="#22c55e" label="Doing good" />
            <LegendItem color="#f97316" label="Problem" />
            <LegendItem color="#ef4444" label="Stressed" />
          </section>
        </main>
      )}

      {stressModeError && (
        <div className="gf-error-toast">
          <strong>Stress mode error</strong>
          <span>{stressModeError}</span>
        </div>
      )}
    </div>
  );
}

function StatusPill({ label, value }: { label: string; value: string }) {
  const tone =
    value === "live" || value === "connected"
      ? "good"
      : value === "error"
        ? "bad"
        : "warn";

  return (
    <span className={`gf-status-pill gf-status-${tone}`}>
      <i />
      {label}: {value}
    </span>
  );
}

function Metric({
  label,
  value,
  wide,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "gf-metric gf-metric-wide" : "gf-metric"}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function BigStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="gf-big-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function WardCount({
  color,
  label,
  value,
}: {
  color: "green" | "orange" | "red";
  label: string;
  value: number;
}) {
  return (
    <div className={`gf-ward-count gf-ward-count-${color}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="gf-legend-item">
      <i style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}
