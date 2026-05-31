import { formatMw } from "../lib/format";

interface Bid {
  bid_id: string;
  ward_id: string;
  bid_type: string;
  quantity_mw: number;
  price_per_mwh?: number;
}

interface ClearingResult {
  target_reduction_mw?: number;
  accepted_reduction_mw?: number;
  unfilled_reduction_mw?: number;
  stress_score_before?: number;
  stress_score_after?: number;
  clearing_status?: string;
  clearing_price_per_mwh?: number;
}

interface AlertSummary {
  title: string;
  severity?: string;
  summary: string;
  market_action?: string;
  impact?: string;
  operator_note?: string;
}

interface Props {
  stressBefore?: number;
  stressAfter?: number;
  clearing?: ClearingResult;
  submittedBids: Bid[];
  acceptedBids: Bid[];
  rejectedBids: Bid[];
  alert?: AlertSummary;
  connection: string;
  targetMw?: number;
}

function statusLabel(connection: string): string {
  if (connection === "live") return "live";
  if (connection === "error") return "error";
  return "waiting";
}

function phaseFromAlert(alert?: AlertSummary): string {
  if (!alert?.impact) return "Awaiting simulation";
  return alert.impact.replace("Live stress simulator phase: ", "");
}

export function SimulationPanel({
  stressBefore,
  stressAfter,
  clearing,
  submittedBids,
  acceptedBids,
  rejectedBids,
  alert,
  connection,
  targetMw,
}: Props) {
  const acceptedMw =
    clearing?.accepted_reduction_mw ??
    acceptedBids.reduce((sum, bid) => sum + (bid.quantity_mw ?? 0), 0);

  const unfilledMw = clearing?.unfilled_reduction_mw ?? 0;
  const phase = phaseFromAlert(alert);

  return (
    <section className="panel flex flex-col gap-3">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="panel-title">Flex-Market Simulation</h2>
          <p className="mt-1 text-xs text-slate-500">
            Forecast → ward bids → market clearing → dispatch
          </p>
        </div>

        <span className={`badge stream-${connection}`}>
          {statusLabel(connection)}
        </span>
      </header>

      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Current phase
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-100">
              {phase}
            </p>
          </div>

          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Stress
            </p>
            <p className="mt-1 text-sm font-semibold tabular-nums text-slate-100">
              {stressBefore != null && stressAfter != null
                ? `${stressBefore} → ${stressAfter}`
                : "—"}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Metric label="Target" value={targetMw != null ? formatMw(targetMw) : "—"} />
        <Metric label="Accepted" value={formatMw(acceptedMw)} />
        <Metric label="Submitted bids" value={String(submittedBids.length)} />
        <Metric label="Accepted bids" value={String(acceptedBids.length)} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="stat-box border-amber-500/30 bg-amber-500/10">
          <div className="stat-value text-amber-300">{formatMw(unfilledMw)}</div>
          <div className="stat-label">Unfilled</div>
        </div>

        <div className="stat-box border-red-500/30 bg-red-500/10">
          <div className="stat-value text-red-300">{rejectedBids.length}</div>
          <div className="stat-label">Rejected</div>
        </div>
      </div>

      {clearing && (
        <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs">
          <div className="flex justify-between gap-3">
            <span className="text-slate-500">Clearing status</span>
            <span className="font-medium text-slate-200">
              {clearing.clearing_status ?? "—"}
            </span>
          </div>

          <div className="mt-2 flex justify-between gap-3">
            <span className="text-slate-500">Clearing price</span>
            <span className="font-medium tabular-nums text-slate-200">
              ${clearing.clearing_price_per_mwh?.toFixed?.(2) ?? "0.00"}/MWh
            </span>
          </div>
        </div>
      )}

      {alert && (
        <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-3">
          <p className="text-sm font-semibold text-cyan-100">{alert.title}</p>
          <p className="mt-1 text-xs leading-relaxed text-cyan-200/80">
            {alert.summary}
          </p>

          {alert.market_action && (
            <p className="mt-2 text-xs leading-relaxed text-slate-400">
              {alert.market_action}
            </p>
          )}
        </div>
      )}

      {submittedBids.length === 0 && connection === "live" && (
        <p className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-slate-500">
          Waiting for ward-agent bids.
        </p>
      )}

      {submittedBids.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Latest bids
          </h3>

          <ul className="max-h-44 space-y-2 overflow-y-auto text-xs">
            {submittedBids.slice(0, 8).map((bid) => {
              const accepted = acceptedBids.some(
                (acceptedBid) => acceptedBid.bid_id === bid.bid_id
              );

              return (
                <li
                  key={bid.bid_id}
                  className={`rounded-lg border px-3 py-2 ${
                    accepted
                      ? "border-emerald-500/30 bg-emerald-500/10"
                      : "border-amber-500/30 bg-amber-500/10"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-slate-100">
                      {bid.ward_id}
                    </span>

                    <span
                      className={
                        accepted ? "text-emerald-300" : "text-amber-300"
                      }
                    >
                      {accepted ? "accepted" : "submitted"}
                    </span>
                  </div>

                  <div className="mt-1 flex justify-between gap-3 text-slate-400">
                    <span>{bid.bid_type.replace(/_/g, " ")}</span>
                    <span className="tabular-nums">
                      {formatMw(bid.quantity_mw)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
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