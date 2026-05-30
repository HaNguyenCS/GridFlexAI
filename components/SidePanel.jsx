'use client';

import { useMemo } from 'react';
import { SCORES } from '@/lib/heatmapConfig';

// All stats are derived from the live streaming snapshot — never from
// static data. `stations` is an array of { code, node, load, surge, outage }.

function summarize(stations, field) {
  if (!stations || stations.length === 0) {
    return { mean: 0, max: 0, min: 0 };
  }
  const values = stations.map((s) => s[field]);
  const sum = values.reduce((a, b) => a + b, 0);
  const mean = sum / values.length;
  const max = Math.max(...values);
  const min = Math.min(...values);
  return { mean, max, min };
}

function topByField(stations, field, n = 5) {
  return [...stations].sort((a, b) => b[field] - a[field]).slice(0, n);
}

function timeAgo(epoch, now) {
  const diff = Math.max(0, Math.floor((now - epoch) / 1000));
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  return `${Math.floor(diff / 3600)}h`;
}

export default function SidePanel({
  activeChannels,
  primary,
  onToggle,
  onSetPrimary,
  snapshot
}) {
  const active = SCORES.find((s) => s.id === primary) || SCORES[0];
  const activeList = SCORES.filter((s) => activeChannels.has(s.id));
  const activeKey = activeList.map((s) => s.id).join('|');
  const stations = snapshot?.stations || [];
  const alerts = snapshot?.alerts || [];
  const tick = snapshot?.tick || 0;
  const lastUpdate = snapshot?.lastUpdate || 0;
  const nowEpoch = lastUpdate || Date.now();

  // Stats and Top-5 are recomputed for every active channel, not just primary.
  const statsByChannel = useMemo(() => {
    const out = {};
    activeList.forEach((s) => (out[s.id] = summarize(stations, s.id)));
    return out;
  }, [activeKey, stations]);

  const topStations = useMemo(
    () => topByField(stations, primary, 5),
    [primary, stations]
  );
  const activeCount = activeChannels.size;

  // Densified histogram across all stations (one bar group per station).
  const distribution = stations;

  return (
    <aside
      className="side-panel"
      style={{ '--accent': active.accent, '--accent-soft': active.soft }}
    >
      <div className="panel-section panel-channel">
        <div className="section-head">
          <span className="section-rule" />
          <span className="section-title">CHANNELS // STACK</span>
          <span className="section-id">{activeCount}/3 ON</span>
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

      {/* ========== LIVE STREAM + ALERT FEED ========== */}
      <div className="panel-section panel-stream">
        <div className="section-head">
          <span className="section-rule" />
          <span className="section-title">STREAM // GRID-LIVE</span>
          <span className="section-id">
            <span className="live-pulse" /> LIVE
          </span>
        </div>

        <div className="stream-meter">
          <div className="stream-stat">
            <span className="stream-key">TICK</span>
            <span className="stream-val mono">
              {String(tick).padStart(5, '0')}
            </span>
          </div>
          <div className="stream-stat">
            <span className="stream-key">FEED</span>
            <span className="stream-val mono">
              ws://grid-live · {stations.length} nodes
            </span>
          </div>
          <div className="stream-stat">
            <span className="stream-key">RATE</span>
            <span className="stream-val mono">1.8s / Δ</span>
          </div>
        </div>

        <div className="alert-feed">
          {alerts.length === 0 ? (
            <div className="alert-empty">— grid stable — awaiting events</div>
          ) : (
            alerts.map((a) => (
              <div
                key={a.id}
                className={`alert-row alert-${a.type.toLowerCase()}`}
              >
                <span className="alert-bullet" aria-hidden />
                <span className="alert-type">{a.type}</span>
                <span className="alert-code mono">{a.code}</span>
                <span className="alert-node">{a.node}</span>
                <span className="alert-mag mono">Δ{a.magnitude}</span>
                <span className="alert-age mono">
                  −{timeAgo(a.epoch, nowEpoch)}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="panel-section">
        <div className="section-head">
          <span className="section-rule" />
          <span className="section-title">DISTRIBUTION</span>
          <span className="section-id">N={stations.length}</span>
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

        <div className="scatter scatter--multi" aria-hidden>
          <span className="scatter-grid" />
          <span className="scatter-axis scatter-axis--100">100</span>
          <span className="scatter-axis scatter-axis--50">50</span>
          <span className="scatter-axis scatter-axis--0">0</span>
          {distribution.map((r, i) => (
            <span
              key={i}
              className="scatter-col"
              style={{
                left: `${
                  (i / Math.max(distribution.length - 1, 1)) * 100
                }%`
              }}
            >
              {activeList.map((s) => (
                <span
                  key={s.id}
                  className={`scatter-dot ${
                    s.id === primary ? 'is-primary' : ''
                  }`}
                  style={{
                    bottom: `${r[s.id]}%`,
                    background: s.accent,
                    boxShadow: `0 0 6px ${s.accent}, 0 0 12px ${s.soft}`
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
          {topStations.map((r, i) => (
            <li key={r.code} className="rank-row rank-row--multi">
              <span className="rank-index">
                {String(i + 1).padStart(2, '0')}
              </span>
              <span className="rank-label">
                <span className="rank-code mono">{r.code}</span>
                <span className="rank-node">{r.node}</span>
              </span>
              <span className="rank-dots-stack" aria-hidden>
                {activeList.map((s) => (
                  <span
                    key={s.id}
                    className={`rank-dot-track ${
                      s.id === primary ? 'is-primary' : ''
                    }`}
                  >
                    <span className="rank-dot-rule" />
                    <span
                      className="rank-dot"
                      style={{
                        left: `${r[s.id]}%`,
                        background: s.accent,
                        boxShadow: `0 0 6px ${s.accent}, 0 0 14px ${s.soft}`
                      }}
                    />
                    <span
                      className="rank-dot-tag"
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
          KEPLER.GL <em>v3</em> · STREAMING · CHANNEL={active.id}
        </span>
      </div>
    </aside>
  );
}
