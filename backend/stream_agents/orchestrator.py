"""Orchestrator agent — coordinates Balancer and Trader from their stream context."""

from __future__ import annotations

import logging
from typing import Any

from backend.stream_agents.balancer import BalancerAgent
from backend.stream_agents.models import OrchestrationResult
from backend.stream_agents.trader import TraderAgent

logger = logging.getLogger(__name__)


class OrchestratorAgent:
    agent_id = "Orchestrator"

    def __init__(self, *, balancer: BalancerAgent, trader: TraderAgent) -> None:
        self.balancer = balancer
        self.trader = trader
        self.tick = 0
        self.last_result: OrchestrationResult | None = None

    async def run_once(self) -> OrchestrationResult:
        self.tick += 1
        notes: list[str] = []
        balancer_action: str | None = None
        trader_action: str | None = None
        balancer_result: dict[str, Any] = {}
        trader_result: dict[str, Any] = {}

        if not self.balancer.ready() or not self.trader.ready():
            context_b = self.balancer.build_context() if self.balancer.streams["/ws/demand"].ready() else None
            context_t = self.trader.build_context() if self.trader.streams["/ws/trades"].ready() else None
            result = OrchestrationResult(
                tick=self.tick,
                timestamp=None,
                balancer_action=None,
                trader_action=None,
                balancer_context=context_b or self._empty_balancer_context(),
                trader_context=context_t or self._empty_trader_context(),
                notes=["Waiting for all WebSocket streams to deliver first frame"],
            )
            self.last_result = result
            return result

        balancer_context = self.balancer.build_context()
        trader_context = self.trader.build_context()
        timestamp = balancer_context.timestamp or trader_context.timestamp

        # Critical grid issues take priority — Trader escalates first.
        if trader_context.critical_issues:
            trader_action = "escalate"
            notes.append(
                f"Trader escalates {len(trader_context.critical_issues)} critical issue(s) first"
            )
            trader_result = await self.trader.execute(trader_action)

        if trader_context.trade_count > 0 and not trader_context.critical_issues:
            trader_action = trader_action or "review_trades"
            notes.append("Trader reviewing active capacity trades")
            trader_result = await self.trader.execute("review_trades")

        needs_rebalance = (
            not balancer_context.fully_served
            or balancer_context.total_unmet_mw > 0
            or bool(balancer_context.imbalanced_zones)
            or balancer_context.active_spike_count > 0
        )

        if needs_rebalance:
            balancer_action = "rebalance"
            notes.append(
                f"Balancer rebalancing (unmet={balancer_context.total_unmet_mw:.2f} MW, "
                f"spikes={balancer_context.active_spike_count})"
            )
            balancer_result = await self.balancer.execute(balancer_action)
        else:
            balancer_action = "observe"
            notes.append("Grid balanced; Balancer observing")
            balancer_result = await self.balancer.execute("observe")

        if trader_action is None:
            trader_action = "observe"
            notes.append("No trade or issue activity; Trader observing")
            trader_result = await self.trader.execute("observe")

        result = OrchestrationResult(
            tick=self.tick,
            timestamp=timestamp,
            balancer_action=balancer_action,
            trader_action=trader_action,
            balancer_context=balancer_context,
            trader_context=trader_context,
            balancer_result=balancer_result,
            trader_result=trader_result,
            notes=notes,
        )
        self.last_result = result
        logger.info(
            "Orchestrator tick %s: Balancer=%s Trader=%s ts=%s",
            self.tick,
            balancer_action,
            trader_action,
            timestamp,
        )
        return result

    @staticmethod
    def _empty_balancer_context():
        from backend.stream_agents.models import BalancerContext

        return BalancerContext(
            timestamp=None,
            total_unmet_mw=0.0,
            fully_served=True,
            budget_remaining=0.0,
            trade_count=0,
            total_traded_mw=0.0,
            active_spike_count=0,
        )

    @staticmethod
    def _empty_trader_context():
        from backend.stream_agents.models import TraderContext

        return TraderContext(
            timestamp=None,
            issue_count=0,
            warning_count=0,
            trade_count=0,
            total_traded_mw=0.0,
        )
