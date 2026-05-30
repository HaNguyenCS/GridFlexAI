'use client';

import Header from '@/components/Header';
import MapView from '@/components/MapView';

export default function Page() {
  return (
    <main className="shell">
      <div className="grain" aria-hidden />
      <div className="vignette" aria-hidden />
      <Header />
      <MapView />
      <div className="corner-tag corner-tag--tl">
        <span>SECTOR / TOR-DT</span>
        <span className="corner-id">DOWNTOWN-TORONTO / 43.651°N</span>
      </div>
      <div className="corner-tag corner-tag--tr">
        <span>BUILD</span>
        <span className="corner-id">2026.05.30 / R3</span>
      </div>
      <div className="corner-tag corner-tag--br">
        <span>// END FRAME</span>
      </div>
    </main>
  );
}
