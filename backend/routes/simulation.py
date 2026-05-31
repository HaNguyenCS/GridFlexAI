"""REST routes for the GridFlex flex-market simulation pipeline."""

from __future__ import annotations

from datetime import datetime, timezone
import uuid

from fastapi import APIRouter, HTTPException

from backend.agents.grid_forecast_agent import grid_forecast_agent
from backend.agents.market_clearing_agent import market_clearing_agent
from backend.agents.nim_client import nim_client
from backend.agents.nemoclaw_client import nemoclaw_client
from backend.agents.reporter_agent import reporter_agent
from backend.agents.ward_agent import collect_ward_bids
from backend.clients.ml_service_client import ml_service_client
from backend.config import (
    AGENT_MODE,
    ML_SERVICE_URL,
    NEMOCLAW_AGENT_ID,
    NEMOCLAW_GATEWAY_URL,
    NEMOCLAW_OPENCLAW_BIN,
    NEMOCLAW_SESSION_ID,
    NIM_BASE_URL,
    NIM_MODEL,
    REPORTER_MODE,
)
from backend.schemas.simulation import (
    Bid,
    BidType,
    DispatchStatus,
    EventType,
    GridMockSnapshot,
    GridPredictRequest,
    MarketClearRequest,
    MarketContext,
    RecommendedAction,
    RiskLevel,
    SimulationRunRequest,
    SimulationRunResponse,
    WardAgentDecision,
    WardBidsRequest,
    WardPredictRequest,
)
from backend.simulation.feature_builder import build_from_simulator, build_snapshot_meta
from backend.simulation.kepler_export import build_kepler_flows, build_kepler_nodes
from backend.simulation.pipeline import run_simulation_request

router = APIRouter(tags=["simulation"])


