"""
Ward-level grid streams driven by IESO historical Ontario demand replay.

Demand is read from ML/data/processed/historical_demand.csv, scaled to Toronto,
split across wards, and streamed tick-by-tick. Supply is decided by a pluggable
SupplyAgent — swap in a LangGraph agent later via set_supply_agent().
"""

from __future__ import annotations

import json
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
    HISTORICAL_PLAYBACK_START_INDEX,
    HISTORICAL_SPIKE_THRESHOLD,
    OVER_CAPACITY_ISSUE_SEC,
    OVER_CAPACITY_WARNING_SEC,
    ROLLING_BASELINE_HOURS,
    STREAM_INTERVAL_SEC,
    TORONTO_BASE_DEMAND_MW,
)
from backend.ingestion.historical_demand import HistoricalDemandPlayer
from backend.ingestion.zone_capacity import ZoneCapacityState, ZoneCapacityTracker

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_REGISTRY_PATH = REPO_ROOT / "ML" / "data" / "processed" / "ward_zone_registry.json"

DEFAULT_SUPPLY_BUDGET = 4_500_000.0


class WardZoneProfile:
    __slots__ = (
        "zone_id",
        "ward_number",
        "ward_name",
        "load_share_pct",
        "capacity_mw",
        "baseline_supply_mw",
        "supply_cost_per_mw",
    )

    def __init__(
        self,
        zone_id: str,
        ward_number: str,
        ward_name: str,
        load_share_pct: float,
        capacity_mw: float,
        baseline_supply_mw: float,
        supply_cost_per_mw: float,
    ) -> None:
        self.zone_id = zone_id
        self.ward_number = ward_number
        self.ward_name = ward_name
        self.load_share_pct = load_share_pct
        self.capacity_mw = capacity_mw
        self.baseline_supply_mw = baseline_supply_mw
        self.supply_cost_per_mw = supply_cost_per_mw


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


class WardStreamSimulator:
    def __init__(
        self,
        profiles: list[WardZoneProfile] | None = None,
        *,
        supply_budget: float = DEFAULT_SUPPLY_BUDGET,
        transfer_price_per_mw: float = CAPACITY_TRANSFER_PRICE_PER_MW,
        tick_sec: float = STREAM_INTERVAL_SEC,
        warning_sec: float = OVER_CAPACITY_WARNING_SEC,
        issue_sec: float = OVER_CAPACITY_ISSUE_SEC,
        supply_agent: SupplyAgent | None = None,
        playback_start_index: int = HISTORICAL_PLAYBACK_START_INDEX,
    ) -> None:
        self.profiles = profiles or load_ward_profiles()
        self.supply_budget = supply_budget
        self.transfer_price_per_mw = transfer_price_per_mw
        self._tick_sec = tick_sec
        self._capacity_tracker = ZoneCapacityTracker(
            tick_sec=tick_sec,
            warning_sec=warning_sec,
            issue_sec=issue_sec,
        )
        self._profile_by_id = {profile.zone_id: profile for profile in self.profiles}
        self._history = HistoricalDemandPlayer(
            self.profiles,
            start_hour_index=playback_start_index,
        )
        self._supply_agent = supply_agent or DefaultCapacityAgent()
        self._last_decision: SupplyDecision | None = None
        self._baseline_demands: dict[str, float] = {}

    def sim_clock(self) -> dict:
        return self._history.sim_clock(tick_sec=self._tick_sec)

    @property
    def supply_agent(self) -> SupplyAgent:
        return self._supply_agent

    def set_supply_agent(self, agent: SupplyAgent) -> None:
        self._supply_agent = agent

    def simulate_demands(self, at: datetime | None = None) -> dict[str, float]:
        demands: dict[str, float] = {}
        baselines: dict[str, float] = {}

        for profile in self.profiles:
            demand, baseline, _mult = self._history.ward_reading(profile.zone_id)
            demands[profile.zone_id] = demand
            baselines[profile.zone_id] = baseline

        self._baseline_demands = baselines
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
        zone_ids = [profile.zone_id for profile in self.profiles]

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
            _, _, spike_mult = self._history.ward_reading(zone_id)
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
                    "spike_active": spike_mult >= HISTORICAL_SPIKE_THRESHOLD,
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
        sim = self.sim_clock()
        active_spikes = self._history.active_spike_events(zone_ids)

        demand_frame = {
            "stream": "demand",
            "ts": ts,
            "zone_count": len(demand_readings),
            "active_spikes": active_spikes,
            "sim": sim,
            "readings": demand_readings,
        }
        supply_frame = {
            "stream": "supply",
            "ts": ts,
            "zone_count": len(supply_readings),
            "sim": sim,
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
            "sim": sim,
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
            "sim": sim,
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
        self._history.advance()
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
            "demand_source": {
                "type": "historical_replay",
                "path": self._history.historical_path,
                "range_start": self._history.historical_start,
                "range_end": self._history.historical_end,
                "spike_threshold": HISTORICAL_SPIKE_THRESHOLD,
                "rolling_baseline_hours": ROLLING_BASELINE_HOURS,
            },
            "rules": {
                "over_capacity_warning_sec": OVER_CAPACITY_WARNING_SEC,
                "over_capacity_issue_sec": OVER_CAPACITY_ISSUE_SEC,
                "tick_sec": STREAM_INTERVAL_SEC,
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
