'use client';

import { useEffect, useState } from 'react';

function pad(n) {
  return n.toString().padStart(2, '0');
}

export default function Header() {
  const [now, setNow] = useState(null);

  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const stamp = now
    ? `${now.getUTCFullYear()}.${pad(now.getUTCMonth() + 1)}.${pad(
        now.getUTCDate()
      )} · ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(
        now.getUTCSeconds()
      )} UTC`
    : '— — —';

  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="brand-mark">
          <span className="mark-dot" />
          <span className="mark-dot mark-dot--mid" />
          <span className="mark-dot" />
        </div>
        <div className="brand-text">
          <span className="brand-title">GRID·OPS</span>
          <span className="brand-sub">POWER TELEMETRY / KEPLER.GL</span>
        </div>
      </div>

      <div className="topbar-center">
        <span className="kicker">DOWNTOWN TORONTO · LIVE GRID TELEMETRY</span>
        <span className="headline">
          <em>Where</em> load meets surge meets blackout.
        </span>
      </div>

      <div className="topbar-right">
        <div className="stat-block">
          <span className="stat-label">FEED</span>
          <span className="stat-value">
            <span className="feed-pulse" /> STREAMING
          </span>
        </div>
        <div className="stat-block">
          <span className="stat-label">CLOCK</span>
          <span className="stat-value mono">{stamp}</span>
        </div>
      </div>
    </header>
  );
}
