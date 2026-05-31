"""Pydantic models for the GridFlex flex-market simulation pipeline."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class RiskLevel(str, Enum):
    normal = "normal"
    medium = "medium"
    high = "high"
    critical = "critical"


class EventType(str, Enum):
    normal = "normal"
    demand_spike = "demand_spike"
    outage_risk = "outage_risk"
    surplus = "surplus"


class RecommendedAction(str, Enum):
    none = "none"
    reduce_load = "reduce_load"
    shift_load = "shift_load"
    increase_load_or_charge_storage = "increase_load_or_charge_storage"


class BidType(str, Enum):
    demand_reduction = "demand_reduction"
    load_shift = "load_shift"
    storage_charge = "storage_charge"
    storage_discharge = "storage_discharge"
    flexible_load_increase = "flexible_load_increase"


class DispatchStatus(str, Enum):
    submitted = "submitted"
    accepted = "accepted"
    rejected = "rejected"
    simulated = "simulated"


class SystemFeatures(BaseModel):
    ontario_demand_mw: float
    market_demand_mw: float
    scheduled_operating_reserve_mw: float = 980.0
    forecast_market_demand_next_3h_mw: float | None = None
    temperature_c: float = 22.0
    humidity: float = 55.0
    hour: int
    is_weekend: int = 0
    demand_ramp_1h_mw: float = 0.0
    reserve_margin_ratio: float = 0.05


class WardFeatures(BaseModel):
    ward_id: str
    hour: int
    market_demand_mw: float
    ontario_demand_mw: float
    ward_load_proxy_mw: float
    ward_flexible_capacity_mw: float
    temperature_c: float = 22.0
    humidity: float = 55.0
    reserve_margin_ratio: float = 0.05
    demand_ramp_1h_mw: float = 0.0
    spike_multiplier: float = 1.0


class SystemPredictionResponse(BaseModel):
    stress_probability: float
    risk_level: str
    stress_score_before: int
    predicted_peak_window: str
    target_reduction_mw: int
    drivers: list[str]


class SystemPredictionDetail(BaseModel):
    event_type: EventType
    grid_stress_probability: float
    risk_level: RiskLevel
    target_reduction_mw: int
    predicted_start_time: str
    predicted_end_time: str
    predicted_duration_minutes: int
    drivers: list[str]


class WardPrediction(BaseModel):
    ward_id: str
    ward_name: str
    event_type: EventType
    event_probability: float
    risk_level: RiskLevel
    predicted_start_time: str
    predicted_end_time: str
    predicted_duration_minutes: int
    predicted_peak_hour: int
    baseline_load_mw: float
    forecast_load_mw: float
    expected_load_delta_mw: float
    ward_flexible_capacity_mw: float
    recommended_action: RecommendedAction
    recommended_bid_mw: float
    max_bid_mw: float
    confidence: float
    drivers: list[str]


class GridPredictRequest(BaseModel):
    ontario_demand_mw: float
    market_demand_mw: float
    scheduled_operating_reserve_mw: float = 980.0
    forecast_market_demand_next_3h_mw: float | None = None
    temperature_c: float = 22.0
    humidity: float = 55.0
    hour: int
    is_weekend: int = 0
    demand_ramp_1h_mw: float = 0.0
    reserve_margin_ratio: float = 0.05


class WardPredictRequest(BaseModel):
    timestamp: str
    forecast_horizon_hours: int = 6
    wards: list[WardFeatures]


class WardPredictResponse(BaseModel):
    prediction_id: str
    created_at: str
    forecast_generated_for: str
    forecast_horizon_minutes: int
    model_version: str = "gridflex-ward-risk-v0.1"
    data_mode: str = "historical_replay"
    system_prediction: SystemPredictionDetail
    ward_predictions: list[WardPrediction]


class MarketContext(BaseModel):
    event_id: str
    system_risk_level: RiskLevel
    target_reduction_mw: int
    clearing_mode: str = "simulated"
    stress_score_before: int = 0


class Bid(BaseModel):
    bid_id: str
    agent_id: str
    ward_id: str
    bid_type: BidType
    quantity_mw: float
    min_quantity_mw: float = 0.0
    max_quantity_mw: float
    price_per_mwh: float
    available_start_time: str
    available_end_time: str
    duration_minutes: int
    activation_minutes: int
    confidence: float
    comfort_impact: str
    status: DispatchStatus = DispatchStatus.submitted
    reason: str = ""


class WardAgentDecision(BaseModel):
    agent_id: str
    ward_id: str
    decision: str
    bid: Bid | None = None


class WardBidsRequest(BaseModel):
    timestamp: str
    market_context: MarketContext
    ward_predictions: list[WardPrediction]


class WardBidsResponse(BaseModel):
    event_id: str
    bids: list[Bid]


class ClearingResult(BaseModel):
    target_reduction_mw: int
    accepted_reduction_mw: float
    unfilled_reduction_mw: float
    stress_score_before: int
    stress_score_after: int
    clearing_status: str
    clearing_price_per_mwh: float = 0.0


class MarketClearRequest(BaseModel):
    event_id: str
    timestamp: str
    market_context: MarketContext
    bids: list[Bid]


class MarketClearResponse(BaseModel):
    event_id: str
    clearing_result: ClearingResult
    accepted_bids: list[Bid]
    rejected_bids: list[Bid]


class SimulationRunRequest(BaseModel):
    timestamp: str | None = None
    forecast_horizon_hours: int = 6
    system_features: SystemFeatures | None = None
    ward_features: list[WardFeatures] | None = None


class KeplerNode(BaseModel):
    ward_id: str
    ward_name: str
    timestamp: str
    lat: float
    lng: float
    event_type: str
    event_probability: float
    risk_level: str
    stress_score: int
    predicted_duration_minutes: int
    recommended_action: str
    recommended_bid_mw: float
    accepted_bid_mw: float = 0.0
    dispatch_status: str
    ward_load_proxy_mw: float
    ward_flexible_capacity_mw: float


class KeplerFlow(BaseModel):
    flow_id: str
    timestamp: str
    source_ward_id: str
    target_id: str = "grid_center"
    source_lat: float
    source_lng: float
    target_lat: float = 43.6532
    target_lng: float = -79.3832
    flow_mw: float
    risk_level: str
    dispatch_status: str


class OperatorAlert(BaseModel):
    title: str
    severity: str
    summary: str
    market_action: str
    impact: str
    operator_note: str


class ReporterOutput(BaseModel):
    agent_id: str = "agent_reporter"
    alert: OperatorAlert


class SimulationRunResponse(BaseModel):
    simulation_id: str
    timestamp: str
    grid_prediction: SystemPredictionDetail
    ward_predictions: list[WardPrediction]
    ward_agent_decisions: list[WardAgentDecision]
    submitted_bids: list[Bid]
    market_result: MarketClearResponse
    reporter: ReporterOutput | None = None
    kepler_nodes: list[KeplerNode] = Field(default_factory=list)
    kepler_flows: list[KeplerFlow] = Field(default_factory=list)
    snapshot: dict[str, Any] = Field(default_factory=dict)


class SimulationTickMessage(BaseModel):
    type: str = "simulation_tick"
    timestamp: str
    snapshot: dict[str, Any] = Field(default_factory=dict)
    grid_prediction: SystemPredictionDetail
    ward_predictions: list[WardPrediction]
    ward_agent_decisions: list[WardAgentDecision]
    submitted_bids: list[Bid]
    market_result: MarketClearResponse
    reporter: ReporterOutput | None = None
    kepler_nodes: list[KeplerNode] = Field(default_factory=list)
    kepler_flows: list[KeplerFlow] = Field(default_factory=list)


class GridMockSnapshot(BaseModel):
    type: str = "grid_snapshot"
    timestamp: str
    source: str = "historical_ieso"
    province: str = "Ontario"
    system: SystemFeatures
    predict_request: GridPredictRequest
    prediction_preview: SystemPredictionResponse
    nodes: list[WardFeatures]
    flows: list[KeplerFlow] = Field(default_factory=list)
