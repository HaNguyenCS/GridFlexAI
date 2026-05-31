import asyncio
import copy
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import httpx
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

    simulator = WardStreamSimulator(
        supply_budget=SUPPLY_BUDGET,
        supply_agent=NemoClawSupplyAgent(),
    )
elif AGENT_MODE == "llm":
    from backend.agents.llm_supply_agent import LLMSupplyAgent

    simulator = WardStreamSimulator(
        supply_budget=SUPPLY_BUDGET,
        supply_agent=LLMSupplyAgent(),
    )
else:
    simulator = WardStreamSimulator(supply_budget=SUPPLY_BUDGET)

if AGENT_MODE == "nemoclaw":
    SIM_TICK_SEC = NEMOCLAW_STREAM_INTERVAL_SEC
elif AGENT_MODE == "llm":
    SIM_TICK_SEC = LLM_STREAM_INTERVAL_SEC
else:
    SIM_TICK_SEC = STREAM_INTERVAL_SEC

# Slower product demo cadence. Normal live mode stays fast.
STRESS_DEMO_TICK_SEC = 4.0

demand_clients: set[WebSocket] = set()
supply_clients: set[WebSocket] = set()
trades_clients: set[WebSocket] = set()
issues_clients: set[WebSocket] = set()
live_clients: set[WebSocket] = set()
simulation_clients: set[WebSocket] = set()

stress_mode_enabled = False
stress_mode_tick = 0


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


async def _run_stress_simulation_tick() -> dict:
    """
    Runs the stress simulator route and returns the full final simulation result.
    The websocket loop phases this result into a product demo story.
    """
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post("http://127.0.0.1:8080/simulation/stress-demo")
        response.raise_for_status()
        return response.json()


def _set_clearing_scores(message: dict, stress_before: int, stress_after: int) -> None:
    clearing = message["market_result"]["clearing_result"]
    clearing["stress_score_before"] = stress_before
    clearing["stress_score_after"] = stress_after


def _trim_market_result(message: dict, accepted_count: int, rejected_count: int = 0) -> None:
    market = message["market_result"]

    full_accepted = market.get("accepted_bids", [])
    full_rejected = market.get("rejected_bids", [])

    accepted = full_accepted[:accepted_count]
    rejected = full_rejected[:rejected_count]

    market["accepted_bids"] = accepted
    market["rejected_bids"] = rejected

    accepted_mw = round(sum(float(bid.get("quantity_mw", 0.0)) for bid in accepted), 2)
    target = float(market["clearing_result"].get("target_reduction_mw", 0.0))

    market["clearing_result"]["accepted_reduction_mw"] = accepted_mw
    market["clearing_result"]["unfilled_reduction_mw"] = round(max(0.0, target - accepted_mw), 2)

    if accepted_mw <= 0:
        market["clearing_result"]["clearing_status"] = "pending"
        market["clearing_result"]["clearing_price_per_mwh"] = 0.0
    elif accepted_mw < target:
        market["clearing_result"]["clearing_status"] = "partial"
        market["clearing_result"]["clearing_price_per_mwh"] = max(
            float(bid.get("price_per_mwh", 0.0)) for bid in accepted
        )
    else:
        market["clearing_result"]["clearing_status"] = "cleared"
        market["clearing_result"]["clearing_price_per_mwh"] = max(
            float(bid.get("price_per_mwh", 0.0)) for bid in accepted
        )


def _phase_reporter(message: dict, phase_name: str, stress_after: int) -> None:
    reporter = message.get("reporter")
    if not reporter:
        return

    alert = reporter.get("alert")
    if not alert:
        return

    clearing = message["market_result"]["clearing_result"]
    submitted_count = len(message.get("submitted_bids", []))
    accepted_count = len(message["market_result"].get("accepted_bids", []))
    accepted_mw = clearing.get("accepted_reduction_mw", 0)
    target = message["grid_prediction"].get("target_reduction_mw", 650)

    severity = "critical"
    if stress_after < 70:
        severity = "medium"
    if stress_after < 45:
        severity = "normal"

    alert["title"] = f"Grid stress {severity.upper()} — {phase_name}"
    alert["severity"] = severity
    alert["summary"] = (
        f"Stress score moving through simulation: current projected score {stress_after}. "
        f"Target {target} MW; {submitted_count} submitted bids; "
        f"{accepted_count} accepted bids; {accepted_mw} MW cleared."
    )

    if phase_name == "stress rising":
        alert["market_action"] = "Monitoring rapid load growth before market activation."
    elif phase_name == "critical event spreading":
        alert["market_action"] = "Critical event spreading across wards. Forecast agent is being activated."
    elif phase_name == "forecasting":
        alert["market_action"] = "Forecast agent estimates required flexibility. Ward agents preparing bids."
    elif phase_name == "ward bidding":
        alert["market_action"] = "Ward agents are submitting flexibility bids."
    elif phase_name == "market clearing":
        alert["market_action"] = "Market clearing agent is ranking and accepting bids."
    elif phase_name == "dispatching flexibility":
        alert["market_action"] = "Accepted flexibility bids are being dispatched."
    elif phase_name == "grid recovery":
        alert["market_action"] = "Stress is falling as accepted flexibility takes effect."
    else:
        alert["market_action"] = "Grid stabilized after agent-market coordination."

    alert["impact"] = "Live stress simulator phase: " + phase_name
    alert["operator_note"] = "GridFlex stress simulation is streaming incrementally through the agent-market pipeline."


