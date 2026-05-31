import type { ClearingResult, OperatorAlert, SimulationBid } from "../lib/simulationTypes";
import { formatMw } from "../lib/format";

interface Props {
  stressBefore?: number;
  stressAfter?: number;
  clearing?: ClearingResult;
  submittedBids: SimulationBid[];
  acceptedBids: SimulationBid[];
  rejectedBids: SimulationBid[];
  alert?: OperatorAlert;
  connection: string;
  targetMw?: number;
}

const RISK_COLORS: Record<string, string> = {
  normal: "#22c55e",
  medium: "#eab308",
  high: "#f97316",
  critical: "#ef4444",
};

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
  const severity = alert?.severity ?? "normal";
  const riskColor = RISK_COLORS[severity] ?? "#64748b";

  return (
    <section className="panel flex flex-col gap-3">
      <header className="flex items-start justify-between gap-2">
        <div>
          <h2 className="panel-title">Flex Market Simulation</h2>
          <p className="text-xs text-slate-500">/ws/simulation/live · {connection}</p>
        </div>
        {stressBefore != null && (
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wide text-slate-500">Stress</p>
            <p className="text-sm font-semibold tabular-nums">
              <span style={{ color: RISK_COLORS.critical }}>{stressBefore}</span>
              {" → "}
              <span style={{ color: RISK_COLORS.normal }}>{stressAfter ?? "—"}</span>
            </p>
          </div>
        )}
      </header>

      {alert && (
        <div
          className="rounded-lg border px-3 py-2 text-xs"
          style={{ borderColor: `${riskColor}55`, background: `${riskColor}15` }}
        >
          <p className="font-semibold" style={{ color: riskColor }}>
            {alert.title}
          </p>
          <p className="mt-1 text-slate-300">{alert.summary}</p>
          <p className="mt-1 text-slate-400">{alert.market_action}</p>
        </div>
      )}

      {clearing && (
        <div className="grid grid-cols-2 gap-2 text-xs">
          <Metric label="Target MW" value={formatMw(targetMw ?? clearing.target_reduction_mw)} />
          <Metric label="Accepted MW" value={formatMw(clearing.accepted_reduction_mw)} />
          <Metric label="Market status" value={clearing.clearing_status} />
          <Metric
            label="Clear price"
            value={
              clearing.clearing_price_per_mwh > 0
                ? `$${clearing.clearing_price_per_mwh.toFixed(0)}/MWh`
                : "—"
            }
          />
        </div>
      )}

      {connection === "live" && submittedBids.length === 0 && (
        <p className="text-xs text-amber-400/90">
          No ward bids this tick — replay may be on a calm hour. Run{" "}
          <code className="text-amber-200">curl -X POST localhost:8000/demo/reset-playback</code>{" "}
          or wait for the spike loop (16:00).
        </p>
      )}

      <BidList
        title={`Accepted by market (${acceptedBids.length})`}
        bids={acceptedBids}
        emptyText="No bids accepted yet"
        accent="accepted"
      />
      <BidList
        title={`Submitted / rejected (${rejectedBids.length})`}
        bids={rejectedBids}
        emptyText="No rejected bids"
        accent="rejected"
      />
    </section>
  );
}

function BidList({
  title,
  bids,
  emptyText,
  accent,
}: {
  title: string;
  bids: SimulationBid[];
  emptyText: string;
  accent: "accepted" | "rejected";
}) {
  return (
    <div>
      <h3 className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {title}
      </h3>
      <ul className="max-h-28 space-y-1 overflow-y-auto text-xs">
        {bids.length === 0 && <li className="text-slate-500">{emptyText}</li>}
        {bids.slice(0, 10).map((bid) => (
          <li
            key={bid.bid_id}
            className={`flex justify-between gap-2 rounded px-2 py-1 bid-row-${accent}`}
          >
            <span className="truncate text-slate-300">{bid.ward_id}</span>
            <span className="shrink-0 tabular-nums text-slate-400">
              {formatMw(bid.quantity_mw)} @ ${bid.price_per_mwh.toFixed(0)}
            </span>
          </li>
        ))}
        {bids.length > 10 && (
          <li className="text-slate-500">+{bids.length - 10} more</li>
        )}
      </ul>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/5 px-2 py-1.5">
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="font-medium tabular-nums text-slate-200">{value}</p>
    </div>
  );
}
