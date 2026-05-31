"""Orchestrate simulation ticks via the ML service HTTP API."""

from __future__ import annotations

import logging
import uuid

from backend.agents.market_clearing_agent import market_clearing_agent
from backend.agents.reporter_agent import reporter_agent
from backend.clients.ml_service_client import ml_service_client
from backend.config import OFFLINE_MODE
from backend.schemas.simulation import SimulationRunResponse, SystemFeatures, WardFeatures
from backend.simulation.kepler_export import build_kepler_flows, build_kepler_nodes
from backend.simulation.ml_feature_adapter import build_ml_feature_row
from backend.simulation.ml_response_mapper import (
    build_market_context,
    to_system_prediction_detail,
    to_ward_agent_decisions,
    to_ward_predictions,
)

logger = logging.getLogger(__name__)


async def run_tick(
    *,
    timestamp: str,
    system_features: SystemFeatures,
    ward_features: list[WardFeatures],
    ward_names: dict[str, str] | None = None,
    snapshot: dict | None = None,
    include_reporter: bool = True,
    player=None,
) -> SimulationRunResponse:
    names = ward_names or {}
    meta = dict(snapshot or {})

    if player is None:
        raise ValueError("HistoricalDemandPlayer required for ML service mode")

    feature_row = build_ml_feature_row(system_features, player)
    feature_row["timestamp"] = timestamp

    ward_market = await ml_service_client.ward_market_payload(feature_row)
    if ward_market.get("error"):
        raise RuntimeError(ward_market["error"])

    system_raw = ward_market.get("system_prediction", {})
    stress_before = int(system_raw.get("stress_score_before", 0))

    ward_result = {
        "system_prediction": system_raw,
        "ward_predictions": [
            {
                "zone_id": item["zone_id"],
                "ward_stress_score": item.get("ward_stress_score"),
                "ward_stress_probability": item.get("ward_stress_probability"),
                "estimated_stress_duration_hours": item.get(
                    "estimated_stress_duration_hours"
                ),
                "target_reduction_mw": item.get("target_reduction_mw"),
                "available_flex_mw": item.get("available_flex_mw"),
                "recommended_reduction_mw": item.get("recommended_reduction_mw"),
                "local_vulnerability_score": item.get("local_vulnerability_score"),
                "flexibility_buffer_ratio": item.get("flexibility_buffer_ratio"),
                "risk_level": _risk_from_score(item.get("ward_stress_score", 0)),
                "drivers": [item.get("reason", "")],
            }
            for item in ward_market.get("ward_agent_predictions", [])
        ],
    }

    system_prediction = to_system_prediction_detail(
        system_raw,
        timestamp=timestamp,
        demand_ramp_1h_mw=system_features.demand_ramp_1h_mw,
    )
    ward_predictions = to_ward_predictions(
        ward_result,
        ward_features,
        ward_market,
        timestamp=timestamp,
        ward_names=names,
    )
    ward_decisions = to_ward_agent_decisions(
        ward_market,
        timestamp=timestamp,
        ward_predictions=ward_predictions,
    )

    event_id = str(uuid.uuid4())
    market_context = build_market_context(
        system_prediction,
        event_id=event_id,
        stress_before=stress_before,
    )

    submitted_bids = [d.bid for d in ward_decisions if d.bid is not None]
    market_result = market_clearing_agent.clear(
        submitted_bids,
        market_context,
        event_id=event_id,
        timestamp=timestamp,
    )

    intervention = None
    rebalance = None
    try:
        if system_prediction.target_reduction_mw > 0:
            intervention = await ml_service_client.plan_intervention(
                target_reduction_mw=system_prediction.target_reduction_mw,
                stress_score_before=stress_before,
            )
        rebalance = await ml_service_client.rebalance_payload(feature_row)
    except Exception:
        logger.debug("Optional ML intervention/rebalance call failed", exc_info=True)

    reporter = (
        await reporter_agent.build_alert_async(system_prediction, market_result)
        if include_reporter
        else None
    )
    if reporter and intervention:
        assets = intervention.get("selected_assets") or intervention.get("assets")
        if assets:
            reporter.alert.operator_note = (
                f"{reporter.alert.operator_note} "
                f"ML flex plan: {len(assets)} asset(s) selected."
            ).strip()

    kepler_nodes = build_kepler_nodes(
        timestamp,
        ward_predictions,
        market_result,
        stress_score=stress_before,
    )
    kepler_flows = build_kepler_flows(
        timestamp,
        market_result.accepted_bids,
        ward_predictions,
    )

    meta = {
        **meta,
        "agent_mode": "ml_service",
        "offline_mode": OFFLINE_MODE,
        "ml_service_url": ml_service_client.base_url,
        "ml_market_summary": ward_market.get("market_summary"),
        "ml_rebalance": rebalance,
        "ml_intervention": intervention,
        "pipeline": {
            "forecast": {
                "stress_score": stress_before,
                "target_reduction_mw": system_prediction.target_reduction_mw,
                "risk_level": system_prediction.risk_level.value,
                "ward_predictions": len(ward_predictions),
            },
            "ward_agents": {
                "total": len(ward_decisions),
                "submitted": len(submitted_bids),
                "idle": len(ward_decisions) - len(submitted_bids),
            },
            "market_clearing": {
                "status": market_result.clearing_result.clearing_status,
                "accepted_bids": len(market_result.accepted_bids),
                "rejected_bids": len(market_result.rejected_bids),
                "accepted_mw": market_result.clearing_result.accepted_reduction_mw,
                "unfilled_mw": market_result.clearing_result.unfilled_reduction_mw,
                "clearing_price_per_mwh": market_result.clearing_result.clearing_price_per_mwh,
                "stress_before": market_result.clearing_result.stress_score_before,
                "stress_after": market_result.clearing_result.stress_score_after,
            },
            "dispatch": {
                "flows": len(kepler_flows),
                "wards_accepted": sum(
                    1 for n in kepler_nodes if n.dispatch_status == "accepted"
                ),
                "wards_rejected": sum(
                    1 for n in kepler_nodes if n.dispatch_status == "rejected"
                ),
            },
        },
    }

    return SimulationRunResponse(
        simulation_id=event_id,
        timestamp=timestamp,
        grid_prediction=system_prediction,
        ward_predictions=ward_predictions,
        ward_agent_decisions=ward_decisions,
        submitted_bids=submitted_bids,
        market_result=market_result,
        reporter=reporter,
        kepler_nodes=kepler_nodes,
        kepler_flows=kepler_flows,
        snapshot=meta,
    )


def _risk_from_score(score: float | int | None) -> str:
    value = float(score or 0)
    if value >= 97:
        return "critical"
    if value >= 88:
        return "high"
    if value >= 70:
        return "medium"
    if value >= 50:
        return "elevated"
    return "normal"


class MLServiceOrchestrator:
    agent_id = "agent_ml_service_orchestrator"

    async def run_tick(self, **kwargs):
        return await run_tick(**kwargs)


ml_service_orchestrator = MLServiceOrchestrator()
