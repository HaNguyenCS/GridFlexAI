"""Map ML service JSON payloads to backend simulation schemas."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from backend.schemas.simulation import (
    Bid,
    BidType,
    DispatchStatus,
    EventType,
    MarketContext,
    RecommendedAction,
    RiskLevel,
    SystemPredictionDetail,
    WardAgentDecision,
    WardFeatures,
    WardPrediction,
)


def _map_risk(level: str) -> RiskLevel:
    normalized = (level or "normal").lower()
    if normalized == "elevated":
        return RiskLevel.medium
    try:
        return RiskLevel(normalized)
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


def to_system_prediction_detail(
    raw: dict[str, Any],
    *,
    timestamp: str,
    demand_ramp_1h_mw: float = 0.0,
) -> SystemPredictionDetail:
    stress_score = int(raw.get("stress_score_before", 0))
    ts = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    duration_hours = float(
        raw.get("estimated_system_stress_duration_hours", 0) or 0
    )
    duration_minutes = int(duration_hours * 60) if duration_hours else (
        120 if stress_score >= 70 else 60
    )
    end = ts + timedelta(minutes=duration_minutes)

    return SystemPredictionDetail(
        event_type=_system_event_type(stress_score, demand_ramp_1h_mw),
        grid_stress_probability=float(raw.get("stress_probability", 0)),
        risk_level=_map_risk(str(raw.get("risk_level", "normal"))),
        target_reduction_mw=int(raw.get("target_reduction_mw", 0)),
        predicted_start_time=ts.isoformat(),
        predicted_end_time=end.isoformat(),
        predicted_duration_minutes=duration_minutes,
        drivers=list(raw.get("drivers") or ["ML system stress model"]),
    )


def _ward_name(ward_id: str, ward_names: dict[str, str]) -> str:
    return ward_names.get(ward_id) or ward_id.replace("_", " ").title()


def _action_from_bid_type(bid_type: str) -> RecommendedAction:
    if bid_type == "BUY_REDUCTION":
        return RecommendedAction.reduce_load
    if bid_type == "SELL_FLEX":
        return RecommendedAction.increase_load_or_charge_storage
    return RecommendedAction.none


def _event_from_stress_state(stress_state: str, ward_score: float) -> EventType:
    if stress_state == "NEEDS_ELECTRICITY" or ward_score >= 88:
        return EventType.demand_spike
    if stress_state == "SUPPORT_AVAILABLE":
        return EventType.surplus
    return EventType.normal


def to_ward_predictions(
    ward_result: dict[str, Any],
    ward_features: list[WardFeatures],
    ward_agent_payload: dict[str, Any],
    *,
    timestamp: str,
    ward_names: dict[str, str] | None = None,
) -> list[WardPrediction]:
    names = ward_names or {}
    features_by_id = {w.ward_id: w for w in ward_features}
    agent_by_zone = {
        item["zone_id"]: item
        for item in ward_agent_payload.get("ward_agent_predictions", [])
    }
    ward_rows = {
        item["zone_id"]: item for item in ward_result.get("ward_predictions", [])
    }

    predictions: list[WardPrediction] = []
    ts = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)

    for ward in ward_features:
        zone_id = ward.ward_id
        row = ward_rows.get(zone_id, {})
        agent = agent_by_zone.get(zone_id, {})
        bid_type = agent.get("bid_type", "NO_BID")
        action = _action_from_bid_type(bid_type)
        ward_score = float(row.get("ward_stress_score", 0) or 0)
        stress_state = agent.get("stress_state", "NEUTRAL")
        risk = _map_risk(str(row.get("risk_level", "normal")))
        if ward_score >= 97:
            risk = RiskLevel.critical
        elif ward_score >= 88 and risk == RiskLevel.normal:
            risk = RiskLevel.high

        duration_hours = float(
            row.get("estimated_stress_duration_hours")
            or agent.get("estimated_stress_duration_hours")
            or 1.0
        )
        duration_minutes = max(15, int(duration_hours * 60))
        end = ts + timedelta(minutes=duration_minutes)

        quantity = float(agent.get("quantity_mw", 0) or 0)
        max_bid = float(row.get("available_flex_mw", ward.ward_flexible_capacity_mw))
        load_delta = max(0.0, ward.ward_load_proxy_mw * (ward.spike_multiplier - 1.0))
        drivers = list(row.get("drivers") or [])
        if agent.get("reason"):
            drivers.insert(0, str(agent["reason"]))

        predictions.append(
            WardPrediction(
                ward_id=zone_id,
                ward_name=_ward_name(zone_id, names),
                event_type=_event_from_stress_state(stress_state, ward_score),
                event_probability=float(
                    row.get("ward_stress_probability", ward_score / 100)
                ),
                risk_level=risk,
                predicted_start_time=ts.isoformat(),
                predicted_end_time=end.isoformat(),
                predicted_duration_minutes=duration_minutes,
                predicted_peak_hour=ward.hour,
                baseline_load_mw=round(ward.ward_load_proxy_mw, 2),
                forecast_load_mw=round(ward.ward_load_proxy_mw + load_delta, 2),
                expected_load_delta_mw=round(load_delta, 2),
                ward_flexible_capacity_mw=round(max_bid, 2),
                recommended_action=action,
                recommended_bid_mw=round(quantity, 2),
                max_bid_mw=round(max_bid, 2),
                confidence=round(
                    min(0.98, float(row.get("ward_stress_probability", 0.5)) + 0.05),
                    3,
                ),
                drivers=drivers or ["ML ward stress layer"],
            )
        )

    return predictions


def to_ward_agent_decisions(
    ward_agent_payload: dict[str, Any],
    *,
    timestamp: str,
    ward_predictions: list[WardPrediction],
) -> list[WardAgentDecision]:
    pred_by_id = {p.ward_id: p for p in ward_predictions}
    decisions: list[WardAgentDecision] = []

    ts = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)

    for agent in ward_agent_payload.get("ward_agent_predictions", []):
        zone_id = str(agent.get("zone_id"))
        agent_id = str(agent.get("agent", f"agent_{zone_id}"))
        bid_type = agent.get("bid_type", "NO_BID")
        quantity = float(agent.get("quantity_mw", 0) or 0)
        price = float(agent.get("price_signal", 0) or 0)
        pred = pred_by_id.get(zone_id)

        if bid_type == "NO_BID" or quantity <= 0:
            decisions.append(
                WardAgentDecision(
                    agent_id=agent_id,
                    ward_id=zone_id,
                    decision="no_bid",
                    bid=None,
                )
            )
            continue

        duration = pred.predicted_duration_minutes if pred else 60
        end = ts + timedelta(minutes=duration)
        ml_bid_type = (
            BidType.demand_reduction
            if bid_type == "BUY_REDUCTION"
            else BidType.flexible_load_increase
        )

        bid = Bid(
            bid_id=f"bid_{zone_id}_{uuid.uuid4().hex[:8]}",
            agent_id=agent_id,
            ward_id=zone_id,
            bid_type=ml_bid_type,
            quantity_mw=round(quantity, 2),
            max_quantity_mw=pred.max_bid_mw if pred else quantity,
            price_per_mwh=round(price, 2),
            available_start_time=ts.isoformat(),
            available_end_time=end.isoformat(),
            duration_minutes=duration,
            activation_minutes=5 if bid_type == "BUY_REDUCTION" else 15,
            confidence=pred.confidence if pred else 0.7,
            comfort_impact="medium" if bid_type == "BUY_REDUCTION" else "low",
            status=DispatchStatus.submitted,
            reason=str(agent.get("reason", bid_type)),
        )
        decisions.append(
            WardAgentDecision(
                agent_id=agent_id,
                ward_id=zone_id,
                decision="submit_bid",
                bid=bid,
            )
        )

    return decisions


def build_market_context(
    system: SystemPredictionDetail,
    *,
    event_id: str,
    stress_before: int,
) -> MarketContext:
    return MarketContext(
        event_id=event_id,
        system_risk_level=system.risk_level,
        target_reduction_mw=system.target_reduction_mw,
        stress_score_before=stress_before,
    )
