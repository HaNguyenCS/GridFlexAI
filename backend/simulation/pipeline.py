"""Simulation orchestrator — forecast → ward bids → market clear → report."""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone

from backend.agents.grid_forecast_agent import grid_forecast_agent
from backend.agents.llm_orchestrator import llm_orchestrator
from backend.agents.market_clearing_agent import market_clearing_agent
from backend.agents.ml_service_orchestrator import ml_service_orchestrator
from backend.agents.nemoclaw_orchestrator import nemoclaw_orchestrator
from backend.agents.reporter_agent import reporter_agent
from backend.agents.ward_agent import build_ward_agents
from backend.config import AGENT_MODE
from backend.ingestion.zone_simulator import WardStreamSimulator
from backend.schemas.simulation import (
    MarketContext,
    SimulationRunRequest,
    SimulationRunResponse,
    SimulationTickMessage,
    SystemFeatures,
    WardFeatures,
)
from backend.simulation.feature_builder import build_from_simulator, build_snapshot_meta
from backend.simulation.kepler_export import build_kepler_flows, build_kepler_nodes
from backend.simulation.system_predictor import predict_grid_stress

logger = logging.getLogger(__name__)


def _build_pipeline_snapshot(
    *,
    ward_predictions,
    ward_decisions,
    submitted_bids,
    market_result,
    kepler_nodes,
    kepler_flows,
    stress_before: int,
    system_prediction,
) -> dict:
    cr = market_result.clearing_result
    return {
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
            "status": cr.clearing_status,
            "accepted_bids": len(market_result.accepted_bids),
            "rejected_bids": len(market_result.rejected_bids),
            "accepted_mw": cr.accepted_reduction_mw,
            "unfilled_mw": cr.unfilled_reduction_mw,
            "clearing_price_per_mwh": cr.clearing_price_per_mwh,
            "stress_before": cr.stress_score_before,
            "stress_after": cr.stress_score_after,
        },
        "dispatch": {
            "flows": len(kepler_flows),
            "wards_accepted": sum(1 for n in kepler_nodes if n.dispatch_status == "accepted"),
            "wards_rejected": sum(1 for n in kepler_nodes if n.dispatch_status == "rejected"),
        },
    }


