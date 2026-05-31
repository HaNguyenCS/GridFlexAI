import clsx from "clsx";

interface Props {
  collapsed: boolean;
  onToggleCollapse: () => void;
  phase?: string;
  counts: {
    normal: number;
    medium: number;
    high: number;
    critical: number;
    bid: number;
    accepted: number;
    recovered: number;
  };
}

export function GridFlexLegendPanel({
  collapsed,
  onToggleCollapse,
  phase,
  counts,
}: Props) {
  return (
    <aside className={clsx("gf-legend", collapsed && "gf-legend-collapsed")}>
      <div className="gf-panel-head">
        <span>Grid layers</span>
        <button type="button" onClick={onToggleCollapse}>
          {collapsed ? "Expand" : "Collapse"}
        </button>
      </div>

      {!collapsed && (
        <>
          <div className="gf-legend-section">
            <div className="gf-section-title-row">
              <h3>Ward risk</h3>
              <span>{phase ?? "normal"}</span>
            </div>

            <LegendRow color="#22c55e" label="Normal" value={counts.normal} />
            <LegendRow color="#eab308" label="Medium stress" value={counts.medium} />
            <LegendRow color="#f97316" label="High stress" value={counts.high} />
            <LegendRow color="#ef4444" label="Critical stress" value={counts.critical} />
          </div>

          <div className="gf-divider" />

          <div className="gf-legend-section">
            <h3>Market state</h3>
            <LegendRow color="#facc15" label="Bid submitted" value={counts.bid} />
            <LegendRow color="#a855f7" label="Accepted by market" value={counts.accepted} />
            <LegendRow color="#22c55e" label="Recovered" value={counts.recovered} />
          </div>

          <div className="gf-hint-card">
            During the stress demo, wards should turn red as stress rises, then recover one by one as accepted flexibility stabilizes the grid.
          </div>
        </>
      )}
    </aside>
  );
}

function LegendRow({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: number;
}) {
  return (
    <div className="gf-legend-row">
      <span className="gf-dot" style={{ backgroundColor: color }} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
