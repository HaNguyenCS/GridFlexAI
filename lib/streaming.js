// GridSimulator: synthesizes a realtime-streaming power-grid telemetry feed.
//
// Each tick (~1.8s) every substation undergoes:
//   - load   : random walk in a normal operating envelope (18-95 % capacity)
//   - surge  : decays toward 0; spikes on probabilistic surge events
//   - outage : decays toward 0; spikes on probabilistic blackout events
//
// Events also push entries into the alert log which is consumed by the side
// panel as a live feed. Keeps internal mutable state to model decay/recovery.

import { STATIONS_BASE } from './sampleData';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Pre-jittered sample sub-points per station so each station fills a small
// hex cluster rather than aggregating to one cell. Generated once.
function makeSamples(seedIndex) {
  const samples = [];
  const n = 4;
  for (let i = 0; i < n; i++) {
    // Deterministic-ish jitter so the visual footprint is stable per-station,
    // but values still feel naturally scattered across the cluster.
    const a = ((seedIndex * 13 + i * 7) % 31) / 31 - 0.5;
    const b = ((seedIndex * 19 + i * 11) % 29) / 29 - 0.5;
    samples.push({ dLat: a * 0.0040, dLng: b * 0.0055 });
  }
  return samples;
}

export class GridSimulator {
  constructor() {
    this.tick = 0;
    this.lastUpdate = Date.now();
    this.alertSeq = 0;
    this.alerts = [];
    this.stations = STATIONS_BASE.map((s, i) => ({
      ...s,
      load: Math.round(32 + Math.random() * 38),
      surge: Math.round(Math.random() * 6),
      outage: Math.round(Math.random() * 3),
      samples: makeSamples(i)
    }));
  }

  pushAlert(type, station, magnitude) {
    this.alertSeq += 1;
    const ts = new Date();
    this.alerts.push({
      id: this.alertSeq,
      type,
      magnitude: Math.round(magnitude),
      code: station.code,
      node: station.node,
      tick: this.tick,
      time: ts.toISOString().slice(11, 19),
      epoch: ts.getTime()
    });
    if (this.alerts.length > 24) this.alerts.shift();
  }

  step() {
    this.tick += 1;
    this.lastUpdate = Date.now();

    // 1) Random walk on every station
    for (const s of this.stations) {
      s.load = clamp(
        Math.round(s.load + (Math.random() - 0.48) * 7),
        14,
        96
      );
      // Surge / outage decay toward baseline so events visibly fade out.
      s.surge = clamp(
        Math.round(s.surge * 0.78 + (Math.random() - 0.5) * 4),
        0,
        100
      );
      s.outage = clamp(
        Math.round(s.outage * 0.86 + (Math.random() - 0.5) * 3),
        0,
        100
      );
    }

    // 2) Probabilistic SURGE event — voltage spike at a random feeder
    if (Math.random() < 0.32) {
      const s = this.pickStation();
      const intensity = 38 + Math.random() * 50;
      s.surge = clamp(Math.round(s.surge + intensity), 0, 100);
      s.load = clamp(Math.round(s.load + intensity * 0.5), 0, 100);
      this.pushAlert('SURGE', s, intensity);
    }

    // 3) Probabilistic BLACKOUT event — outage cascade at a random feeder
    if (Math.random() < 0.16) {
      const s = this.pickStation();
      const intensity = 50 + Math.random() * 45;
      s.outage = clamp(Math.round(s.outage + intensity), 0, 100);
      s.load = clamp(Math.round(s.load - intensity * 0.6), 0, 100);
      this.pushAlert('BLACKOUT', s, intensity);

      // Mild propagation to nearest neighbor (great-circle approx)
      const neighbor = this.nearest(s);
      if (neighbor) {
        neighbor.outage = clamp(
          Math.round(neighbor.outage + intensity * 0.35),
          0,
          100
        );
      }
    }

    return this.snapshot();
  }

  pickStation() {
    return this.stations[Math.floor(Math.random() * this.stations.length)];
  }

  nearest(target) {
    let best = null;
    let bestD = Infinity;
    for (const s of this.stations) {
      if (s === target) continue;
      const dy = s.lat - target.lat;
      const dx = s.lng - target.lng;
      const d = dy * dy + dx * dx;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  // Build the row array that kepler.gl consumes. Each station emits its 4
  // sample sub-points all sharing the station's current channel values.
  buildRows() {
    const rows = [];
    for (const s of this.stations) {
      for (const samp of s.samples) {
        rows.push({
          code: s.code,
          node: s.node,
          lat: +(s.lat + samp.dLat).toFixed(6),
          lng: +(s.lng + samp.dLng).toFixed(6),
          load: s.load,
          surge: s.surge,
          outage: s.outage
        });
      }
    }
    return rows;
  }

  snapshot() {
    return {
      tick: this.tick,
      lastUpdate: this.lastUpdate,
      stations: this.stations.map((s) => ({
        code: s.code,
        node: s.node,
        lat: s.lat,
        lng: s.lng,
        load: s.load,
        surge: s.surge,
        outage: s.outage
      })),
      // Most-recent alerts first so the panel naturally renders newest-on-top.
      alerts: [...this.alerts].reverse().slice(0, 8)
    };
  }
}

export const STREAM_INTERVAL_MS = 1800;
