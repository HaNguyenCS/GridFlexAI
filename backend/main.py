import logging
from datetime import datetime, timezone

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="GridFlex AI", version="0.1.0")

# Connected clients list for WebSocket
clients: set[WebSocket] = set()


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "step": 1, "feature": "websocket"}


@app.websocket("/ws/live")
async def websocket_live(websocket: WebSocket) -> None:
    await websocket.accept()
    clients.add(websocket)
    logger.info("WebSocket connected (%s clients)", len(clients))

    await websocket.send_json(
        {
            "type": "connected",
            "message": "GridFlex live stream ready",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    )

    try:
        while True:
            message = await websocket.receive_text()
            if message == "ping":
                await websocket.send_json({"type": "pong", "timestamp": datetime.now(timezone.utc).isoformat()})
    except WebSocketDisconnect:
        clients.discard(websocket)
        logger.info("WebSocket disconnected (%s clients)", len(clients))


async def broadcast(message: dict) -> None:
    """Broadcast to all connected clients. Used in later steps for live IESO data."""
    dead: list[WebSocket] = []
    for ws in clients:
        try:
            await ws.send_json(message)
        except Exception:
            dead.append(ws)
    for ws in dead:
        clients.discard(ws)
