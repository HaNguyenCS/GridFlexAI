import { IssuePanel } from "./components/IssuePanel";
import { SidePanel } from "./components/SidePanel";
import { TradePanel } from "./components/TradePanel";
import { WardMap } from "./components/WardMap";
import { STATUS_COLORS } from "./lib/format";
import { useGridStreams } from "./lib/useGridStreams";

export default function App() {
  const {
    apiBase,
    zones,
    trades,
    issues,
    spikes,
    summary,
    lastTs,
    connection,
    selectedZone,
    setSelectedZone,
  } = useGridStreams();

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">GridFlex Live</h1>
          <p className="text-xs text-slate-400">
            Toronto ward grid · {summary.agent ?? "supply agent"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          {(["demand", "supply", "trades", "issues"] as const).map((key) => (
            <span key={key} className={`stream-pill stream-${connection[key]}`}>
              {key}: {connection[key]}
            </span>
          ))}
        </div>
      </header>

      <main className="layout">
        <div className="map-panel">
          <WardMap
            geojsonUrl={`${apiBase}/zones/geojson`}
            zones={zones}
            selectedZone={selectedZone}
            onSelectZone={setSelectedZone}
          />
          <div className="legend">
            {Object.entries(STATUS_COLORS).map(([status, color]) => (
              <span key={status} className="legend-item">
                <i style={{ background: color }} />
                {status.replace("_", " ")}
              </span>
            ))}
          </div>
        </div>

        <aside className="sidebar">
          <SidePanel
            zones={zones}
            summary={summary}
            spikes={spikes}
            lastTs={lastTs}
            selectedZone={selectedZone}
          />
          <TradePanel trades={trades} />
          <IssuePanel issues={issues} connection={connection} />
        </aside>
      </main>
    </div>
  );
}
