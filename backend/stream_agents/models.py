"""Shared context types for GridFlex stream agents."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class ZoneImbalance:
    zone_id: str
    demand_mw: float
    supply_mw: float
    unmet_mw: float
    over_capacity_mw: float
    status: str


@dataclass
class BalancerContext:
    timestamp: str | None
    total_unmet_mw: float
    fully_served: bool
    budget_remaining: float
    trade_count: int
    total_traded_mw: float
    active_spike_count: int
    imbalanced_zones: list[ZoneImbalance] = field(default_factory=list)
    raw: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "agent": "Balancer",
            "timestamp": self.timestamp,
            "total_unmet_mw": self.total_unmet_mw,
            "fully_served": self.fully_served,
            "budget_remaining": self.budget_remaining,
            "trade_count": self.trade_count,
            "total_traded_mw": self.total_traded_mw,
            "active_spike_count": self.active_spike_count,
            "imbalanced_zones": [
                {
                    "zone_id": z.zone_id,
                    "demand_mw": z.demand_mw,
                    "supply_mw": z.supply_mw,
                    "unmet_mw": z.unmet_mw,
                    "over_capacity_mw": z.over_capacity_mw,
                    "status": z.status,
                }
                for z in self.imbalanced_zones
            ],
        }


@dataclass
class TradeOpportunity:
    from_zone_id: str
    to_zone_id: str
    mw: float
    reason: str


@dataclass
class TraderContext:
    timestamp: str | None
    issue_count: int
    warning_count: int
    trade_count: int
    total_traded_mw: float
    critical_issues: list[dict[str, Any]] = field(default_factory=list)
    warnings: list[dict[str, Any]] = field(default_factory=list)
    recent_trades: list[dict[str, Any]] = field(default_factory=list)
    opportunities: list[TradeOpportunity] = field(default_factory=list)
    raw: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "agent": "Trader",
            "timestamp": self.timestamp,
            "issue_count": self.issue_count,
            "warning_count": self.warning_count,
            "trade_count": self.trade_count,
            "total_traded_mw": self.total_traded_mw,
            "critical_issues": self.critical_issues,
            "warnings": self.warnings,
            "recent_trades": self.recent_trades,
            "opportunities": [
                {
                    "from_zone_id": o.from_zone_id,
                    "to_zone_id": o.to_zone_id,
                    "mw": o.mw,
                    "reason": o.reason,
                }
                for o in self.opportunities
            ],
        }


@dataclass
class OrchestrationResult:
    tick: int
    timestamp: str | None
    balancer_action: str | None
    trader_action: str | None
    balancer_context: BalancerContext
    trader_context: TraderContext
    balancer_result: dict[str, Any] = field(default_factory=dict)
    trader_result: dict[str, Any] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "agent": "Orchestrator",
            "tick": self.tick,
            "timestamp": self.timestamp,
            "balancer_action": self.balancer_action,
            "trader_action": self.trader_action,
            "balancer_context": self.balancer_context.to_dict(),
            "trader_context": self.trader_context.to_dict(),
            "balancer_result": self.balancer_result,
            "trader_result": self.trader_result,
            "notes": self.notes,
        }
