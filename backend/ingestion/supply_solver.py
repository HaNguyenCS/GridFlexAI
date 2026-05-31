"""
Minimum-cost supply allocation under per-zone fixed marginal costs.

Given simulated demand per ward and a supply budget, allocate incremental
supply starting with the cheapest zones until demand is met or budget runs out.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ZoneEconomics:
    zone_id: str
    demand_mw: float
    baseline_supply_mw: float
    supply_cost_per_mw: float


@dataclass(frozen=True)
class SupplyAllocation:
    zone_id: str
    demand_mw: float
    baseline_supply_mw: float
    supply_mw: float
    unmet_demand_mw: float
    incremental_mw: float
    incremental_cost: float
    supply_cost_per_mw: float


@dataclass(frozen=True)
class SupplySolution:
    allocations: list[SupplyAllocation]
    total_demand_mw: float
    total_supply_mw: float
    total_unmet_mw: float
    total_cost: float
    budget: float
    budget_remaining: float
    fully_served: bool


def solve_supply(
    zones: list[ZoneEconomics],
    *,
    budget: float,
) -> SupplySolution:
    """
    Greedy minimum-cost allocation.

    1. Each zone starts at baseline_supply_mw.
    2. Remaining deficit is max(0, demand - baseline).
    3. Fill deficits from lowest supply_cost_per_mw first until budget is spent.
    """
    remaining_budget = budget
    incremental: dict[str, float] = {zone.zone_id: 0.0 for zone in zones}

    deficits = []
    for zone in zones:
        deficit = max(0.0, zone.demand_mw - zone.baseline_supply_mw)
        if deficit > 0:
            deficits.append((zone.zone_id, deficit, zone.supply_cost_per_mw))

    deficits.sort(key=lambda item: item[2])

    for zone_id, deficit, cost in deficits:
        if remaining_budget <= 0:
            break
        affordable_mw = remaining_budget / cost
        add_mw = min(deficit, affordable_mw)
        if add_mw <= 0:
            continue
        incremental[zone_id] += add_mw
        remaining_budget -= add_mw * cost

    allocations: list[SupplyAllocation] = []
    total_demand = 0.0
    total_supply = 0.0
    total_unmet = 0.0
    total_cost = 0.0

    for zone in zones:
        add_mw = incremental[zone.zone_id]
        supply_mw = zone.baseline_supply_mw + add_mw
        unmet = max(0.0, zone.demand_mw - supply_mw)
        inc_cost = add_mw * zone.supply_cost_per_mw

        allocations.append(
            SupplyAllocation(
                zone_id=zone.zone_id,
                demand_mw=round(zone.demand_mw, 3),
                baseline_supply_mw=round(zone.baseline_supply_mw, 3),
                supply_mw=round(supply_mw, 3),
                unmet_demand_mw=round(unmet, 3),
                incremental_mw=round(add_mw, 3),
                incremental_cost=round(inc_cost, 2),
                supply_cost_per_mw=zone.supply_cost_per_mw,
            )
        )
        total_demand += zone.demand_mw
        total_supply += supply_mw
        total_unmet += unmet
        total_cost += inc_cost

    return SupplySolution(
        allocations=sorted(allocations, key=lambda row: row.zone_id),
        total_demand_mw=round(total_demand, 3),
        total_supply_mw=round(total_supply, 3),
        total_unmet_mw=round(total_unmet, 3),
        total_cost=round(total_cost, 2),
        budget=budget,
        budget_remaining=round(remaining_budget, 2),
        fully_served=total_unmet <= 0.001,
    )
