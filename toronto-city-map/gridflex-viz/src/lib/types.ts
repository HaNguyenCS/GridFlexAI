export type ZoneStatus = "ok" | "over_capacity" | "warning" | "issue";

export interface ZoneMetrics {
  zone_id: string;
  ward_name?: string;
  demand?: number;
  baseline_demand?: number;
  supply?: number;
  owned_capacity?: number;
  effective_capacity?: number;
  capacity_imported?: number;
  capacity_exported?: number;
  unmet_demand?: number;
  over_capacity?: number;
  over_capacity_sec?: number;
  spike_active?: boolean;
  spike_multiplier?: number;
  status?: ZoneStatus;
}

export interface Trade {
  from_zone_id: string;
  to_zone_id: string;
  mw: number;
  price_per_mw: number;
  cost: number;
}

export interface ActiveSpike {
  scope: string;
  zone_id?: string;
  multiplier: number;
  ticks_remaining: number;
  spike_type: string;
}

export interface Issue {
  zone_id: string;
  status: ZoneStatus;
  demand: number;
  capacity: number;
  over_capacity: number;
  over_capacity_sec: number;
  message: string;
}

export interface SupplySummary {
  agent?: string;
  agent_note?: string;
  total_unmet_mw?: number;
  total_cost?: number;
  budget_remaining?: number;
  fully_served?: boolean;
}

export interface StreamConnection {
  demand: "connecting" | "live" | "error";
  supply: "connecting" | "live" | "error";
  trades: "connecting" | "live" | "error";
  issues: "connecting" | "live" | "error";
}
