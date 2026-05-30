"""
Simulate ward-level hydro demand and route supply through a pluggable agent.

Demand is simulated each tick. Supply (capacity trades + grid MW) is decided
by a SupplyAgent — swap in a LangGraph agent later via set_supply_agent().
"""

from __future__ import annotations

import json
import math
import random
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from backend.agents.supply_agent import (
    DefaultCapacityAgent,
    SupplyAgent,
    SupplyContext,
    SupplyDecision,
    ZoneMarketSnapshot,
)
from backend.config import (
    CAPACITY_TRANSFER_PRICE_PER_MW,
    OVER_CAPACITY_ISSUE_SEC,
    OVER_CAPACITY_WARNING_SEC,
    SPIKE_CITY_MULTIPLIER,
    SPIKE_CITY_START_PROB,
    SPIKE_DURATION_TICKS,
    SPIKE_MULTIPLIER,
    SPIKE_START_PROB,
    SPIKE_ZONE_COUNT,
    STREAM_INTERVAL_SEC,
)
from backend.ingestion.zone_capacity import ZoneCapacityState, ZoneCapacityTracker

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_REGISTRY_PATH = REPO_ROOT / "ML" / "data" / "processed" / "ward_zone_registry.json"

TORONTO_BASE_DEMAND_MW = 5_200
DEFAULT_SUPPLY_BUDGET = 4_500_000.0


@dataclass(frozen=True)
class WardZoneProfile:
    zone_id: str
    ward_number: str
    ward_name: str
    load_share_pct: float
    capacity_mw: float
    baseline_supply_mw: float
    supply_cost_per_mw: float


def load_ward_profiles(path: Path = DEFAULT_REGISTRY_PATH) -> list[WardZoneProfile]:
    if not path.exists():
        raise FileNotFoundError(
            f"Missing ward registry: {path}. Run ML/src/ingestion/build_ward_zones.py"
        )

    with path.open(encoding="utf-8") as handle:
        registry = json.load(handle)

    profiles: list[WardZoneProfile] = []
    for zone in registry["zones"]:
        share = float(zone["load_share_pct"])
        profiles.append(
            WardZoneProfile(
                zone_id=zone["zone_id"],
                ward_number=zone["ward_number"],
                ward_name=zone["ward_name"],
                load_share_pct=share,
                capacity_mw=float(
                    zone.get("capacity_mw")
                    or round(TORONTO_BASE_DEMAND_MW * share / 100 * 0.82, 3)
                ),
                baseline_supply_mw=float(
                    zone.get("baseline_supply_mw")
                    or round(TORONTO_BASE_DEMAND_MW * share / 100 * 0.86, 3)
                ),
                supply_cost_per_mw=float(zone["supply_cost_per_mw"]),
            )
        )
    return profiles


def _hourly_demand_multiplier(hour: int) -> float:
    return 0.82 + 0.18 * math.sin((hour - 8) / 24 * 2 * math.pi)


@dataclass
class ActiveSpike:
    zone_id: str
    multiplier: float
    ticks_remaining: int
    spike_type: str  # "local" | "city"


