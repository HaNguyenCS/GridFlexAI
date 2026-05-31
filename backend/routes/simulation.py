"""REST routes for the GridFlex flex-market simulation pipeline."""

from __future__ import annotations

from datetime import datetime, timezone

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
    GridMockSnapshot,
    GridPredictRequest,
    MarketClearRequest,
    SimulationRunRequest,
    SystemFeatures,
    WardBidsRequest,
    WardPredictRequest,
)
from backend.simulation.feature_builder import build_from_simulator
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
