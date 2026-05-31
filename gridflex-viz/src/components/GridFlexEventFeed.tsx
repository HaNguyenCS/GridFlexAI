import type { SimulationTick } from "../lib/simulationTypes";
import { formatMw } from "../lib/format";

interface Props {
  tick: SimulationTick | null;
  tickHistory: Array<{
    timestamp: string;
    stressBefore: number;
    stressAfter: number;
    bids: number;
    accepted: number;
    targetMw: number;
  }>;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function GridFlexEventFeed({
  tick,
  tickHistory,
  collapsed,
  onToggleCollapse,
}: Props) {
  const phase = tick?.snapshot?.stress_phase as string | undefined;
  const clearing = tick?.market_result?.clearing_result;

  return (
    <section className="gf-panel gf-feed-panel">
      <header className="gf-feed-header-clean">
        <div>
          <div className="gf-panel-kicker">Recent events</div>
          <h2>Grid timeline</h2>
        </div>
        <button type="button" onClick={onToggleCollapse}>
          {collapsed ? "Expand" : "Collapse"}
        </button>
      </header>

      {!collapsed && (
        <ol className="gf-feed-list-clean">
          {!tick && <li className="gf-feed-empty">Waiting for simulation events…</li>}

          {tick && (
            <li className="gf-feed-item gf-feed-current">
              <i />
              <div>
                <strong>{phase?.replace(/_/g, " ") ?? "simulation tick"}</strong>
                <span>
                  Stress {clearing?.stress_score_before ?? "?"} →{" "}
                  {clearing?.stress_score_after ?? "?"}
                </span>
              </div>
              <em>{formatMw(clearing?.accepted_reduction_mw)}</em>
            </li>
          )}

          {tickHistory.slice(0, 6).map((row, index) => (
            <li key={`${row.timestamp}-${index}`} className="gf-feed-item">
              <i />
              <div>
                <strong>{new Date(row.timestamp).toLocaleTimeString()}</strong>
                <span>
                  Target {formatMw(row.targetMw)} · stress {row.stressBefore}→{row.stressAfter}
                </span>
              </div>
              <em>{row.accepted}</em>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
