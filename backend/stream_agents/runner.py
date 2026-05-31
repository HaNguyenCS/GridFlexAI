"""Run Balancer, Trader, and Orchestrator against the GridFlex backend streams."""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import signal

from backend.stream_agents.balancer import BalancerAgent
from backend.stream_agents.orchestrator import OrchestratorAgent
from backend.stream_agents.trader import TraderAgent

logger = logging.getLogger(__name__)


def _env(name: str, default: str) -> str:
    return os.getenv(name, default).strip()


async def _wait_for_ready(
    balancer: BalancerAgent,
    trader: TraderAgent,
    *,
    timeout_sec: float = 15.0,
) -> bool:
    deadline = asyncio.get_running_loop().time() + timeout_sec
    while asyncio.get_running_loop().time() < deadline:
        if balancer.ready() and trader.ready():
            return True
        await asyncio.sleep(0.2)
    return balancer.ready() and trader.ready()


async def run(*, ws_base: str, api_base: str, interval_sec: float, once: bool) -> None:
    balancer = BalancerAgent(ws_base=ws_base, api_base=api_base)
    trader = TraderAgent(ws_base=ws_base)
    orchestrator = OrchestratorAgent(balancer=balancer, trader=trader)

    stop = asyncio.Event()

    def _handle_stop(*_args: object) -> None:
        stop.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, _handle_stop)
        except NotImplementedError:
            pass

    await balancer.start()
    await trader.start()

    logger.info(
        "Stream agents started (ws=%s api=%s interval=%ss)",
        ws_base,
        api_base,
        interval_sec,
    )
    logger.info(
        "Balancer streams: %s",
        ", ".join(balancer.stream_paths),
    )
    logger.info(
        "Trader streams: %s",
        ", ".join(trader.stream_paths),
    )

    if not await _wait_for_ready(balancer, trader):
        logger.warning("Not all streams ready after timeout; continuing with partial data")

    try:
        while not stop.is_set():
            result = await orchestrator.run_once()
            print(json.dumps(result.to_dict(), indent=2), flush=True)

            if once:
                break

            try:
                await asyncio.wait_for(stop.wait(), timeout=interval_sec)
            except asyncio.TimeoutError:
                continue
    finally:
        await balancer.stop()
        await trader.stop()
        logger.info("Stream agents stopped")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="GridFlex stream agents: Balancer, Trader, Orchestrator",
    )
    parser.add_argument(
        "--ws-base",
        default=_env("GRIDFLEX_WS_URL", "ws://127.0.0.1:8000"),
        help="WebSocket base URL (default: GRIDFLEX_WS_URL or ws://127.0.0.1:8000)",
    )
    parser.add_argument(
        "--api-base",
        default=_env("GRIDFLEX_API_URL", "http://127.0.0.1:8000"),
        help="REST API base URL (default: GRIDFLEX_API_URL or http://127.0.0.1:8000)",
    )
    parser.add_argument(
        "--interval",
        type=float,
        default=float(_env("ORCHESTRATOR_INTERVAL_SEC", "2")),
        help="Seconds between orchestration ticks (default: 2)",
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="Run a single orchestration tick then exit",
    )
    parser.add_argument(
        "--log-level",
        default=_env("STREAM_AGENTS_LOG_LEVEL", "INFO"),
        help="Logging level (default: INFO)",
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=getattr(logging, args.log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )

    asyncio.run(
        run(
            ws_base=args.ws_base,
            api_base=args.api_base,
            interval_sec=args.interval,
            once=args.once,
        )
    )


if __name__ == "__main__":
    main()
