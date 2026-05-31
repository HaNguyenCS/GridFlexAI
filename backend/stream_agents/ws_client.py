"""WebSocket subscribers for GridFlex backend streams."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

import websockets
from websockets.exceptions import ConnectionClosed

logger = logging.getLogger(__name__)


class StreamSubscription:
    """Maintains the latest frame from a single backend WebSocket stream."""

    def __init__(self, *, ws_base: str, path: str, name: str) -> None:
        self.ws_base = ws_base.rstrip("/")
        self.path = path if path.startswith("/") else f"/{path}"
        self.name = name
        self.url = f"{self.ws_base}{self.path}"
        self.latest: dict[str, Any] | None = None
        self.connected = False
        self._task: asyncio.Task | None = None
        self._stop = asyncio.Event()

    async def start(self) -> None:
        if self._task is not None:
            return
        self._stop.clear()
        self._task = asyncio.create_task(self._run_loop(), name=f"stream-{self.name}")

    async def stop(self) -> None:
        self._stop.set()
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        self.connected = False

    async def _run_loop(self) -> None:
        backoff_sec = 1.0
        while not self._stop.is_set():
            try:
                async with websockets.connect(self.url, ping_interval=20) as ws:
                    self.connected = True
                    backoff_sec = 1.0
                    logger.info("%s connected (%s)", self.name, self.url)
                    async for message in ws:
                        if self._stop.is_set():
                            break
                        self._handle_message(message)
            except ConnectionClosed:
                logger.warning("%s disconnected; reconnecting", self.name)
            except Exception:
                logger.exception("%s stream error; reconnecting in %.1fs", self.name, backoff_sec)
            finally:
                self.connected = False

            if self._stop.is_set():
                break
            await asyncio.sleep(backoff_sec)
            backoff_sec = min(backoff_sec * 1.5, 10.0)

    def _handle_message(self, message: str | bytes) -> None:
        try:
            data = json.loads(message)
        except json.JSONDecodeError:
            logger.debug("%s ignored non-JSON frame", self.name)
            return

        if data.get("type") == "connected":
            return
        if data.get("type") == "pong":
            return

        self.latest = data

    def ready(self) -> bool:
        return self.latest is not None

    @property
    def timestamp(self) -> str | None:
        if self.latest is None:
            return None
        return self.latest.get("ts")


class MultiStreamAgent:
    """Base class for agents that consume multiple WebSocket streams."""

    agent_id: str = "agent"
    stream_paths: tuple[str, ...] = ()

    def __init__(self, *, ws_base: str) -> None:
        self.ws_base = ws_base
        self.streams: dict[str, StreamSubscription] = {
            path: StreamSubscription(ws_base=ws_base, path=path, name=f"{self.agent_id}:{path}")
            for path in self.stream_paths
        }

    async def start(self) -> None:
        await asyncio.gather(*(stream.start() for stream in self.streams.values()))

    async def stop(self) -> None:
        await asyncio.gather(*(stream.stop() for stream in self.streams.values()))

    def ready(self) -> bool:
        return all(stream.ready() for stream in self.streams.values())

    def latest_timestamp(self) -> str | None:
        timestamps = [stream.timestamp for stream in self.streams.values() if stream.timestamp]
        return max(timestamps) if timestamps else None
