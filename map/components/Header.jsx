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
          <span className="brand-title">FOOD·MAP</span>
          <span className="brand-sub">REGIONAL OPS / KEPLER.GL</span>
        </div>
      </div>

      <div className="topbar-center">
        <span className="kicker">DOWNTOWN TORONTO · 3-CHANNEL HEAT INDEX</span>
        <span className="headline">
          <em>Where</em> risk meets price meets traffic.
        </span>
      </div>

      <div className="topbar-right">
        <div className="stat-block">
          <span className="stat-label">SESSION</span>
          <span className="stat-value">LIVE</span>
        </div>
        <div className="stat-block">
          <span className="stat-label">CLOCK</span>
          <span className="stat-value mono">{stamp}</span>
        </div>
      </div>
    </header>
  );
}