@dataclass
class DemandSpikeEngine:
    """Random demand spikes layered on the baseline random walk."""

    rng: random.Random
    start_prob: float = SPIKE_START_PROB
    city_start_prob: float = SPIKE_CITY_START_PROB
    zone_count_range: tuple[int, int] = SPIKE_ZONE_COUNT
    multiplier_range: tuple[float, float] = SPIKE_MULTIPLIER
    city_multiplier_range: tuple[float, float] = SPIKE_CITY_MULTIPLIER
    duration_range: tuple[int, int] = SPIKE_DURATION_TICKS
    active: dict[str, ActiveSpike] = field(default_factory=dict)
    city_multiplier: float = 1.0
    city_ticks_remaining: int = 0

    def tick(self, zone_ids: list[str]) -> None:
        for zone_id in list(self.active.keys()):
            self.active[zone_id].ticks_remaining -= 1
            if self.active[zone_id].ticks_remaining <= 0:
                del self.active[zone_id]

        if self.city_ticks_remaining > 0:
            self.city_ticks_remaining -= 1
            if self.city_ticks_remaining <= 0:
                self.city_multiplier = 1.0

        if self.rng.random() < self.city_start_prob:
            self.city_multiplier = self.rng.uniform(*self.city_multiplier_range)
            self.city_ticks_remaining = self.rng.randint(*self.duration_range)

        if self.rng.random() < self.start_prob:
            count = self.rng.randint(*self.zone_count_range)
            targets = self.rng.sample(zone_ids, k=min(count, len(zone_ids)))
            for zone_id in targets:
                self.active[zone_id] = ActiveSpike(
                    zone_id=zone_id,
                    multiplier=self.rng.uniform(*self.multiplier_range),
                    ticks_remaining=self.rng.randint(*self.duration_range),
                    spike_type="local",
                )

    def multiplier_for(self, zone_id: str) -> tuple[float, ActiveSpike | None]:
        local = self.active.get(zone_id)
        mult = self.city_multiplier
        if local:
            mult *= local.multiplier
        if mult <= 1.001:
            return 1.0, local
        return round(mult, 4), local

    def active_events(self) -> list[dict]:
        events: list[dict] = []
        if self.city_ticks_remaining > 0:
            events.append(
                {
                    "scope": "city",
                    "multiplier": round(self.city_multiplier, 4),
                    "ticks_remaining": self.city_ticks_remaining,
                    "spike_type": "city",
                }
            )
        for spike in self.active.values():
            events.append(
                {
                    "scope": spike.zone_id,
                    "zone_id": spike.zone_id,
                    "multiplier": round(spike.multiplier, 4),
                    "ticks_remaining": spike.ticks_remaining,
                    "spike_type": spike.spike_type,
                }
            )
        return events


