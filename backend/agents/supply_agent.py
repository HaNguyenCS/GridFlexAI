"""
Supply-side agent interface for GridFlex.

The supply agent decides:
  1. Inter-ward capacity trades
  2. Incremental grid supply (future: budget-backed upgrades)

Swap `DefaultCapacityAgent` for a LangGraph agent when ready.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

from backend.ingestion.capacity_market import (
    CapacityMarketResult,
    CapacityTrade,
    ZoneCapacityLedger,
    match_capacity_trades,
)
from backend.ingestion.supply_solver import SupplySolution, ZoneEconomics, solve_supply


@dataclass(frozen=True)
class ZoneMarketSnapshot:
    zone_id: str
    ward_name: str
    demand_mw: float
    owned_capacity_mw: float
    baseline_supply_mw: float
    supply_cost_per_mw: float
    over_capacity_sec: float = 0.0
    status: str = "ok"


@dataclass(frozen=True)
class SupplyContext:
    ts: str
    zones: list[ZoneMarketSnapshot]
    budget: float
    transfer_price_per_mw: float
    active_issues: list[dict] = field(default_factory=list)


@dataclass
class SupplyDecision:
    trades: list[CapacityTrade] = field(default_factory=list)
    market: CapacityMarketResult | None = None
    grid_solution: SupplySolution | None = None
    agent: str = "unknown"
    note: str = ""


class SupplyAgent(Protocol):
    name: str

    def decide(self, context: SupplyContext) -> SupplyDecision:
        """Return capacity trades and optional grid supply for this tick."""


class DefaultCapacityAgent:
    """
    Placeholder agent until LangGraph supply control is wired in.

    Step 1 — match ward-to-ward capacity trades.
    Step 2 — spend remaining budget on cheapest incremental grid MW for
              zones still in deficit after trades.
    """

    name = "default_capacity_agent"

    def decide(self, context: SupplyContext) -> SupplyDecision:
        ledgers = [
            ZoneCapacityLedger(
                zone_id=zone.zone_id,
                owned_capacity_mw=zone.owned_capacity_mw,
                demand_mw=zone.demand_mw,
            )
            for zone in context.zones
        ]
        market = match_capacity_trades(
            ledgers,
            transfer_price_per_mw=context.transfer_price_per_mw,
        )

        zone_by_id = {zone.zone_id: zone for zone in context.zones}
        remaining_budget = max(0.0, context.budget - market.total_trade_cost)

        economics: list[ZoneEconomics] = []
        for zone in context.zones:
            effective_capacity = market.effective_capacity_mw[zone.zone_id]
            post_trade_deficit = max(0.0, zone.demand_mw - effective_capacity)
            economics.append(
                ZoneEconomics(
                    zone_id=zone.zone_id,
                    demand_mw=zone.demand_mw,
                    baseline_supply_mw=min(zone.baseline_supply_mw, effective_capacity),
                    supply_cost_per_mw=zone.supply_cost_per_mw,
                )
            )

        grid_solution = solve_supply(economics, budget=remaining_budget)

        issue_zones = {item["zone_id"] for item in context.active_issues}
        traded_to_issues = sum(
            1 for trade in market.trades if trade.to_zone_id in issue_zones
        )

        return SupplyDecision(
            trades=market.trades,
            market=market,
            grid_solution=grid_solution,
            agent=self.name,
            note=(
                f"Matched {len(market.trades)} capacity trades "
                f"({market.total_traded_mw} MW). "
                f"{traded_to_issues} trades targeted stressed wards."
            ),
        )


def get_supply_agent(name: str = "default") -> SupplyAgent:
    agents: dict[str, SupplyAgent] = {
        "default": DefaultCapacityAgent(),
    }
    if name not in agents:
        raise ValueError(f"Unknown supply agent: {name}")
    return agents[name]