def _phase_stress_message(full_message: dict, tick: int) -> dict:
    """
    Convert the full final stress-demo response into an incremental websocket tick.

    Demo story:
    1. Wards become stressed one by one.
    2. Forecast agent identifies critical system risk.
    3. Ward agents submit bids progressively.
    4. Market clearing accepts bids progressively.
    5. Accepted/recovered wards turn green one by one.
    """
    message = copy.deepcopy(full_message)

    message.setdefault("snapshot", {})
    message["snapshot"]["stress_mode_enabled"] = True
    message["snapshot"]["stress_mode_tick"] = tick
    message["snapshot"]["agent_mode"] = "stress_simulator_live"

    full_submitted = message.get("submitted_bids", [])
    full_accepted = message["market_result"].get("accepted_bids", [])

    # Remove blue dispatch flow lines from the product demo.
    message["kepler_flows"] = []

    total_wards = len(message.get("kepler_nodes", [])) or 25

    if tick <= 3:
        phase_name = "stress rising"
        stress_before = 34
        stress_after = min(62, 46 + tick * 4)
        risk_level = "medium"
        target_mw = 0
        red_count = min(total_wards, tick * 3)
        submitted_count = 0
        accepted_count = 0
        green_count = 0

    elif tick <= 6:
        phase_name = "critical event spreading"
        stress_before = 58
        stress_after = min(84, 62 + (tick - 3) * 7)
        risk_level = "high"
        target_mw = 250
        red_count = min(total_wards, 9 + (tick - 3) * 5)
        submitted_count = 0
        accepted_count = 0
        green_count = 0

    elif tick <= 9:
        phase_name = "forecasting"
        stress_before = 76
        stress_after = min(94, 82 + (tick - 6) * 4)
        risk_level = "critical"
        target_mw = 650
        red_count = total_wards
        submitted_count = 0
        accepted_count = 0
        green_count = 0

    elif tick <= 16:
        phase_name = "ward bidding"
        stress_before = 94
        stress_after = 94
        risk_level = "critical"
        target_mw = 650
        red_count = total_wards
        submitted_count = min(len(full_submitted), max(1, (tick - 9) * 4))
        accepted_count = 0
        green_count = 0

    elif tick <= 23:
        phase_name = "market clearing"
        stress_before = 94
        stress_after = max(78, 94 - (tick - 16) * 2)
        risk_level = "critical" if stress_after >= 85 else "high"
        target_mw = 650
        red_count = total_wards
        submitted_count = len(full_submitted)
        accepted_count = min(len(full_accepted), max(1, (tick - 16) * 4))
        green_count = 0

    elif tick <= 31:
        phase_name = "dispatching flexibility"
        stress_before = 94
        stress_after = max(58, 80 - (tick - 23) * 3)
        risk_level = "high" if stress_after >= 70 else "medium"
        target_mw = 650
        submitted_count = len(full_submitted)
        accepted_count = len(full_accepted)
        green_count = min(len(full_accepted), max(1, (tick - 23) * 3))
        red_count = max(0, total_wards - green_count)

    elif tick <= 39:
        phase_name = "grid recovery"
        stress_before = 94
        stress_after = max(42, 58 - (tick - 31) * 2)
        risk_level = "medium" if stress_after >= 50 else "normal"
        target_mw = 650
        submitted_count = len(full_submitted)
        accepted_count = len(full_accepted)
        green_count = min(len(full_accepted), max(1, 24 + (tick - 31)))
        red_count = max(0, total_wards - green_count)

    else:
        phase_name = "stabilized"
        stress_before = 94
        stress_after = 38
        risk_level = "normal"
        target_mw = 650
        submitted_count = len(full_submitted)
        accepted_count = len(full_accepted)
        green_count = len(full_accepted)
        red_count = 0

    message["grid_prediction"]["risk_level"] = risk_level
    message["grid_prediction"]["target_reduction_mw"] = target_mw

    if phase_name == "stress rising":
        message["grid_prediction"]["event_type"] = "normal"
        message["grid_prediction"]["grid_stress_probability"] = 0.45
    elif phase_name == "critical event spreading":
        message["grid_prediction"]["event_type"] = "outage_risk"
        message["grid_prediction"]["grid_stress_probability"] = 0.78
    else:
        message["grid_prediction"]["event_type"] = "demand_spike"
        message["grid_prediction"]["grid_stress_probability"] = 0.99

    message["grid_prediction"]["drivers"] = [
        f"Stress simulator phase: {phase_name}",
        "Toronto demand is rising faster than available local flexibility.",
        "Ward agents coordinate demand reduction through the market.",
    ]

    message["submitted_bids"] = full_submitted[:submitted_count]
    _trim_market_result(message, accepted_count=accepted_count)
    _set_clearing_scores(message, stress_before=stress_before, stress_after=stress_after)

    clearing = message["market_result"]["clearing_result"]
    clearing["target_reduction_mw"] = target_mw

    if target_mw == 0:
        clearing["accepted_reduction_mw"] = 0.0
        clearing["unfilled_reduction_mw"] = 0.0
        clearing["clearing_status"] = "monitoring"
        clearing["clearing_price_per_mwh"] = 0.0

    accepted_by_ward = {
        bid["ward_id"]: bid
        for bid in message["market_result"].get("accepted_bids", [])
    }

    green_ward_ids = {
        bid["ward_id"]
        for bid in full_accepted[:green_count]
    }

    submitted_ward_ids = {
        bid["ward_id"]
        for bid in full_submitted[:submitted_count]
    }

    nodes = message.get("kepler_nodes", [])

    for index, node in enumerate(nodes):
        ward_id = node.get("ward_id")

        node["dispatch_status"] = "none"
        node["accepted_bid_mw"] = 0.0

        # Before stress reaches this ward, keep it normal.
        if index >= red_count and ward_id not in green_ward_ids:
            node["risk_level"] = "normal"
            node["recommended_action"] = "none"
            node["recommended_bid_mw"] = 0.0
            continue

        # Wards turn red/orange one by one as stress spreads.
        if phase_name in (
            "stress rising",
            "critical event spreading",
            "forecasting",
            "ward bidding",
        ):
            if index < red_count:
                node["risk_level"] = "high" if phase_name == "stress rising" else "critical"

                if ward_id in submitted_ward_ids:
                    node["recommended_action"] = "reduce_load"
                elif phase_name == "ward bidding":
                    node["recommended_action"] = "evaluate_bid"
                else:
                    node["recommended_action"] = "none"

            continue

        # Market clearing identifies accepted bids, but wards are not green yet.
        if phase_name == "market clearing":
            if ward_id in accepted_by_ward:
                node["risk_level"] = "high"
                node["dispatch_status"] = "accepted"
                node["accepted_bid_mw"] = accepted_by_ward[ward_id].get("quantity_mw", 0.0)
                node["recommended_action"] = "reduce_load"
            else:
                node["risk_level"] = "critical"
                node["dispatch_status"] = "none"
                node["accepted_bid_mw"] = 0.0
            continue

        # Recovery turns accepted wards green one by one.
        if phase_name in ("dispatching flexibility", "grid recovery", "stabilized"):
            if ward_id in green_ward_ids:
                node["risk_level"] = "normal"
                node["dispatch_status"] = "recovered"
                node["accepted_bid_mw"] = accepted_by_ward.get(ward_id, {}).get("quantity_mw", 0.0)
                node["recommended_action"] = "stabilized"
            elif ward_id in accepted_by_ward:
                node["risk_level"] = "medium"
                node["dispatch_status"] = "accepted"
                node["accepted_bid_mw"] = accepted_by_ward[ward_id].get("quantity_mw", 0.0)
                node["recommended_action"] = "reduce_load"
            else:
                node["risk_level"] = "high"
                node["dispatch_status"] = "none"
                node["accepted_bid_mw"] = 0.0

    message["snapshot"]["stress_phase"] = phase_name
    message["snapshot"]["stress_red_wards"] = red_count
    message["snapshot"]["stress_green_wards"] = green_count
    message["snapshot"]["pipeline"] = {
        "forecast": {
            "stress_score": stress_after,
            "target_reduction_mw": target_mw,
            "risk_level": risk_level,
            "ward_predictions": total_wards if tick > 3 else red_count,
            "phase": phase_name,
        },
        "ward_agents": {
            "total": total_wards,
            "submitted": submitted_count,
            "idle": max(0, total_wards - submitted_count),
            "phase": phase_name,
        },
        "market_clearing": {
            "status": clearing.get("clearing_status"),
            "accepted_bids": accepted_count,
            "rejected_bids": len(message["market_result"].get("rejected_bids", [])),
            "accepted_mw": clearing.get("accepted_reduction_mw"),
            "unfilled_mw": clearing.get("unfilled_reduction_mw"),
            "clearing_price_per_mwh": clearing.get("clearing_price_per_mwh"),
            "stress_before": stress_before,
            "stress_after": stress_after,
            "phase": phase_name,
        },
        "dispatch": {
            "flows": 0,
            "wards_accepted": accepted_count,
            "wards_recovered": green_count,
            "wards_rejected": len(message["market_result"].get("rejected_bids", [])),
            "phase": phase_name,
        },
    }

    _phase_reporter(message, phase_name=phase_name, stress_after=stress_after)

    return message


