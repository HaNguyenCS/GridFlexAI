import type { ZoneMetrics, ZoneTimePoint } from "./types";

export const MAX_HISTORY_POINTS = 180;

export type ZoneHistory = Map<string, ZoneTimePoint[]>;

export function appendDemandHistory(
  prev: ZoneHistory,
  ts: string,
  readings: ZoneMetrics[],
  simTime?: string
): ZoneHistory {
  const next = new Map(prev);

  for (const reading of readings) {
    const points = [...(next.get(reading.zone_id) ?? [])];
    const last = points[points.length - 1];

    if (last?.ts === ts) {
      points[points.length - 1] = {
        ...last,
        sim_time: simTime ?? last.sim_time,
        demand: reading.demand,
        baseline_demand: reading.baseline_demand,
        owned_capacity: reading.owned_capacity,
        effective_capacity: reading.effective_capacity,
      };
    } else {
      points.push({
        ts,
        sim_time: simTime,
        demand: reading.demand,
        baseline_demand: reading.baseline_demand,
        owned_capacity: reading.owned_capacity,
        effective_capacity: reading.effective_capacity,
      });
    }

    if (points.length > MAX_HISTORY_POINTS) {
      points.splice(0, points.length - MAX_HISTORY_POINTS);
    }
    next.set(reading.zone_id, points);
  }

  return next;
}

export function appendSupplyHistory(
  prev: ZoneHistory,
  ts: string,
  readings: ZoneMetrics[],
  simTime?: string
): ZoneHistory {
  const next = new Map(prev);

  for (const reading of readings) {
    const points = [...(next.get(reading.zone_id) ?? [])];
    const last = points[points.length - 1];

    if (last?.ts === ts) {
      points[points.length - 1] = {
        ...last,
        sim_time: simTime ?? last.sim_time,
        supply: reading.supply,
        effective_capacity:
          reading.effective_capacity ?? last.effective_capacity,
      };
    } else if (last) {
      points[points.length - 1] = {
        ...last,
        sim_time: simTime ?? last.sim_time,
        supply: reading.supply,
      };
    } else {
      points.push({
        ts,
        sim_time: simTime,
        supply: reading.supply,
        effective_capacity: reading.effective_capacity,
        owned_capacity: reading.owned_capacity,
      });
    }

    if (points.length > MAX_HISTORY_POINTS) {
      points.splice(0, points.length - MAX_HISTORY_POINTS);
    }
    next.set(reading.zone_id, points);
  }

  return next;
}
