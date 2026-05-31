"""Balancer agent — monitors demand, supply, and trades streams."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from backend.stream_agents.models import BalancerContext, ZoneImbalance
from backend.stream_agents.ws_client import MultiStreamAgent

logger = logging.getLogger(__name__)

UNMET_THRESHOLD_MW = 0.5


class BalancerAgent(MultiStreamAgent):
    agent_id = "Balancer"
    stream_paths = ("/ws/demand", "/ws/supply", "/ws/trades")

    def __init__(self, *, ws_base: str, api_base: str) -> None:
        super().__init__(ws_base=ws_base)
        self.api_base = api_base.rstrip("/")
        self.last_context: BalancerContext | None = None
        self.last_result: dict[str, Any] = {}

    def build_context(self) -> BalancerContext:
        demand = self.streams["/ws/demand"].latest or {}
        supply = self.streams["/ws/supply"].latest or {}
        trades = self.streams["/ws/trades"].latest or {}

        demand_by_zone = {
            row["zone_id"]: row for row in demand.get("readings", []) if "zone_id" in row
        }
        supply_by_zone = {
            row["zone_id"]: row for row in supply.get("readings", []) if "zone_id" in row
        }

        imbalanced: list[ZoneImbalance] = []
        for zone_id, demand_row in demand_by_zone.items():
            supply_row = supply_by_zone.get(zone_id, {})
            demand_mw = float(demand_row.get("demand", 0.0))
            supply_mw = float(supply_row.get("supply", demand_mw))
            unmet_mw = float(supply_row.get("unmet_demand", max(0.0, demand_mw - supply_mw)))
            over_capacity_mw = float(demand_row.get("over_capacity", 0.0))
            status = str(supply_row.get("status") or demand_row.get("status") or "ok")

            if unmet_mw >= UNMET_THRESHOLD_MW or over_capacity_mw > 0 or status != "ok":
                imbalanced.append(
                    ZoneImbalance(
                        zone_id=zone_id,
                        demand_mw=demand_mw,
                        supply_mw=supply_mw,
                        unmet_mw=unmet_mw,
                        over_capacity_mw=over_capacity_mw,
                        status=status,
                    )
                )

        imbalanced.sort(key=lambda row: row.unmet_mw, reverse=True)

        context = BalancerContext(
            timestamp=self.latest_timestamp(),
            total_unmet_mw=float(supply.get("total_unmet_mw", 0.0)),
            fully_served=bool(supply.get("fully_served", True)),
            budget_remaining=float(supply.get("budget_remaining", 0.0)),
            trade_count=int(trades.get("trade_count", 0)),
            total_traded_mw=float(trades.get("total_traded_mw", 0.0)),
            active_spike_count=len(demand.get("active_spikes", []) or []),
            imbalanced_zones=imbalanced,
            raw={"demand": demand, "supply": supply, "trades": trades},
        )
        self.last_context = context
        return context

    async def execute(self, action: str) -> dict[str, Any]:
        context = self.last_context or self.build_context()

        if action == "observe":
            result = {"action": action, "status": "ok", "message": "Monitoring only"}
            self.last_result = result
            return result

        if action != "rebalance":
            result = {"action": action, "status": "skipped", "message": f"Unknown action: {action}"}
            self.last_result = result
            return result

        if context.fully_served and not context.imbalanced_zones:
            result = {
                "action": action,
                "status": "skipped",
                "message": "Grid fully served; no rebalance needed",
            }
            self.last_result = result
            return result

        demands = {
            row.zone_id: row.demand_mw
            for row in context.imbalanced_zones
            if row.demand_mw > 0
        }

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    f"{self.api_base}/zones/solve",
                    json={"demands": demands or None},
                )
                response.raise_for_status()
                payload = response.json()
        except Exception as exc:
            logger.exception("Balancer rebalance failed")
            result = {"action": action, "status": "error", "message": str(exc)}
            self.last_result = result
            return result

        result = {
            "action": action,
            "status": "ok",
            "total_unmet_mw": payload.get("supply", {}).get("total_unmet_mw"),
            "fully_served": payload.get("supply", {}).get("fully_served"),
            "trade_count": payload.get("trades", {}).get("trade_count"),
            "agent_note": payload.get("agent_note"),
        }
        logger.info(
            "Balancer rebalanced: unmet=%s served=%s trades=%s",
            result.get("total_unmet_mw"),
            result.get("fully_served"),
            result.get("trade_count"),
        )
        self.last_result = result
        return result