class WardStreamSimulator:
    def __init__(
        self,
        profiles: list[WardZoneProfile] | None = None,
        *,
        seed: int = 42,
        base_demand_mw: float = TORONTO_BASE_DEMAND_MW,
        supply_budget: float = DEFAULT_SUPPLY_BUDGET,
        transfer_price_per_mw: float = CAPACITY_TRANSFER_PRICE_PER_MW,
        tick_sec: float = STREAM_INTERVAL_SEC,
        warning_sec: float = OVER_CAPACITY_WARNING_SEC,
        issue_sec: float = OVER_CAPACITY_ISSUE_SEC,
        supply_agent: SupplyAgent | None = None,
    ) -> None:
        self.profiles = profiles or load_ward_profiles()
        self.base_demand_mw = base_demand_mw
        self.supply_budget = supply_budget
        self.transfer_price_per_mw = transfer_price_per_mw
        self._rng = random.Random(seed)
        self._capacity_tracker = ZoneCapacityTracker(
            tick_sec=tick_sec,
            warning_sec=warning_sec,
            issue_sec=issue_sec,
        )
        self._profile_by_id = {profile.zone_id: profile for profile in self.profiles}
        self._last_demands: dict[str, float] = {}
        self._baseline_demands: dict[str, float] = {}
        self._spike_engine = DemandSpikeEngine(rng=self._rng)
        self._supply_agent = supply_agent or DefaultCapacityAgent()
        self._last_decision: SupplyDecision | None = None

    @property
    def supply_agent(self) -> SupplyAgent:
        return self._supply_agent

    def set_supply_agent(self, agent: SupplyAgent) -> None:
        self._supply_agent = agent

    def simulate_demands(self, at: datetime | None = None) -> dict[str, float]:
        now = at or datetime.now(timezone.utc)
        daily = _hourly_demand_multiplier(now.hour)
        city_target = self.base_demand_mw * daily

        if not self._last_demands:
            city_demand = city_target * self._rng.uniform(0.98, 1.02)
            demands: dict[str, float] = {}
            for profile in self.profiles:
                share = profile.load_share_pct / 100.0
                zone_noise = self._rng.uniform(0.96, 1.04)
                demands[profile.zone_id] = round(city_demand * share * zone_noise, 3)
            self._last_demands = demands
            self._baseline_demands = dict(demands)
            return demands

        city_demand = sum(self._last_demands.values()) * self._rng.uniform(0.985, 1.015)
        city_demand += (city_target - city_demand) * 0.15
        scale = city_demand / max(sum(self._last_demands.values()), 1.0)

        demands = {}
        for profile in self.profiles:
            zone_id = profile.zone_id
            drift = self._rng.uniform(0.992, 1.008)
            demands[zone_id] = round(self._last_demands[zone_id] * scale * drift, 3)

        self._baseline_demands = dict(demands)
        self._spike_engine.tick([profile.zone_id for profile in self.profiles])

        for profile in self.profiles:
            zone_id = profile.zone_id
            mult, _ = self._spike_engine.multiplier_for(zone_id)
            if mult > 1.0:
                demands[zone_id] = round(demands[zone_id] * mult, 3)

        self._last_demands = demands
        return demands

    def evaluate_capacity(
        self,
        demands: dict[str, float],
        effective_capacity_mw: dict[str, float],
    ) -> list[ZoneCapacityState]:
        states: list[ZoneCapacityState] = []
        for profile in self.profiles:
            states.append(
                self._capacity_tracker.update(
                    profile.zone_id,
                    demands[profile.zone_id],
                    effective_capacity_mw[profile.zone_id],
                )
            )
        return states

    def run_supply_agent(
        self,
        demands: dict[str, float],
        *,
        at: datetime | None = None,
        active_issues: list | None = None,
    ) -> SupplyDecision:
        zone_snapshots = [
            ZoneMarketSnapshot(
                zone_id=profile.zone_id,
                ward_name=profile.ward_name,
                demand_mw=demands[profile.zone_id],
                owned_capacity_mw=profile.capacity_mw,
                baseline_supply_mw=profile.baseline_supply_mw,
                supply_cost_per_mw=profile.supply_cost_per_mw,
            )
            for profile in self.profiles
        ]
        context = SupplyContext(
            ts=(at or datetime.now(timezone.utc)).isoformat(),
            zones=zone_snapshots,
            budget=self.supply_budget,
            transfer_price_per_mw=self.transfer_price_per_mw,
            active_issues=active_issues or [],
        )
        decision = self._supply_agent.decide(context)
        self._last_decision = decision
        return decision

    def snapshot(
        self, at: datetime | None = None
    ) -> tuple[dict, dict, dict, dict, SupplyDecision, list[ZoneCapacityState]]:
        now = at or datetime.now(timezone.utc)
        demands = self.simulate_demands(now)

        decision = self.run_supply_agent(demands, at=now, active_issues=[])

        market = decision.market
        grid = decision.grid_solution
        assert market is not None and grid is not None

        effective_capacity = market.effective_capacity_mw
        capacity_states = self.evaluate_capacity(demands, effective_capacity)
        capacity_by_zone = {state.zone_id: state for state in capacity_states}
        grid_by_zone = {row.zone_id: row for row in grid.allocations}

        demand_readings = []
        supply_readings = []

        for profile in sorted(self.profiles, key=lambda p: p.zone_id):
            zone_id = profile.zone_id
            demand_mw = demands[zone_id]
            baseline_mw = self._baseline_demands.get(zone_id, demand_mw)
            spike_mult, _ = self._spike_engine.multiplier_for(zone_id)
            capacity_state = capacity_by_zone[zone_id]
            grid_row = grid_by_zone[zone_id]
            effective = effective_capacity[zone_id]

            delivered_mw = round(
                min(demand_mw, effective, grid_row.supply_mw),
                3,
            )

            demand_readings.append(
                {
                    "zone_id": zone_id,
                    "demand": demand_mw,
                    "baseline_demand": baseline_mw,
                    "spike_active": spike_mult > 1.0,
                    "spike_multiplier": spike_mult,
                    "owned_capacity": profile.capacity_mw,
                    "effective_capacity": effective,
                    "capacity_imported": market.imported_mw[zone_id],
                    "capacity_exported": market.exported_mw[zone_id],
                    "over_capacity": capacity_state.over_capacity_mw,
                    "over_capacity_sec": capacity_state.over_capacity_sec,
                    "status": capacity_state.status,
                }
            )
            supply_readings.append(
                {
                    "zone_id": zone_id,
                    "supply": delivered_mw,
                    "owned_capacity": profile.capacity_mw,
                    "effective_capacity": effective,
                    "capacity_imported": market.imported_mw[zone_id],
                    "capacity_exported": market.exported_mw[zone_id],
                    "unmet_demand": round(max(0.0, demand_mw - delivered_mw), 3),
                    "incremental_cost": grid_row.incremental_cost,
                    "supply_cost_per_mw": profile.supply_cost_per_mw,
                    "over_capacity_sec": capacity_state.over_capacity_sec,
                    "status": capacity_state.status,
                    "agent": decision.agent,
                }
            )

        issues = self._capacity_tracker.active_issues(capacity_states)
        ts = now.isoformat()

        demand_frame = {
            "stream": "demand",
            "ts": ts,
            "zone_count": len(demand_readings),
            "active_spikes": self._spike_engine.active_events(),
            "readings": demand_readings,
        }
        supply_frame = {
            "stream": "supply",
            "ts": ts,
            "zone_count": len(supply_readings),
            "agent": decision.agent,
            "agent_note": decision.note,
            "budget": grid.budget,
            "trade_cost": market.total_trade_cost,
            "grid_cost": grid.total_cost,
            "total_cost": round(market.total_trade_cost + grid.total_cost, 2),
            "budget_remaining": grid.budget_remaining,
            "total_unmet_mw": grid.total_unmet_mw,
            "fully_served": grid.fully_served,
            "readings": supply_readings,
        }
        trades_frame = {
            "stream": "trades",
            "ts": ts,
            "agent": decision.agent,
            "trade_count": len(decision.trades),
            "total_traded_mw": market.total_traded_mw,
            "total_trade_cost": market.total_trade_cost,
            "trades": [
                {
                    "from_zone_id": trade.from_zone_id,
                    "to_zone_id": trade.to_zone_id,
                    "mw": trade.mw,
                    "price_per_mw": trade.price_per_mw,
                    "cost": trade.total_cost,
                }
                for trade in decision.trades
            ],
        }
        issues_frame = {
            "stream": "issues",
            "ts": ts,
            "issue_count": sum(1 for item in issues if item.status == "issue"),
            "warning_count": sum(1 for item in issues if item.status == "warning"),
            "issues": [
                {
                    "zone_id": item.zone_id,
                    "status": item.status,
                    "demand": item.demand_mw,
                    "capacity": item.capacity_mw,
                    "over_capacity": item.over_capacity_mw,
                    "over_capacity_sec": item.over_capacity_sec,
                    "message": item.message,
                }
                for item in issues
            ],
        }
        return (
            demand_frame,
            supply_frame,
            trades_frame,
            issues_frame,
            decision,
            capacity_states,
        )

    def registry_snapshot(self) -> dict:
        return {
            "zone_count": len(self.profiles),
            "zone_ids": [profile.zone_id for profile in self.profiles],
            "supply_agent": self._supply_agent.name,
            "rules": {
                "over_capacity_warning_sec": OVER_CAPACITY_WARNING_SEC,
                "over_capacity_issue_sec": OVER_CAPACITY_ISSUE_SEC,
                "tick_sec": STREAM_INTERVAL_SEC,
                "capacity_transfer_price_per_mw": self.transfer_price_per_mw,
                "spike_start_prob": SPIKE_START_PROB,
                "spike_city_start_prob": SPIKE_CITY_START_PROB,
                "spike_multiplier": list(SPIKE_MULTIPLIER),
                "spike_duration_ticks": list(SPIKE_DURATION_TICKS),
            },
            "zones": [
                {
                    "zone_id": profile.zone_id,
                    "ward_number": profile.ward_number,
                    "ward_name": profile.ward_name,
                    "load_share_pct": profile.load_share_pct,
                    "owned_capacity_mw": profile.capacity_mw,
                    "baseline_supply_mw": profile.baseline_supply_mw,
                    "supply_cost_per_mw": profile.supply_cost_per_mw,
                }
                for profile in self.profiles
            ],
        }
