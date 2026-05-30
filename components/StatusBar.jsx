'use client';

import { SCORES } from '@/lib/heatmapConfig';

export default function StatusBar({ activeChannels, primary, snapshot }) {
  const active = SCORES.find((s) => s.id === primary) || SCORES[0];
  const onList = SCORES.filter((s) => activeChannels.has(s.id));
  const tick = snapshot?.tick || 0;
  const alerts = snapshot?.alerts || [];
  const surgeCount = alerts.filter((a) => a.type === 'SURGE').length;
  const blackoutCount = alerts.filter((a) => a.type === 'BLACKOUT').length;
  const lastUpdate = snapshot?.lastUpdate;
  const lastStamp = lastUpdate
    ? new Date(lastUpdate).toISOString().slice(11, 19)
    : '—';

  return (
    <footer className="statusbar" style={{ '--accent': active.accent }}>
      <div className="status-cluster">
        <span className="status-dot status-dot--live" />
        <span className="status-label">GRID-LIVE · STREAMING</span>
      </div>
      <div className="status-cluster">
        <span className="status-key">TICK</span>
        <span className="status-val mono">
          {String(tick).padStart(5, '0')}
        </span>
      </div>
      <div className="status-cluster">
        <span className="status-key">LAST Δ</span>
        <span className="status-val mono">{lastStamp}Z</span>
      </div>
      <div className="status-cluster">
        <span className="status-key">STACK</span>
        <span className="status-val mono">
          {onList.map((s) => (
            <span
              key={s.id}
              className="chan-chip"
              style={{ '--chip': s.accent }}
            >
              {s.label}
            </span>
          ))}
        </span>
      </div>
      <div className="status-cluster">
        <span className="status-key">PRIMARY</span>
        <span className="status-val mono">{active.id}</span>
      </div>
      <div className="status-cluster">
        <span className="status-key">EVENTS</span>
        <span className="status-val mono">
          <span className="evt-pill evt-surge">SRG·{surgeCount}</span>
          <span className="evt-pill evt-blackout">BLK·{blackoutCount}</span>
        </span>
      </div>
      <div className="status-cluster status-cluster--right">
        <span className="status-key">PROJ</span>
        <span className="status-val mono">EPSG:3857</span>
        <span className="status-key">VIEW</span>
        <span className="status-val mono">43.651,&nbsp;-79.385</span>
      </div>
    </footer>
  );
}
