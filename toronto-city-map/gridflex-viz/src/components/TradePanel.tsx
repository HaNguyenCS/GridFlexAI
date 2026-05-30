import type { Trade } from "../lib/types";
import { formatMoney } from "../lib/format";

interface Props {
  trades: Trade[];
}

export function TradePanel({ trades }: Props) {
  return (
    <section className="panel flex flex-col gap-3">
      <header className="flex items-center justify-between">
        <h2 className="panel-title">Capacity Trades</h2>
        <span className="badge">{trades.length}</span>
      </header>

      <ul className="max-h-56 space-y-2 overflow-y-auto text-sm">
        {trades.length === 0 && (
          <li className="text-slate-500">No inter-ward trades this tick.</li>
        )}
        {trades.map((trade, idx) => (
          <li key={`${trade.from_zone_id}-${trade.to_zone_id}-${idx}`} className="trade-row">
            <div className="font-medium">
              {trade.from_zone_id}{" "}
              <span className="text-cyan-400">→</span> {trade.to_zone_id}
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