async def _simulation_stream_loop() -> None:
    global stress_mode_tick

    while True:
        if simulation_clients:
            try:
                if stress_mode_enabled:
                    full_message = await _run_stress_simulation_tick()

                    stress_mode_tick += 1
                    message = _phase_stress_message(full_message, stress_mode_tick)

                    await _broadcast(simulation_clients, message)

                    logger.info(
                        "Broadcast STRESS simulation tick (%s clients, tick=%s, phase=%s, stress %s→%s, bids=%s, accepted=%s, recovered=%s, flows=%s)",
                        len(simulation_clients),
                        stress_mode_tick,
                        message["snapshot"].get("stress_phase"),
                        message["market_result"]["clearing_result"]["stress_score_before"],
                        message["market_result"]["clearing_result"]["stress_score_after"],
                        len(message.get("submitted_bids", [])),
                        len(message["market_result"].get("accepted_bids", [])),
                        message["snapshot"].get("stress_green_wards", 0),
                        len(message.get("kepler_flows", [])),
                    )
                else:
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

        await asyncio.sleep(STRESS_DEMO_TICK_SEC if stress_mode_enabled else SIM_TICK_SEC)


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
    return {
        "service": "gridflex-simulation-backend",
        "agent_mode": AGENT_MODE,
        "dashboard": "http://localhost:5174",
        "health": "/health",
        "demo_reset": "POST /demo/reset-playback",
        "stress_mode_start": "POST /simulation/stress-mode/start",
        "stress_mode_stop": "POST /simulation/stress-mode/stop",
        "hint": "Open the dashboard URL in your browser, not this API port.",
    }


