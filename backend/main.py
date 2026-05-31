import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from backend.config import (
    AGENT_MODE,
    HISTORICAL_PLAYBACK_START_INDEX,
    LLM_STREAM_INTERVAL_SEC,
    ML_SERVICE_URL,
    NEMOCLAW_AGENT_ID,
    OFFLINE_MODE,
    NEMOCLAW_STREAM_INTERVAL_SEC,
    NIM_MODEL,
    REPORTER_MODE,
    STREAM_INTERVAL_SEC,
    SUPPLY_BUDGET,
    WARDS_GEOJSON,
)
from backend.ingestion.zone_simulator import WardStreamSimulator
from backend.routes.simulation import init_router
from backend.simulation.pipeline import run_simulation_from_simulator, to_tick_message

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

if AGENT_MODE == "nemoclaw":
    from backend.agents.nemoclaw_supply_agent import NemoClawSupplyAgent

    simulator = WardStreamSimulator(supply_budget=SUPPLY_BUDGET, supply_agent=NemoClawSupplyAgent())
elif AGENT_MODE == "llm":
    from backend.agents.llm_supply_agent import LLMSupplyAgent

    simulator = WardStreamSimulator(supply_budget=SUPPLY_BUDGET, supply_agent=LLMSupplyAgent())
else:
    simulator = WardStreamSimulator(supply_budget=SUPPLY_BUDGET)

if AGENT_MODE == "nemoclaw":
    SIM_TICK_SEC = NEMOCLAW_STREAM_INTERVAL_SEC
elif AGENT_MODE == "llm":
    SIM_TICK_SEC = LLM_STREAM_INTERVAL_SEC
else:
    SIM_TICK_SEC = STREAM_INTERVAL_SEC
demand_clients: set[WebSocket] = set()
supply_clients: set[WebSocket] = set()
trades_clients: set[WebSocket] = set()
issues_clients: set[WebSocket] = set()
live_clients: set[WebSocket] = set()
simulation_clients: set[WebSocket] = set()


class SolveRequest(BaseModel):
    budget: float | None = Field(default=None, ge=0)
    demands: dict[str, float] | None = None


async def _broadcast(clients: set[WebSocket], message: dict) -> None:
    dead: list[WebSocket] = []
    for ws in clients:
        try:
            await ws.send_json(message)
        except Exception:
            dead.append(ws)
    for ws in dead:
        clients.discard(ws)


async def _zone_stream_loop() -> None:
    while True:
        if demand_clients or supply_clients or trades_clients or issues_clients:
            demand_frame, supply_frame, trades_frame, issues_frame, _decision, _states = (
                simulator.snapshot()
            )
            if demand_clients:
                await _broadcast(demand_clients, demand_frame)
            if supply_clients:
                await _broadcast(supply_clients, supply_frame)
            if trades_clients:
                await _broadcast(trades_clients, trades_frame)
            if issues_clients:
                await _broadcast(issues_clients, issues_frame)
            logger.debug(
                "Broadcast ward frames (demand=%s, supply=%s, trades=%s, issues=%s clients)",
                len(demand_clients),
                len(supply_clients),
                len(trades_clients),
                len(issues_clients),
            )
        await asyncio.sleep(STREAM_INTERVAL_SEC)


async def _simulation_stream_loop() -> None:
    while True:
        if simulation_clients:
            try:
                result = await run_simulation_from_simulator(simulator)
                message = to_tick_message(result).model_dump(mode="json")
                await _broadcast(simulation_clients, message)
                logger.debug(
                    "Broadcast simulation tick (%s clients, mode=%s, stress %s→%s)",
                    len(simulation_clients),
                    result.snapshot.get("agent_mode", AGENT_MODE),
                    result.market_result.clearing_result.stress_score_before,
                    result.market_result.clearing_result.stress_score_after,
                )
            except Exception:
                logger.exception("Simulation tick failed")
        await asyncio.sleep(SIM_TICK_SEC)


@asynccontextmanager
async def lifespan(app: FastAPI):
    stream_task = asyncio.create_task(_zone_stream_loop())
    simulation_task = asyncio.create_task(_simulation_stream_loop())
    yield
    stream_task.cancel()
    simulation_task.cancel()
    for task in (stream_task, simulation_task):
        try:
            await task
        except asyncio.CancelledError:
            pass


