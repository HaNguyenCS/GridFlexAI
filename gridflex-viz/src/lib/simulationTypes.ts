export interface KeplerFlow {
  flow_id: string;
  timestamp: string;
  source_ward_id: string;
  target_id: string;
  source_lat: number;
  source_lng: number;
  target_lat: number;
  target_lng: number;
  flow_mw: number;
  risk_level: string;
  dispatch_status: string;
}

export interface KeplerNode {
  ward_id: string;
  ward_name: string;
  timestamp: string;
  lat: number;
  lng: number;
  event_type: string;
  event_probability: number;
  risk_level: string;
  stress_score: number;
  predicted_duration_minutes: number;
  recommended_action: string;
  recommended_bid_mw: number;
  accepted_bid_mw: number;
  dispatch_status: string;
}

export interface SimulationBid {
  bid_id: string;
  ward_id: string;
  bid_type: string;
  quantity_mw: number;
  price_per_mwh: number;
  status: string;
}

export interface ClearingResult {
  target_reduction_mw: number;
  accepted_reduction_mw: number;
  unfilled_reduction_mw: number;
  stress_score_before: number;
  stress_score_after: number;
  clearing_status: string;
  clearing_price_per_mwh: number;
}

export interface OperatorAlert {
  title: string;
  severity: string;
  summary: string;
  market_action: string;
  impact: string;
  operator_note: string;
}

export interface SimulationTick {
  type: string;
  timestamp: string;
  grid_prediction: {
    event_type: string;
    risk_level: string;
    target_reduction_mw: number;
    grid_stress_probability: number;
    predicted_duration_minutes: number;
    drivers: string[];
  };
  ward_predictions: Array<{
    ward_id: string;
    ward_name: string;
    risk_level: string;
    predicted_duration_minutes: number;
    recommended_action: string;
    recommended_bid_mw: number;
  }>;
  submitted_bids: SimulationBid[];
  market_result: {
    clearing_result: ClearingResult;
    accepted_bids: SimulationBid[];
  };
  reporter?: {
    alert: OperatorAlert;
  };
  kepler_nodes: KeplerNode[];
  kepler_flows: KeplerFlow[];
  snapshot?: Record<string, unknown>;
}

export type SimulationConnection = "connecting" | "live" | "error";
