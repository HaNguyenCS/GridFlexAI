'use client';

import { SCORES } from '@/lib/heatmapConfig';

export default function StatusBar({ activeChannels, primary }) {
  const active = SCORES.find((s) => s.id === primary) || SCORES[0];
  const onList = SCORES.filter((s) => activeChannels.has(s.id));
  return (
    <footer className="statusbar" style={{ '--accent': active.accent }}>
      <div className="status-cluster">
        <span className="status-dot" />
        <span className="status-label">DECK.GL · WEBGL2</span>
      </div>
      <div className="status-cluster">
        <span className="status-key">LAYER</span>
        <span className="status-val">heatmap + hex3D</span>
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
        <span className="status-key">RAMP</span>
        <span className="ramp-strip">
          {active.ramp.colors.map((c, i) => (
            <span key={i} style={{ background: c }} />
          ))}
        </span>
        <span className="status-val mono">{active.ramp.colors.length}-stop</span>
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