app = FastAPI(title="GridFlex AI", version="0.6.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(init_router(simulator))


@app.get("/")
def root():
    """API has no UI — dashboard runs on Vite (port 5174)."""
    return {
        "service": "gridflex-simulation-backend",
        "agent_mode": AGENT_MODE,
        "dashboard": "http://localhost:5174",
        "health": "/health",
        "demo_reset": "POST /demo/reset-playback",
        "hint": "Open the dashboard URL in your browser, not this API port.",
    }


@app.post("/demo/reset-playback")
def reset_demo_playback() -> dict:
    """Jump historical replay to spike hour so ward agents bid again."""
    sim = simulator.reset_demo_playback()
    return {
        "status": "ok",
        "playback_hour_index": HISTORICAL_PLAYBACK_START_INDEX,
        "sim": sim,
        "hint": "Refresh http://localhost:5174 — expect bids within ~10s",
    }


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "service": "gridflex-simulation-backend",
        "supply_agent": simulator.supply_agent.name,
        "streams": {
            "demand": f"/ws/demand ({len(demand_clients)} clients)",
            "supply": f"/ws/supply ({len(supply_clients)} clients)",
            "trades": f"/ws/trades ({len(trades_clients)} clients)",
            "issues": f"/ws/issues ({len(issues_clients)} clients)",
            "simulation": f"/ws/simulation/live ({len(simulation_clients)} clients)",
        },
        "zone_count": len(simulator.profiles),
        "zone_ids": [profile.zone_id for profile in simulator.profiles],
        "reporter_mode": REPORTER_MODE,
        "agent_mode": AGENT_MODE,
        "offline_mode": OFFLINE_MODE,
        "ml_service_url": ML_SERVICE_URL,
        "nim_model": NIM_MODEL,
        "nemoclaw_agent_id": NEMOCLAW_AGENT_ID,
        "sim_tick_sec": SIM_TICK_SEC,
    }


@app.get("/zones/registry")
def zones_registry() -> dict:
    return simulator.registry_snapshot()


@app.get("/zones/geojson")
def zones_geojson() -> FileResponse:
    if not WARDS_GEOJSON.exists():
        raise HTTPException(status_code=404, detail=f"Missing wards geojson: {WARDS_GEOJSON}")
    return FileResponse(WARDS_GEOJSON, media_type="application/geo+json")


@app.get("/zones/demand")
def zones_demand_snapshot() -> dict:
    demand_frame, _, _, _, _, _ = simulator.snapshot()
    return demand_frame


@app.get("/zones/supply")
def zones_supply_snapshot() -> dict:
    _, supply_frame, _, _, _, _ = simulator.snapshot()
    return supply_frame


@app.get("/zones/trades")
def zones_trades_snapshot() -> dict:
    _, _, trades_frame, _, _, _ = simulator.snapshot()
    return trades_frame


@app.get("/zones/issues")
def zones_issues_snapshot() -> dict:
    _, _, _, issues_frame, _, _ = simulator.snapshot()
    return issues_frame


@app.post("/zones/solve")
def zones_solve(body: SolveRequest) -> dict:
    demands = body.demands or simulator.simulate_demands()
    if body.budget is not None:
        simulator.supply_budget = body.budget

    _, supply_frame, trades_frame, issues_frame, decision, states = simulator.snapshot()
    capacity_by_zone = {state.zone_id: state for state in states}

    return {
        "ts": datetime.now(timezone.utc).isoformat(),
        "agent": decision.agent,
        "agent_note": decision.note,
        "supply": supply_frame,
        "trades": trades_frame,
        "issues": issues_frame,
        "zones": [
            {
                "zone_id": reading["zone_id"],
                "status": capacity_by_zone[reading["zone_id"]].status,
                **reading,
            }
            for reading in supply_frame["readings"]
        ],
    }


