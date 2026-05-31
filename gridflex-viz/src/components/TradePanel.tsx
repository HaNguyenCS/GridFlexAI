import type { Trade } from "../lib/types";
import { formatMoney } from "../lib/format";

interface Props {
  trades: Trade[];
}

export function TradePanel({ trades }: Props) {
  const totalMw = trades.reduce((sum, trade) => sum + trade.mw, 0);
  const totalCost = trades.reduce((sum, trade) => sum + trade.cost, 0);

  return (
    <section className="panel flex flex-col gap-3">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="panel-title">Capacity Trades</h2>
          <p className="mt-1 text-xs text-slate-500">
            Inter-ward balancing activity
          </p>
        </div>

        <span className="badge">{trades.length}</span>
      </header>

      <div className="grid grid-cols-2 gap-2">
        <div className="stat-box">
          <div className="stat-value">{totalMw.toFixed(1)} MW</div>
          <div className="stat-label">Traded</div>
        </div>

        <div className="stat-box">
          <div className="stat-value">{formatMoney(totalCost)}</div>
          <div className="stat-label">Trade cost</div>
        </div>
      </div>

      <ul className="max-h-56 space-y-2 overflow-y-auto text-sm">
        {trades.length === 0 && (
          <li className="rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2 text-slate-500">
            No inter-ward trades this tick.
          </li>
        )}

        {trades.map((trade, index) => (
          <li
            key={`${trade.from_zone_id}-${trade.to_zone_id}-${index}`}
            className="trade-row"
          >
            <div className="font-medium text-slate-100">
              {trade.from_zone_id}{" "}
              <span className="text-cyan-400">→</span>{" "}
              {trade.to_zone_id}
            </div>

            <div className="mt-1 flex justify-between text-xs text-slate-400">
              <span>{trade.mw.toFixed(1)} MW</span>
              <span>{formatMoney(trade.cost)}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}