@app.post("/demo/reset-playback")
def reset_demo_playback() -> dict:
    sim = simulator.reset_demo_playback()

    return {
        "status": "ok",
        "playback_hour_index": HISTORICAL_PLAYBACK_START_INDEX,
        "sim": sim,
        "hint": "Refresh http://localhost:5174. Expect bids within a few seconds.",
    }


@app.post("/simulation/stress-mode/start")
def start_stress_mode() -> dict:
    global stress_mode_enabled, stress_mode_tick

    stress_mode_enabled = True
    stress_mode_tick = 0

    return {
        "status": "ok",
        "stress_mode_enabled": stress_mode_enabled,
        "message": "Stress simulator live mode started. /ws/simulation/live will broadcast phased stress ticks.",
    }


@app.post("/simulation/stress-mode/stop")
def stop_stress_mode() -> dict:
    global stress_mode_enabled

    stress_mode_enabled = False

    return {
        "status": "ok",
        "stress_mode_enabled": stress_mode_enabled,
        "message": "Stress simulator live mode stopped. Returning to normal simulation stream.",
    }


@app.get("/simulation/stress-mode/status")
def stress_mode_status() -> dict:
    return {
        "stress_mode_enabled": stress_mode_enabled,
        "stress_mode_tick": stress_mode_tick,
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
        "stress_demo_tick_sec": STRESS_DEMO_TICK_SEC,
        "stress_mode_enabled": stress_mode_enabled,
        "stress_mode_tick": stress_mode_tick,
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
            "stress_mode_enabled": stress_mode_enabled,
        }
    )

    try:
        if stress_mode_enabled:
            full_message = await _run_stress_simulation_tick()
            initial_message = _phase_stress_message(full_message, stress_mode_tick)
            await websocket.send_json(initial_message)
        else:
            result = await run_simulation_from_simulator(simulator)
            await websocket.send_json(to_tick_message(result).model_dump(mode="json"))
    except Exception:
        logger.exception("Initial simulation tick failed")

    try:
        while True:
            message = await websocket.receive_text()

            if message == "ping":
                if stress_mode_enabled:
                    full_message = await _run_stress_simulation_tick()
                    result_message = _phase_stress_message(full_message, stress_mode_tick)
                    await websocket.send_json(result_message)
                else:
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