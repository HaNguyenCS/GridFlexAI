import type { Issue, StreamConnection } from "../lib/types";
import { formatMw } from "../lib/format";

interface Props {
  issues: Issue[];
  connection: StreamConnection;
}

export function IssuePanel({ issues, connection }: Props) {
  const warnings = issues.filter((i) => i.status === "warning");
  const critical = issues.filter((i) => i.status === "issue");

  return (
    <section className="panel flex flex-col gap-3">
      <header className="flex items-center justify-between">
        <h2 className="panel-title">Issues</h2>
        <span className="badge">{connection.issues}</span>
      </header>

      <div className="grid grid-cols-2 gap-2 text-center">
        <div className="stat-box border-amber-500/30 bg-amber-500/10">
          <div className="stat-value text-amber-300">{warnings.length}</div>
          <div className="stat-label">Warnings</div>
        </div>
        <div className="stat-box border-red-500/30 bg-red-500/10">
          <div className="stat-value text-red-300">{critical.length}</div>
          <div className="stat-label">Critical</div>
        </div>
      </div>

      <ul className="max-h-48 space-y-2 overflow-y-auto text-sm">
        {issues.length === 0 && (
          <li className="text-slate-500">All wards within capacity.</li>
        )}
        {issues.map((issue) => (
          <li
            key={issue.zone_id}
            className={`rounded-lg border px-3 py-2 ${
              issue.status === "issue"
                ? "border-red-500/40 bg-red-500/10"
                : "border-amber-500/40 bg-amber-500/10"
            }`}
          >
            <div className="font-medium">{issue.zone_id}</div>
            <div className="text-xs text-slate-400">
              {formatMw(issue.over_capacity)} over · {issue.over_capacity_sec}s
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
