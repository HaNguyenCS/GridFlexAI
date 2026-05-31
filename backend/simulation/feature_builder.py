"""Build system + ward feature rows from live simulator state."""

from __future__ import annotations

import json
from datetime import timedelta
from pathlib import Path

from backend.config import HISTORICAL_SPIKE_THRESHOLD
from backend.ingestion.historical_demand import HistoricalDemandPlayer
from backend.ingestion.zone_simulator import WardStreamSimulator, WardZoneProfile
from backend.schemas.simulation import SystemFeatures, WardFeatures

REPO_ROOT = Path(__file__).resolve().parents[2]
FLEX_ASSETS_PATH = REPO_ROOT / "ML" / "data" / "processed" / "flex_assets.json"

_flex_total_mw: float | None = None


def _load_flex_total_mw() -> float:
    global _flex_total_mw
    if _flex_total_mw is not None:
        return _flex_total_mw
    if FLEX_ASSETS_PATH.exists():
        with FLEX_ASSETS_PATH.open(encoding="utf-8") as handle:
            data = json.load(handle)
        _flex_total_mw = float(data.get("total_available_mw", 650))
    else:
        _flex_total_mw = 650.0
    return _flex_total_mw


def _ontario_from_toronto(toronto_mw: float, player: HistoricalDemandPlayer) -> float:
    index = player._hour_index
    ontario = player._rows[index].ontario_mw
    next_index = min(index + 1, len(player._rows) - 1)
    next_ontario = player._rows[next_index].ontario_mw
    fraction = player._sub_tick / player.ticks_per_hour
    return ontario + (next_ontario - ontario) * fraction


def _demand_ramp(player: HistoricalDemandPlayer) -> float:
    index = player._hour_index
    if index <= 0:
        return 0.0
    current = player._toronto_hourly[index]
    previous = player._toronto_hourly[index - 1]
    return round(current - previous, 2)


def build_system_features(
    player: HistoricalDemandPlayer,
    *,
    temperature_c: float = 22.0,
    humidity: float = 55.0,
) -> SystemFeatures:
    ts = player.current_timestamp()
    toronto_demand, _, _ = player.city_reading()
    ontario_demand = _ontario_from_toronto(toronto_demand, player)
    index = player._hour_index
    next_index = min(index + 3, len(player._rows) - 1)
    forecast_3h = player._toronto_hourly[next_index] * (
        player._toronto_scale * (ontario_demand / max(toronto_demand, 1.0))
    )
    reserve_mw = 980.0
    reserve_ratio = reserve_mw / max(ontario_demand, 1.0)

    return SystemFeatures(
        ontario_demand_mw=round(ontario_demand, 2),
        market_demand_mw=round(toronto_demand, 2),
        scheduled_operating_reserve_mw=reserve_mw,
        forecast_market_demand_next_3h_mw=round(forecast_3h, 2),
        temperature_c=temperature_c,
        humidity=humidity,
        hour=ts.hour,
        is_weekend=1 if ts.weekday() >= 5 else 0,
        demand_ramp_1h_mw=_demand_ramp(player),
        reserve_margin_ratio=round(reserve_ratio, 4),
    )


def build_ward_features(
    profile: WardZoneProfile,
    player: HistoricalDemandPlayer,
    system: SystemFeatures,
) -> WardFeatures:
    demand, baseline, multiplier = player.ward_reading(profile.zone_id)
    flex_total = _load_flex_total_mw()
    ward_flex = round(flex_total * profile.load_share_pct / 100.0, 2)

    return WardFeatures(
        ward_id=profile.zone_id,
        hour=system.hour,
        market_demand_mw=system.market_demand_mw,
        ontario_demand_mw=system.ontario_demand_mw,
        ward_load_proxy_mw=demand,
        ward_flexible_capacity_mw=ward_flex,
        temperature_c=system.temperature_c,
        humidity=system.humidity,
        reserve_margin_ratio=system.reserve_margin_ratio,
        demand_ramp_1h_mw=system.demand_ramp_1h_mw,
        spike_multiplier=multiplier,
    )


def build_from_simulator(
    simulator: WardStreamSimulator,
    *,
    temperature_c: float = 22.0,
    humidity: float = 55.0,
) -> tuple[str, SystemFeatures, list[WardFeatures]]:
    player = simulator._history
    ts = player.current_timestamp().isoformat()
    system = build_system_features(
        player, temperature_c=temperature_c, humidity=humidity
    )
    wards = [
        build_ward_features(profile, player, system)
        for profile in simulator.profiles
    ]
    return ts, system, wards


def build_snapshot_meta(simulator: WardStreamSimulator) -> dict:
    player = simulator._history
    return {
        "sim": player.sim_clock(tick_sec=2.0),
        "active_spikes": player.active_spike_events(
            [p.zone_id for p in simulator.profiles]
        ),
        "spike_threshold": HISTORICAL_SPIKE_THRESHOLD,
    }
