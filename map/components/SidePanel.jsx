'use client';

import { useMemo } from 'react';
import { SCORES } from '@/lib/heatmapConfig';
import { REGION_SUMMARY } from '@/lib/sampleData';

function summarize(field) {
  const values = REGION_SUMMARY.map((r) => r[field]);
  const sum = values.reduce((a, b) => a + b, 0);
  const mean = sum / values.length;
  const max = Math.max(...values);
  const min = Math.min(...values);
  return { mean, max, min };
}

function topByField(field, n = 5) {
  return [...REGION_SUMMARY]
    .sort((a, b) => b[field] - a[field])
    .slice(0, n);
}

export default function SidePanel({
  activeChannels,
  primary,
  onToggle,
  onSetPrimary
}) {
  const active = SCORES.find((s) => s.id === primary) || SCORES[0];
  const activeList = SCORES.filter((s) => activeChannels.has(s.id));
  const activeKey = activeList.map((s) => s.id).join('|');

  // Stats and Top-5 are recomputed for every active channel, not just primary.
  const statsByChannel = useMemo(() => {
    const out = {};
    activeList.forEach((s) => (out[s.id] = summarize(s.id)));
    return out;
  }, [activeKey]);
  const topRegions = useMemo(() => topByField(primary, 5), [primary]);
  const activeCount = activeChannels.size;

  return (
    <aside
      className="side-panel"
      style={{ '--accent': active.accent, '--accent-soft': active.soft }}
    >
      <div className="panel-section panel-channel">
        <div className="section-head">
          <span className="section-rule" />
          <span className="section-title">CHANNELS // STACK</span>
          <span className="section-id">
            {activeCount}/3 ON
          </span>
        </div>

        <div className="channel-hint">
          <span>click — toggle channel</span>
          <span>shift+click — set primary</span>
        </div>

        <div className="channel-buttons" role="group">
          {SCORES.map((s, i) => {
            const isOn = activeChannels.has(s.id);
            const isPrimary = s.id === primary;
            return (
              <button
                key={s.id}
                aria-pressed={isOn}
                onClick={(e) => {
                  if (e.shiftKey) {
                    if (isOn) onSetPrimary(s.id);
                    return;
                  }
                  onToggle(s.id);
                }}
                className={`channel-btn ${isOn ? 'is-active' : ''} ${
                  isPrimary ? 'is-primary' : ''
                }`}
                style={{
                  '--btn-accent': s.accent,
                  '--btn-soft': s.soft
                }}
              >
                <span className="btn-index">0{i + 1}</span>
                <span className="btn-body">
                  <span className="btn-label">
                    {s.label}
                    {isPrimary && (
                      <span className="btn-primary-tag">PRIMARY</span>
                    )}
                  </span>
                  <span className="btn-sub">{s.sublabel}</span>
                </span>
                <span className="btn-led" aria-hidden />
              </button>
            );
          })}
        </div>
      </div>

      <div className="panel-section">
        <div className="section-head">
          <span className="section-rule" />
          <span className="section-title">DISTRIBUTION</span>
          <span className="section-id">N={REGION_SUMMARY.length}</span>
        </div>

        <div className="metric-list">
          {activeList.map((s) => {
            const st = statsByChannel[s.id];
            return (
              <div
                key={s.id}
                className={`metric-row ${
                  s.id === primary ? 'is-primary' : ''
                }`}
                style={{ '--row-accent': s.accent }}
              >
                <span className="metric-row-label">{s.label}</span>
                <span className="metric-mini">
                  <span className="metric-mini-key">μ</span>
                  <span className="metric-mini-val">
                    {st.mean.toFixed(1)}
                  </span>
                </span>
                <span className="metric-mini">
                  <span className="metric-mini-key">↑</span>
                  <span className="metric-mini-val">{st.max}</span>
                </span>
                <span className="metric-mini">
                  <span className="metric-mini-key">↓</span>
                  <span className="metric-mini-val">{st.min}</span>
                </span>
              </div>
            );
          })}
        </div>

        <div className="histogram histogram--multi" aria-hidden>
          {REGION_SUMMARY.map((r, i) => (
            <span key={i} className="bar-group">
              {activeList.map((s) => (
                <span
                  key={s.id}
                  className="bar"
                  style={{
                    height: `${r[s.id]}%`,
                    background: s.accent,
                    opacity: s.id === primary ? 1 : 0.55
                  }}
                />
              ))}
            </span>
          ))}
        </div>
      </div>

      <div className="panel-section">
        <div className="section-head">
          <span className="section-rule" />
          <span className="section-title">TOP 5 / HOTSPOT</span>
          <span className="section-id">BY {primary.toUpperCase()}</span>
        </div>

        <ol className="rank-list">
          {topRegions.map((r, i) => (
            <li key={r.label} className="rank-row rank-row--multi">
              <span className="rank-index">
                {String(i + 1).padStart(2, '0')}
              </span>
              <span className="rank-label">{r.label}</span>
              <span className="rank-bars-stack" aria-hidden>
                {activeList.map((s) => (
                  <span
                    key={s.id}
                    className={`rank-bar-track ${
                      s.id === primary ? 'is-primary' : ''
                    }`}
                  >
                    <span
                      className="rank-bar-fill"
                      style={{
                        width: `${r[s.id]}%`,
                        background: s.accent
                      }}
                    />
                    <span
                      className="rank-bar-tag"
                      style={{ color: s.accent }}
                    >
                      {s.label[0]}
                      {r[s.id]}
                    </span>
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ol>
      </div>

      <div className="panel-footer">
        <span className="footer-line" />
        <span className="footer-text">
          KEPLER.GL <em>v3</em> · HEATMAP LAYER · WEIGHT={active.id}
        </span>
      </div>
    </aside>
  );
}