def init_router(simulator) -> APIRouter:
    """Attach simulator reference for routes that read live state."""

    @router.get("/grid/mock")
    def grid_mock() -> GridMockSnapshot:
        timestamp, system, wards = build_from_simulator(simulator)
        predict_request = GridPredictRequest(**system.model_dump())
        preview = grid_forecast_agent.predict_grid(predict_request)

        return GridMockSnapshot(
            timestamp=timestamp,
            system=system,
            predict_request=predict_request,
            prediction_preview=preview,
            nodes=wards,
        )

    @router.post("/grid/predict")
    def grid_predict(body: GridPredictRequest):
        return grid_forecast_agent.predict_grid(body)

    @router.post("/grid/ward/predict")
    def grid_ward_predict(body: WardPredictRequest):
        return grid_forecast_agent.predict_ward_batch(body)

    @router.post("/agents/ward/bids")
    async def agents_ward_bids(body: WardBidsRequest):
        return await collect_ward_bids(body)

    @router.post("/market/clear")
    def market_clear(body: MarketClearRequest):
        return market_clearing_agent.clear_request(body)

    @router.post("/simulation/run")
    async def simulation_run(body: SimulationRunRequest | None = None):
        request = body or SimulationRunRequest()

        try:
            return await run_simulation_request(request, simulator)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.post("/simulation/stress-demo")
    async def simulation_stress_demo() -> SimulationRunResponse:
        """
        Product stress simulator.

        This creates a controlled critical grid-stress event and returns the
        same UI-ready response shape as /simulation/run.
        """
        simulator.reset_demo_playback()

        timestamp, system_features, ward_features = build_from_simulator(simulator)
        ward_names = {profile.zone_id: profile.ward_name for profile in simulator.profiles}
        event_id = str(uuid.uuid4())

        base_result = await run_simulation_request(SimulationRunRequest(), simulator)

        stress_before = 94
        stress_target_mw = 650

        system_prediction = base_result.grid_prediction.model_copy(
            update={
                "event_type": EventType.demand_spike,
                "grid_stress_probability": 0.99,
                "risk_level": RiskLevel.critical,
                "target_reduction_mw": stress_target_mw,
                "predicted_start_time": timestamp,
                "predicted_duration_minutes": 120,
                "drivers": [
                    "Controlled stress simulation",
                    "Simulated reserve margin collapse",
                    "Simulated rapid Toronto demand ramp",
                    "Simulated critical ward-level flexibility need",
                ],
            }
        )

        market_context = MarketContext(
            event_id=event_id,
            system_risk_level=RiskLevel.critical,
            target_reduction_mw=stress_target_mw,
            stress_score_before=stress_before,
        )

        base_prediction_by_ward = {
            prediction.ward_id: prediction
            for prediction in base_result.ward_predictions
        }

        ward_predictions = []
        raw_quantities: list[float] = []

        for index, ward in enumerate(ward_features):
            base_prediction = base_prediction_by_ward.get(
                ward.ward_id,
                base_result.ward_predictions[0],
            )

            severity_boost = 1.0 + (index % 5) * 0.08
            raw_quantity = max(
                12.0,
                min(
                    float(ward.ward_flexible_capacity_mw),
                    float(ward.ward_flexible_capacity_mw) * 0.85 * severity_boost,
                ),
            )
            raw_quantities.append(raw_quantity)

            risk = RiskLevel.critical if index >= 15 else RiskLevel.high

            prediction = base_prediction.model_copy(
                update={
                    "ward_id": ward.ward_id,
                    "ward_name": ward_names.get(
                        ward.ward_id,
                        ward.ward_id.replace("_", " ").title(),
                    ),
                    "event_type": EventType.demand_spike,
                    "event_probability": 0.98 if risk == RiskLevel.critical else 0.92,
                    "risk_level": risk,
                    "predicted_start_time": timestamp,
                    "predicted_duration_minutes": 120,
                    "predicted_peak_hour": system_features.hour,
                    "baseline_load_mw": round(ward.ward_load_proxy_mw, 2),
                    "forecast_load_mw": round(ward.ward_load_proxy_mw + raw_quantity, 2),
                    "expected_load_delta_mw": round(raw_quantity, 2),
                    "ward_flexible_capacity_mw": round(ward.ward_flexible_capacity_mw, 2),
                    "recommended_action": RecommendedAction.reduce_load,
                    "recommended_bid_mw": round(raw_quantity, 2),
                    "max_bid_mw": round(ward.ward_flexible_capacity_mw, 2),
                    "confidence": 0.94,
                    "drivers": [
                        "Controlled critical stress event",
                        "Ward agent selected for emergency demand reduction",
                    ],
                }
            )

            ward_predictions.append(prediction)

        raw_total = sum(raw_quantities) or 1.0
        scale = stress_target_mw / raw_total

        ward_decisions = []
        submitted_bids = []

        for prediction, raw_quantity in zip(ward_predictions, raw_quantities):
            quantity = min(
                prediction.max_bid_mw,
                max(1.0, round(raw_quantity * scale, 2)),
            )

            bid = Bid(
                bid_id=f"bid_{prediction.ward_id}_{uuid.uuid4().hex[:8]}",
                agent_id=f"agent_{prediction.ward_id}",
                ward_id=prediction.ward_id,
                bid_type=BidType.demand_reduction,
                quantity_mw=quantity,
                max_quantity_mw=prediction.max_bid_mw,
                price_per_mwh=95.0 if prediction.risk_level == RiskLevel.high else 120.0,
                available_start_time=timestamp,
                available_end_time=timestamp,
                duration_minutes=120,
                activation_minutes=5,
                confidence=prediction.confidence,
                comfort_impact="medium",
                status=DispatchStatus.submitted,
                reason=f"stress_demo / {prediction.risk_level.value}",
            )

            decision = WardAgentDecision(
                agent_id=f"agent_{prediction.ward_id}",
                ward_id=prediction.ward_id,
                decision="submit_bid",
                bid=bid,
            )

            ward_decisions.append(decision)
            submitted_bids.append(bid)

        market_result = market_clearing_agent.clear(
            submitted_bids,
            market_context,
            event_id=event_id,
            timestamp=timestamp,
        )

        reporter = await reporter_agent.build_alert_async(
            system_prediction,
            market_result,
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

        snapshot = {
            **build_snapshot_meta(simulator),
            "agent_mode": "stress_simulator",
            "stress_demo": True,
            "ml_service_url": ML_SERVICE_URL,
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
                        1 for node in kepler_nodes if node.dispatch_status == "accepted"
                    ),
                    "wards_rejected": sum(
                        1 for node in kepler_nodes if node.dispatch_status == "rejected"
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
            snapshot=snapshot,
        )

    @router.get("/agent/ml/health")
    async def agent_ml_health():
        ml = await ml_service_client.health_check()

        return {
            "agent_mode": AGENT_MODE,
            "reporter_mode": REPORTER_MODE,
            "ml_service_url": ML_SERVICE_URL,
            "ml": ml,
        }

    @router.get("/agent/nim/health")
    async def agent_nim_health():
        nim = await nim_client.health_check()

        return {
            "agent_mode": AGENT_MODE,
            "reporter_mode": REPORTER_MODE,
            "nim_base_url": NIM_BASE_URL,
            "nim_model": NIM_MODEL,
            "nim": nim,
        }

    @router.get("/agent/nemoclaw/health")
    async def agent_nemoclaw_health():
        nc = await nemoclaw_client.health_check()

        return {
            "agent_mode": AGENT_MODE,
            "reporter_mode": REPORTER_MODE,
            "openclaw_bin": NEMOCLAW_OPENCLAW_BIN,
            "nemoclaw_agent_id": NEMOCLAW_AGENT_ID,
            "nemoclaw_session_id": NEMOCLAW_SESSION_ID,
            "gateway_url": NEMOCLAW_GATEWAY_URL,
            "nemoclaw": nc,
        }

    @router.post("/agent/report")
    async def agent_report():
        result = await run_simulation_request(SimulationRunRequest(), simulator)

        if result.reporter is None:
            raise HTTPException(status_code=500, detail="Reporter unavailable")

        return result.reporter

    @router.post("/agent/alert-summary")
    async def agent_alert_summary():
        result = await run_simulation_request(SimulationRunRequest(), simulator)

        if result.reporter is None:
            raise HTTPException(status_code=500, detail="Reporter unavailable")

        return {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "alert": result.reporter.alert,
            "stress_before": result.market_result.clearing_result.stress_score_before,
            "stress_after": result.market_result.clearing_result.stress_score_after,
        }

    return router