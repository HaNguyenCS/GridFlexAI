'use client';

import dynamic from 'next/dynamic';

// Kepler.gl uses window/WebGL APIs — must load only on the client.
const MapClient = dynamic(() => import('@/components/MapClient'), {
  ssr: false,
  loading: () => (
    <div className="map-loader">
      <div className="loader-frame">
        <span className="loader-tag">[ INITIALIZING ]</span>
        <span className="loader-title">FOOD&#x2009;·&#x2009;MAP</span>
        <span className="loader-meta">
          calibrating regional kernel · streaming geo-tiles
        </span>
        <div className="loader-bar">
          <span />
        </div>
      </div>
    </div>
  )
});

export default function MapView() {
  return <MapClient />;
}
