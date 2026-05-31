"""Grid Forecast Agent — system stress + ward-level predictions."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from backend.schemas.simulation import (
    EventType,
    GridPredictRequest,
    RecommendedAction,
    RiskLevel,
    SystemFeatures,
    SystemPredictionDetail,
    SystemPredictionResponse,
    WardFeatures,
    WardPredictRequest,
    WardPredictResponse,
    WardPrediction,
)
from backend.simulation.system_predictor import predict_grid_stress
from backend.simulation.ward_spike_lookup import ward_spike_lookup


def _normalize_timestamp(ts: str) -> str:
    return ts.replace("T", " ").split("+")[0].split("Z")[0].strip()


def _risk_from_string(value: str) -> RiskLevel:
    try:
        return RiskLevel(value)
    except ValueError:
        return RiskLevel.normal


def _system_event_type(stress_score: int, ramp: float) -> EventType:
    if stress_score >= 80:
        return EventType.demand_spike
    if stress_score >= 60 and ramp > 500:
        return EventType.outage_risk
    if stress_score <= 15 and ramp < -200:
        return EventType.surplus
    return EventType.normal


def _boost_system_for_spikes(
    system: SystemPredictionDetail,
    ward_features: list[WardFeatures],
) -> SystemPredictionDetail:
    max_spike = max((w.spike_multiplier for w in ward_features), default=1.0)
    if max_spike < 1.035:
        return system

    updates: dict = {}
    if system.target_reduction_mw == 0:
        flex_total = sum(w.ward_flexible_capacity_mw for w in ward_features)
        updates["target_reduction_mw"] = min(650, int(flex_total * 0.35))
    if system.risk_level == RiskLevel.normal:
        updates["risk_level"] = RiskLevel.medium
    if system.event_type in (EventType.normal, EventType.surplus):
        updates["event_type"] = EventType.demand_spike
    return system.model_copy(update=updates) if updates else system


def predict_system(features: SystemFeatures) -> SystemPredictionDetail:
    row = features.model_dump()
    raw = predict_grid_stress(row)
    ts = datetime.now(timezone.utc)
    duration = 120 if raw["stress_score_before"] >= 70 else 60
    end = ts + timedelta(minutes=duration)
    event_type = _system_event_type(raw["stress_score_before"], features.demand_ramp_1h_mw)

    return SystemPredictionDetail(
        event_type=event_type,
        grid_stress_probability=raw["stress_probability"],
        risk_level=_risk_from_string(raw["risk_level"]),
        target_reduction_mw=raw["target_reduction_mw"],
        predicted_start_time=ts.isoformat(),
        predicted_end_time=end.isoformat(),
        predicted_duration_minutes=duration,
        drivers=raw["drivers"],
    )


def _ward_name(ward_id: str) -> str:
    return ward_id.replace("_", " ").title()


def _ward_event_type(
    spike_multiplier: float,
    system: SystemPredictionDetail,
    *,
    dataset_is_spike: bool = False,
    historical_rate: float = 0.0,
) -> EventType:
    if spike_multiplier >= 1.035 or dataset_is_spike:
        return EventType.demand_spike
    if historical_rate >= 0.35 and spike_multiplier >= 1.02:
        return EventType.demand_spike
    if system.event_type == EventType.outage_risk and spike_multiplier >= 1.02:
        return EventType.outage_risk
    if system.event_type == EventType.surplus:
        return EventType.surplus
    return EventType.normal


def _ward_risk(
    event_type: EventType,
    spike_multiplier: float,
    system: SystemPredictionDetail,
) -> RiskLevel:
    if event_type == EventType.demand_spike:
        if spike_multiplier >= 1.08 or system.risk_level == RiskLevel.critical:
            return RiskLevel.critical
        if spike_multiplier >= 1.05 or system.risk_level == RiskLevel.high:
            return RiskLevel.high
        return RiskLevel.medium
    if event_type == EventType.outage_risk:
        return RiskLevel.high
    if event_type == EventType.surplus:
        return RiskLevel.normal
    return system.risk_level


def _recommended_action(
    event_type: EventType,
    risk: RiskLevel,
) -> RecommendedAction:
    if event_type == EventType.surplus:
        return RecommendedAction.increase_load_or_charge_storage
    if event_type in (EventType.demand_spike, EventType.outage_risk):
        if risk in (RiskLevel.high, RiskLevel.critical):
            return RecommendedAction.reduce_load
        if risk == RiskLevel.medium:
            return RecommendedAction.shift_load
    return RecommendedAction.none


def predict_ward(
    ward: WardFeatures,
    system: SystemPredictionDetail,
    *,
    ward_name: str | None = None,
    timestamp: str | None = None,
) -> WardPrediction:
    ts_key = _normalize_timestamp(timestamp) if timestamp else None
    dataset = ward_spike_lookup.score(
        ward.ward_id,
        timestamp=ts_key,
        hour=ward.hour,
        ontario_demand_mw=ward.ontario_demand_mw,
        spike_multiplier=ward.spike_multiplier,
    )

    event_type = _ward_event_type(
        ward.spike_multiplier,
        system,
        dataset_is_spike=dataset.is_spike,
        historical_rate=dataset.historical_spike_rate,
    )
    risk = _ward_risk(event_type, ward.spike_multiplier, system)
    if dataset.is_spike and risk == RiskLevel.normal:
        risk = RiskLevel.medium
    action = _recommended_action(event_type, risk)

    load_delta = max(0.0, ward.ward_load_proxy_mw * (ward.spike_multiplier - 1.0))
    forecast_load = ward.ward_load_proxy_mw + load_delta

    if action == RecommendedAction.reduce_load:
        bid_mw = min(ward.ward_flexible_capacity_mw * 0.85, load_delta * 1.1)
    elif action == RecommendedAction.shift_load:
        bid_mw = min(ward.ward_flexible_capacity_mw * 0.55, load_delta * 0.7)
    elif action == RecommendedAction.increase_load_or_charge_storage:
        bid_mw = min(ward.ward_flexible_capacity_mw * 0.35, 40.0)
    else:
        bid_mw = 0.0

    bid_mw = round(max(0.0, bid_mw), 2)
    max_bid = round(ward.ward_flexible_capacity_mw, 2)

    hour = ward.hour
    duration = dataset.typical_duration_minutes
    ts = datetime.now(timezone.utc)
    end = ts + timedelta(minutes=duration)

    load_share = min(
        0.15, ward.ward_load_proxy_mw / max(ward.market_demand_mw, 1.0)
    )
    prob = min(
        0.98,
        max(
            0.05,
            dataset.spike_probability * 0.55
            + system.grid_stress_probability * 0.2
            + (ward.spike_multiplier - 1.0) * 1.5
            + load_share * 0.5,
        ),
    )

    drivers: list[str] = []
    if dataset.is_spike:
        drivers.append("Labeled spike hour in ward_labeled_training.csv")
    elif dataset.historical_spike_rate >= 0.25:
        drivers.append(
            f"Historical spike rate {dataset.historical_spike_rate:.0%} "
            f"for this ward/hour ({dataset.match_type})"
        )
    if ward.spike_multiplier >= 1.035:
        drivers.append("Ward load above rolling baseline")
    if system.risk_level in (RiskLevel.high, RiskLevel.critical):
        drivers.append("System stress propagation")
    if ward.demand_ramp_1h_mw > 400:
        drivers.append("Rapid demand ramp in Toronto")
    if not drivers:
        drivers.append("Stable ward conditions")

    return WardPrediction(
        ward_id=ward.ward_id,
        ward_name=ward_name or _ward_name(ward.ward_id),
        event_type=event_type,
        event_probability=round(prob, 3),
        risk_level=risk,
        predicted_start_time=ts.isoformat(),
        predicted_end_time=end.isoformat(),
        predicted_duration_minutes=duration,
        predicted_peak_hour=hour,
        baseline_load_mw=round(ward.ward_load_proxy_mw, 2),
        forecast_load_mw=round(forecast_load, 2),
        expected_load_delta_mw=round(load_delta, 2),
        ward_flexible_capacity_mw=max_bid,
        recommended_action=action,
        recommended_bid_mw=bid_mw,
        max_bid_mw=max_bid,
        confidence=round(min(0.95, prob + 0.05), 3),
        drivers=drivers,
    )


class GridForecastAgent:
    agent_id = "agent_grid_forecast"

    def run(
        self,
        system_features: SystemFeatures,
        ward_features: list[WardFeatures],
        *,
        ward_names: dict[str, str] | None = None,
        timestamp: str | None = None,
    ) -> tuple[SystemPredictionDetail, list[WardPrediction]]:
        system = _boost_system_for_spikes(
            predict_system(system_features), ward_features
        )
        names = ward_names or {}
        predictions = [
            predict_ward(
                ward,
                system,
                ward_name=names.get(ward.ward_id),
                timestamp=timestamp,
            )
            for ward in ward_features
        ]
        return system, predictions

    def predict_ward_batch(
        self,
        request: WardPredictRequest,
    ) -> WardPredictResponse:
        dummy = SystemFeatures(
            ontario_demand_mw=request.wards[0].ontario_demand_mw if request.wards else 18000,
            market_demand_mw=request.wards[0].market_demand_mw if request.wards else 5200,
            hour=request.wards[0].hour if request.wards else 12,
        )
        system = predict_system(dummy)
        predictions = [
            predict_ward(w, system, timestamp=request.timestamp) for w in request.wards
        ]
        now = datetime.now(timezone.utc)
        return WardPredictResponse(
            prediction_id=str(uuid.uuid4()),
            created_at=now.isoformat(),
            forecast_generated_for=request.timestamp,
            forecast_horizon_minutes=request.forecast_horizon_hours * 60,
            system_prediction=system,
            ward_predictions=predictions,
        )

    def predict_grid(self, request: GridPredictRequest) -> SystemPredictionResponse:
        features = SystemFeatures(**request.model_dump())
        row = predict_grid_stress(features.model_dump())
        return SystemPredictionResponse(**row)


grid_forecast_agent = GridForecastAgent()
