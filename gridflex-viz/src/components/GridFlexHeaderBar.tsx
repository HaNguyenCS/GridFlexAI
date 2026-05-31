import clsx from "clsx";
import type { StreamConnection } from "../lib/types";

interface Props {
  isStressVisible: boolean;
  stressPhase?: string;
  tickCount: number;
  wardCount: number;
  targetMw?: number;
  stressBefore?: number;
  stressAfter?: number;
  submittedBids: number;
  acceptedBids: number;
  gridConnection: StreamConnection;
  simConnection: string;
  view: "grid" | "agents";
  stressModeLoading: boolean;
  onViewChange: (view: "grid" | "agents") => void;
  onStartStress: () => void;
  onStopStress: () => void;
}

function gridIsLive(connection: StreamConnection): boolean {
  return Object.values(connection).every((value) => value === "live");
}

function gridHasError(connection: StreamConnection): boolean {
  return Object.values(connection).some((value) => value === "error");
}

function statusLabel(live: boolean, error: boolean): string {
  if (error) return "Error";
  if (live) return "Live";
  return "Connecting";
}

export function GridFlexHeaderBar({
  isStressVisible,
  stressPhase,
  tickCount,
  wardCount,
  targetMw,
  stressBefore,
  stressAfter,
  submittedBids,
  acceptedBids,
  gridConnection,
  simConnection,
  view,
  stressModeLoading,
  onViewChange,
  onStartStress,
  onStopStress,
}: Props) {
  const gridLive = gridIsLive(gridConnection);
  const gridError = gridHasError(gridConnection);
  const simLive = simConnection === "live";
  const simError = simConnection === "error";

  return (
    <header className="gf-header">
      <div className="gf-brand">
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

        <div className="gf-brand-copy">
          <span className="gf-eyebrow">Toronto · ON</span>
          <strong>GridFlex Live</strong>
        </div>

        {isStressVisible && (
          <div className="gf-stress-chip">
            <span>Stress simulator</span>
            <strong>Live</strong>
          </div>
        )}
      </div>

      <div className="gf-header-metrics">
        <HeaderMetric label="Wards" value={String(wardCount)} />
        <HeaderMetric label="Ticks" value={String(tickCount)} />
        <HeaderMetric label="Target" value={targetMw != null ? `${targetMw} MW` : "—"} />
        <HeaderMetric
          label="Stress"
          value={
            stressBefore != null && stressAfter != null
              ? `${stressBefore}→${stressAfter}`
              : "—"
          }
        />
        <HeaderMetric label="Bids" value={`${acceptedBids}/${submittedBids}`} />
      </div>

      <div className="gf-header-actions">
        <nav className="gf-tabs">
          <button
            type="button"
            className={clsx("gf-tab", view === "grid" && "gf-tab-active")}
            onClick={() => onViewChange("grid")}
          >
            Grid
          </button>
          <button
            type="button"
            className={clsx("gf-tab", view === "agents" && "gf-tab-active")}
            onClick={() => onViewChange("agents")}
          >
            Agents
          </button>
        </nav>

        {!isStressVisible ? (
          <button
            type="button"
            className="gf-action-button gf-action-danger"
            onClick={onStartStress}
            disabled={stressModeLoading}
          >
            {stressModeLoading ? "Starting…" : "Simulate stress"}
          </button>
        ) : (
          <button
            type="button"
            className="gf-action-button"
            onClick={onStopStress}
            disabled={stressModeLoading}
          >
            {stressModeLoading ? "Stopping…" : "Return live"}
          </button>
        )}

        <StatusPill label="Grid" live={gridLive} error={gridError} />
        <StatusPill label="Sim" live={simLive} error={simError} />
        {isStressVisible && (
          <span className="gf-phase-pill">
            {(stressPhase ?? "starting").replace(/_/g, " ")}
          </span>
        )}
      </div>
    </header>
  );
}

function HeaderMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="gf-header-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StatusPill({
  label,
  live,
  error,
}: {
  label: string;
  live: boolean;
  error: boolean;
}) {
  return (
    <span
      className={clsx(
        "gf-status-pill",
        live && "gf-status-live",
        error && "gf-status-error",
        !live && !error && "gf-status-waiting"
      )}
    >
      <i />
      {label} · {statusLabel(live, error)}
    </span>
  );
}
