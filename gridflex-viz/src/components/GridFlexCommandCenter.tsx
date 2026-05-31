import { MarketPipeline } from "./MarketPipeline";
import { SimulationPanel } from "./SimulationPanel";
import type { SimulationTick } from "../lib/simulationTypes";
import { formatMw } from "../lib/format";

interface Props {
  open: boolean;
  onClose: () => void;
  tick: SimulationTick | null;
  connection: string;
}

function trajectory(before?: number, after?: number): "rising" | "falling" | "stable" {
  if (before == null || after == null) return "stable";
  if (after > before) return "rising";
  if (after < before) return "falling";
  return "stable";
}

export function GridFlexCommandCenter({
  open,
  onClose,
  tick,
  connection,
}: Props) {
  if (!open) return null;

  const clearing = tick?.market_result?.clearing_result;
  const stressBefore = clearing?.stress_score_before;
  const stressAfter = clearing?.stress_score_after;
  const phase = tick?.snapshot?.stress_phase as string | undefined;
  const stressTrajectory = trajectory(stressBefore, stressAfter);

  const acceptedMw = clearing?.accepted_reduction_mw ?? 0;
  const targetMw = tick?.grid_prediction?.target_reduction_mw ?? 0;
  const reserveMw = Math.max(0, Math.round(targetMw - acceptedMw));

  return (
    <>
      <div className="gf-command-scrim" onClick={onClose} />

      <aside className="gf-command-center">
        <header className="gf-command-header">
          <div>
            <span>Command Center</span>
            <strong>Toronto Grid</strong>
          </div>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="gf-command-body">
          <section className="gf-status-card">
            <div className="gf-status-primary">
              <span>Flex remaining</span>
              <strong>{formatMw(reserveMw)}</strong>
              <small>Unfilled reduction target</small>
            </div>

            <div className="gf-status-secondary">
              <span>Stress score</span>
              <strong>
                {stressAfter ?? "—"}
                <small>/100</small>
              </strong>
              <em>{stressTrajectory}</em>
            </div>
          </section>

          <section className="gf-diagnosis-card">
            <span>Diagnostic</span>
            <p>
              GridFlex is running a staged flex-market simulation. The forecast agent detects the stress event, ward agents submit flexibility bids, the market clearing agent accepts the lowest viable bids, and dispatch gradually lowers the system stress score.
            </p>
          </section>

          <section className="gf-command-section">
            <div className="gf-command-section-title">
              <span>Current phase</span>
              <strong>{phase ?? "awaiting simulation"}</strong>
            </div>
            <MarketPipeline tick={tick} connection={connection} />
          </section>

          <section className="gf-command-section">
            <SimulationPanel
              stressBefore={stressBefore}
              stressAfter={stressAfter}
              clearing={clearing}
              submittedBids={tick?.submitted_bids ?? []}
              acceptedBids={tick?.market_result?.accepted_bids ?? []}
              rejectedBids={tick?.market_result?.rejected_bids ?? []}
              alert={tick?.reporter?.alert}
              connection={connection}
              targetMw={tick?.grid_prediction?.target_reduction_mw}
            />
          </section>
        </div>
      </aside>
    </>
  );
}