async def run_simulation_tick(
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
    stress_before = predict_grid_stress(system_features.model_dump())["stress_score_before"]
    ward_dicts = [w.model_dump() for w in ward_features]

    if AGENT_MODE == "ml_service":
        try:
            return await ml_service_orchestrator.run_tick(
                timestamp=timestamp,
                system_features=system_features,
                ward_features=ward_features,
                ward_names=names,
                snapshot=snapshot,
                include_reporter=include_reporter,
                player=player,
            )
        except Exception:
            logger.exception("ML service orchestrator failed; falling back to deterministic agents")

    elif AGENT_MODE == "nemoclaw":
        try:
            return await nemoclaw_orchestrator.run_tick(
                timestamp=timestamp,
                system_features=system_features.model_dump(),
                ward_features=ward_dicts,
                ward_names=names,
                snapshot=snapshot,
                stress_before=stress_before,
            )
        except Exception:
            logger.exception("NemoClaw orchestrator failed; falling back to LLM")
            try:
                return await llm_orchestrator.run_tick(
                    timestamp=timestamp,
                    system_features=system_features.model_dump(),
                    ward_features=ward_dicts,
                    ward_names=names,
                    snapshot=snapshot,
                    stress_before=stress_before,
                )
            except Exception:
                logger.exception("LLM orchestrator failed; falling back to deterministic agents")

    elif AGENT_MODE == "llm":
        try:
            return await llm_orchestrator.run_tick(
                timestamp=timestamp,
                system_features=system_features.model_dump(),
                ward_features=ward_dicts,
                ward_names=names,
                snapshot=snapshot,
                stress_before=stress_before,
            )
        except Exception:
            logger.exception("LLM orchestrator failed; falling back to deterministic agents")

    return await _run_deterministic_tick(
        timestamp=timestamp,
        system_features=system_features,
        ward_features=ward_features,
        ward_names=names,
        snapshot=snapshot,
        include_reporter=include_reporter,
        stress_before=stress_before,
    )


async def _run_deterministic_tick(
    *,
    timestamp: str,
    system_features: SystemFeatures,
    ward_features: list[WardFeatures],
    ward_names: dict[str, str],
    snapshot: dict | None,
    include_reporter: bool,
    stress_before: int,
) -> SimulationRunResponse:
    system_prediction, ward_predictions = grid_forecast_agent.run(
        system_features,
        ward_features,
        ward_names=ward_names,
        timestamp=timestamp,
    )

    event_id = str(uuid.uuid4())
    market_context = MarketContext(
        event_id=event_id,
        system_risk_level=system_prediction.risk_level,
        target_reduction_mw=system_prediction.target_reduction_mw,
        stress_score_before=stress_before,
    )

    agents = build_ward_agents([w.ward_id for w in ward_features])
    prediction_by_ward = {p.ward_id: p for p in ward_predictions}

    ward_decisions = await asyncio.gather(
        *[
            agent.decide_bid_async(
                prediction_by_ward[agent.ward_id],
                market_context,
                timestamp,
            )
            for agent in agents
            if agent.ward_id in prediction_by_ward
        ]
    )

    submitted_bids = [d.bid for d in ward_decisions if d.bid is not None]
    market_result = market_clearing_agent.clear(
        submitted_bids,
        market_context,
        event_id=event_id,
        timestamp=timestamp,
    )

    reporter = (
        await reporter_agent.build_alert_async(system_prediction, market_result)
        if include_reporter
        else None
    )

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

    meta = snapshot or {}
    meta = {**meta, "agent_mode": "deterministic", "pipeline": _build_pipeline_snapshot(
        ward_predictions=ward_predictions,
        ward_decisions=ward_decisions,
        submitted_bids=submitted_bids,
        market_result=market_result,
        kepler_nodes=kepler_nodes,
        kepler_flows=kepler_flows,
        stress_before=stress_before,
        system_prediction=system_prediction,
    )}

    return SimulationRunResponse(
        simulation_id=event_id,
        timestamp=timestamp,
        grid_prediction=system_prediction,
        ward_predictions=ward_predictions,
        ward_agent_decisions=list(ward_decisions),
        submitted_bids=submitted_bids,
        market_result=market_result,
        reporter=reporter,
        kepler_nodes=kepler_nodes,
        kepler_flows=kepler_flows,
        snapshot=meta,
    )


async def run_simulation_from_simulator(
    simulator: WardStreamSimulator,
    *,
    include_reporter: bool = True,
) -> SimulationRunResponse:
    timestamp, system_features, ward_features = build_from_simulator(simulator)
    ward_names = {p.zone_id: p.ward_name for p in simulator.profiles}
    snapshot = build_snapshot_meta(simulator)
    return await run_simulation_tick(
        timestamp=timestamp,
        system_features=system_features,
        ward_features=ward_features,
        ward_names=ward_names,
        snapshot=snapshot,
        include_reporter=include_reporter,
        player=simulator._history,
    )


async def run_simulation_request(
    request: SimulationRunRequest,
    simulator: WardStreamSimulator | None = None,
) -> SimulationRunResponse:
    if request.system_features and request.ward_features:
        ts = request.timestamp or datetime.now(timezone.utc).isoformat()
        ward_names = None
        if simulator:
            ward_names = {p.zone_id: p.ward_name for p in simulator.profiles}
        return await run_simulation_tick(
            timestamp=ts,
            system_features=request.system_features,
            ward_features=request.ward_features,
            ward_names=ward_names,
            snapshot=build_snapshot_meta(simulator) if simulator else {},
        )

    if simulator is None:
        raise ValueError("Simulator required when features not provided")

    return await run_simulation_from_simulator(simulator)


def to_tick_message(result: SimulationRunResponse) -> SimulationTickMessage:
    return SimulationTickMessage(
        timestamp=result.timestamp,
        snapshot=result.snapshot,
        grid_prediction=result.grid_prediction,
        ward_predictions=result.ward_predictions,
        ward_agent_decisions=result.ward_agent_decisions,
        submitted_bids=result.submitted_bids,
        market_result=result.market_result,
        reporter=result.reporter,
        kepler_nodes=result.kepler_nodes,
        kepler_flows=result.kepler_flows,
    )