async def _accept_stream(
    websocket: WebSocket,
    clients: set[WebSocket],
    stream_name: str,
    initial_frame: dict,
) -> None:
    await websocket.accept()
    clients.add(websocket)
    logger.info("%s stream connected (%s clients)", stream_name, len(clients))

    await websocket.send_json(
        {
            "type": "connected",
            "stream": stream_name,
            "supply_agent": simulator.supply_agent.name,
            "zone_count": len(simulator.profiles),
            "zone_ids": [profile.zone_id for profile in simulator.profiles],
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    )
    await websocket.send_json(initial_frame)

    try:
        while True:
            message = await websocket.receive_text()
            if message == "ping":
                await websocket.send_json(
                    {
                        "type": "pong",
                        "stream": stream_name,
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    }
                )
    except WebSocketDisconnect:
        clients.discard(websocket)
        logger.info("%s stream disconnected (%s clients)", stream_name, len(clients))


@app.websocket("/ws/demand")
async def websocket_demand(websocket: WebSocket) -> None:
    demand_frame, _, _, _, _, _ = simulator.snapshot()
    await _accept_stream(websocket, demand_clients, "demand", demand_frame)


@app.websocket("/ws/supply")
async def websocket_supply(websocket: WebSocket) -> None:
    _, supply_frame, _, _, _, _ = simulator.snapshot()
    await _accept_stream(websocket, supply_clients, "supply", supply_frame)


@app.websocket("/ws/trades")
async def websocket_trades(websocket: WebSocket) -> None:
    _, _, trades_frame, _, _, _ = simulator.snapshot()
    await _accept_stream(websocket, trades_clients, "trades", trades_frame)


@app.websocket("/ws/issues")
async def websocket_issues(websocket: WebSocket) -> None:
    _, _, _, issues_frame, _, _ = simulator.snapshot()
    await _accept_stream(websocket, issues_clients, "issues", issues_frame)


@app.websocket("/ws/simulation/live")
async def websocket_simulation_live(websocket: WebSocket) -> None:
    await websocket.accept()
    simulation_clients.add(websocket)
    logger.info("Simulation stream connected (%s clients)", len(simulation_clients))

    await websocket.send_json(
        {
            "type": "connected",
            "stream": "simulation",
            "message": "GridFlex flex-market simulation stream ready",
            "zone_count": len(simulator.profiles),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    )

    try:
        result = await run_simulation_from_simulator(simulator)
        await websocket.send_json(to_tick_message(result).model_dump(mode="json"))
    except Exception:
        logger.exception("Initial simulation tick failed")

    try:
        while True:
            message = await websocket.receive_text()
            if message == "ping":
                result = await run_simulation_from_simulator(simulator)
                await websocket.send_json(to_tick_message(result).model_dump(mode="json"))
    except WebSocketDisconnect:
        simulation_clients.discard(websocket)
        logger.info("Simulation stream disconnected (%s clients)", len(simulation_clients))


@app.websocket("/ws/live")
async def websocket_live(websocket: WebSocket) -> None:
    await websocket.accept()
    live_clients.add(websocket)
    logger.info("Live stream connected (%s clients)", len(live_clients))

    await websocket.send_json(
        {
            "type": "connected",
            "message": "GridFlex live stream ready",
            "streams": ["demand", "supply", "trades", "issues"],
            "supply_agent": simulator.supply_agent.name,
            "zone_count": len(simulator.profiles),
            "zone_ids": [profile.zone_id for profile in simulator.profiles],
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    )

    try:
        while True:
            message = await websocket.receive_text()
            if message == "ping":
                demand_frame, supply_frame, trades_frame, issues_frame, _, _ = simulator.snapshot()
                await websocket.send_json(demand_frame)
                await websocket.send_json(supply_frame)
                await websocket.send_json(trades_frame)
                await websocket.send_json(issues_frame)
                await websocket.send_json(
                    {"type": "pong", "timestamp": datetime.now(timezone.utc).isoformat()}
                )
    except WebSocketDisconnect:
        live_clients.discard(websocket)
        logger.info("Live stream disconnected (%s clients)", len(live_clients))


async def broadcast(message: dict) -> None:
    await _broadcast(demand_clients, message)
    await _broadcast(supply_clients, message)
    await _broadcast(trades_clients, message)
    await _broadcast(issues_clients, message)
    await _broadcast(live_clients, message)
