"""Trader agent — monitors trades and issues streams."""

from __future__ import annotations

import logging
from typing import Any

from backend.stream_agents.models import TradeOpportunity, TraderContext
from backend.stream_agents.ws_client import MultiStreamAgent

logger = logging.getLogger(__name__)


class TraderAgent(MultiStreamAgent):
    agent_id = "Trader"
    stream_paths = ("/ws/trades", "/ws/issues")

    def __init__(self, *, ws_base: str) -> None:
        super().__init__(ws_base=ws_base)
        self.last_context: TraderContext | None = None
        self.last_result: dict[str, Any] = {}

    def build_context(self) -> TraderContext:
        trades = self.streams["/ws/trades"].latest or {}
        issues = self.streams["/ws/issues"].latest or {}

        issue_rows = list(issues.get("issues", []) or [])
        critical = [row for row in issue_rows if row.get("status") == "issue"]
        warnings = [row for row in issue_rows if row.get("status") == "warning"]
        recent_trades = list(trades.get("trades", []) or [])

        opportunities = self._suggest_opportunities(critical, recent_trades)

        context = TraderContext(
            timestamp=self.latest_timestamp(),
            issue_count=int(issues.get("issue_count", len(critical))),
            warning_count=int(issues.get("warning_count", len(warnings))),
            trade_count=int(trades.get("trade_count", len(recent_trades))),
            total_traded_mw=float(trades.get("total_traded_mw", 0.0)),
            critical_issues=critical,
            warnings=warnings,
            recent_trades=recent_trades,
            opportunities=opportunities,
            raw={"trades": trades, "issues": issues},
        )
        self.last_context = context
        return context

    def _suggest_opportunities(
        self,
        critical_issues: list[dict[str, Any]],
        recent_trades: list[dict[str, Any]],
    ) -> list[TradeOpportunity]:
        """Map capacity stress to follow-on trade ideas (advisory only)."""
        opportunities: list[TradeOpportunity] = []
        traded_to = {trade.get("to_zone_id") for trade in recent_trades}

        for issue in critical_issues:
            zone_id = issue.get("zone_id")
            over = float(issue.get("over_capacity", 0.0))
            if not zone_id or over <= 0:
                continue

            for trade in recent_trades:
                if trade.get("to_zone_id") != zone_id:
                    continue
                if zone_id in traded_to:
                    opportunities.append(
                        TradeOpportunity(
                            from_zone_id=str(trade.get("from_zone_id", "")),
                            to_zone_id=str(zone_id),
                            mw=round(float(trade.get("mw", 0.0)), 3),
                            reason="Existing trade may need upsizing for unresolved issue",
                        )
                    )
                    break
            else:
                opportunities.append(
                    TradeOpportunity(
                        from_zone_id="TBD",
                        to_zone_id=str(zone_id),
                        mw=round(over, 3),
                        reason="Critical over-capacity with no inbound trade yet",
                    )
                )

        return opportunities

    async def execute(self, action: str) -> dict[str, Any]:
        context = self.last_context or self.build_context()

        if action == "observe":
            result = {"action": action, "status": "ok", "message": "Monitoring only"}
            self.last_result = result
            return result

        if action == "escalate":
            if not context.critical_issues:
                result = {
                    "action": action,
                    "status": "skipped",
                    "message": "No critical issues to escalate",
                }
                self.last_result = result
                return result

            result = {
                "action": action,
                "status": "ok",
                "escalated_zones": [row.get("zone_id") for row in context.critical_issues],
                "messages": [row.get("message") for row in context.critical_issues],
                "opportunities": [opp.__dict__ for opp in context.opportunities],
            }
            logger.warning(
                "Trader escalated %s critical issue(s): %s",
                len(context.critical_issues),
                result["escalated_zones"],
            )
            self.last_result = result
            return result

        if action == "review_trades":
            result = {
                "action": action,
                "status": "ok",
                "trade_count": context.trade_count,
                "total_traded_mw": context.total_traded_mw,
                "recent_trades": context.recent_trades,
                "opportunities": [
                    {
                        "from_zone_id": opp.from_zone_id,
                        "to_zone_id": opp.to_zone_id,
                        "mw": opp.mw,
                        "reason": opp.reason,
                    }
                    for opp in context.opportunities
                ],
            }
            self.last_result = result
            return result

        result = {"action": action, "status": "skipped", "message": f"Unknown action: {action}"}
        self.last_result = result
        return result
