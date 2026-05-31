from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

from backend.ingestion.historical_demand import HistoricalDemandPlayer
from backend.schemas.simulation import SystemFeatures


def _env_flag(name: str, default: str = "0") -> bool:
    return os.getenv(name, default).strip().lower() in {"1", "true", "yes", "on"}


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None:
        return default

    try:
        return float(raw)
    except ValueError:
        return default


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default

    try:
        return int(raw)
    except ValueError:
        return default


def _ontario_at(player: HistoricalDemandPlayer, hour_index: int) -> float:
    index = max(0, min(hour_index, len(player._rows) - 1))
    return player._rows[index].ontario_mw


def _toronto_at(player: HistoricalDemandPlayer, hour_index: int) -> float:
    index = max(0, min(hour_index, len(player._toronto_hourly) - 1))
    return player._toronto_hourly[index]


def build_fake_ml_feature_row() -> dict[str, Any]:
    """Build controlled fake feature rows for normal ML-service simulation.

    Calibrated to the same feature scale as ML /demo/stress.
    This keeps normal mode demo-like without touching the staged stress demo.
    """
    now = datetime.now(timezone.utc)

    # 60-second loop.
    phase = (now.second // 15) % 4

    if phase == 0:
        label = "calm"
        ontario = 20500.0
        market = 20800.0
        reserve = 3200.0
        temp = 22.0
        humidity = 45.0
        hour = 13
        next_1h = 21050.0
        next_3h = 21400.0
        lag_1h = 20350.0
        lag_24h = 20000.0
        lag_168h = 19800.0

    elif phase == 1:
        label = "tightening"
        ontario = 22400.0
        market = 23100.0
        reserve = 1650.0
        temp = 29.0
        humidity = 61.0
        hour = 16
        next_1h = 23900.0
        next_3h = 24700.0
        lag_1h = 21400.0
        lag_24h = 20950.0
        lag_168h = 20700.0

    elif phase == 2:
        label = "constrained"
        ontario = 23800.0
        market = 25100.0
        reserve = 980.0
        temp = 31.2
        humidity = 68.0
        hour = 17
        next_1h = 25700.0
        next_3h = 26200.0
        lag_1h = 22400.0
        lag_24h = 21900.0
        lag_168h = 21000.0

    else:
        label = "recovery"
        ontario = 22100.0
        market = 22600.0
        reserve = 2400.0
        temp = 26.0
        humidity = 54.0
        hour = 18
        next_1h = 22100.0
        next_3h = 21650.0
        lag_1h = 23200.0
        lag_24h = 21400.0
        lag_168h = 20900.0

    forced = os.getenv("ML_FAKE_SCENARIO", "").strip().lower()

    if forced == "calm":
        label = "calm"
        ontario, market, reserve, temp, humidity, hour = 20500.0, 20800.0, 3200.0, 22.0, 45.0, 13
        next_1h, next_3h = 21050.0, 21400.0
        lag_1h, lag_24h, lag_168h = 20350.0, 20000.0, 19800.0

    elif forced in {"problem", "tightening"}:
        label = "tightening"
        ontario, market, reserve, temp, humidity, hour = 22400.0, 23100.0, 1650.0, 29.0, 61.0, 16
        next_1h, next_3h = 23900.0, 24700.0
        lag_1h, lag_24h, lag_168h = 21400.0, 20950.0, 20700.0

    elif forced == "constrained":
        label = "constrained"
        ontario, market, reserve, temp, humidity, hour = 23800.0, 25100.0, 980.0, 31.2, 68.0, 17
        next_1h, next_3h = 25700.0, 26200.0
        lag_1h, lag_24h, lag_168h = 22400.0, 21900.0, 21000.0

    elif forced == "recovery":
        label = "recovery"
        ontario, market, reserve, temp, humidity, hour = 22100.0, 22600.0, 2400.0, 26.0, 54.0, 18
        next_1h, next_3h = 22100.0, 21650.0
        lag_1h, lag_24h, lag_168h = 23200.0, 21400.0, 20900.0

    ontario = _env_float("ML_FAKE_ONTARIO_DEMAND_MW", ontario)
    market = _env_float("ML_FAKE_MARKET_DEMAND_MW", market)
    reserve = _env_float("ML_FAKE_RESERVE_MW", reserve)
    temp = _env_float("ML_FAKE_TEMPERATURE_C", temp)
    humidity = _env_float("ML_FAKE_HUMIDITY", humidity)
    hour = _env_int("ML_FAKE_HOUR", hour)

    day_of_week = _env_int("ML_FAKE_DAY_OF_WEEK", 2)
    month = _env_int("ML_FAKE_MONTH", 7)

    next_1h = _env_float("ML_FAKE_NEXT_1H_MW", next_1h)
    next_3h = _env_float("ML_FAKE_NEXT_3H_MW", next_3h)

    lag_1h = _env_float("ML_FAKE_LAG_1H_MW", lag_1h)
    lag_24h = _env_float("ML_FAKE_LAG_24H_MW", lag_24h)
    lag_168h = _env_float("ML_FAKE_LAG_168H_MW", lag_168h)

    reserve_ratio = reserve / max(ontario, 1.0)
    ramp_1h = ontario - lag_1h
    ramp_3h = next_3h - market

    return {
        "timestamp": now.isoformat(),
        "ontario_demand_mw": round(ontario, 2),
        "market_demand_mw": round(market, 2),
        "scheduled_operating_reserve_mw": round(reserve, 2),
        "forecast_market_demand_next_1h_mw": round(next_1h, 2),
        "forecast_market_demand_next_3h_mw": round(next_3h, 2),
        "total_generation_output_mw": round(ontario + 600.0, 2),
        "total_generation_capability_mw": round(ontario + reserve + 3900.0, 2),
        "temperature_c": round(temp, 2),
        "humidity": round(humidity, 4),
        "hour": hour,
        "day_of_week": day_of_week,
        "month": month,
        "is_weekend": 1 if day_of_week >= 5 else 0,
        "is_peak_window": 1 if 16 <= hour <= 20 else 0,
        "demand_lag_1h_mw": round(lag_1h, 2),
        "demand_lag_24h_mw": round(lag_24h, 2),
        "demand_lag_168h_mw": round(lag_168h, 2),
        "demand_ramp_1h_mw": round(ramp_1h, 2),
        "demand_ramp_3h_mw": round(ramp_3h, 2),
        "rolling_demand_mean_3h": round((lag_1h + ontario + next_1h) / 3, 2),
        "rolling_demand_max_24h": round(max(ontario, next_1h, next_3h), 2),
        "reserve_margin_ratio": round(reserve_ratio, 4),
    }


def build_ml_feature_row(
    system: SystemFeatures,
    player: HistoricalDemandPlayer,
    *,
    temperature_c: float | None = None,
    humidity: float | None = None,
) -> dict[str, Any]:
    """Build a full ML GridFeatureRow from historical replay state."""
    if _env_flag("ML_FAKE_DATA"):
        return build_fake_ml_feature_row()

    index = player._hour_index
    ts = player.current_timestamp()
    ontario = system.ontario_demand_mw
    toronto = system.market_demand_mw

    lag_1h = _ontario_at(player, index - 1)
    lag_24h = _ontario_at(player, index - 24)
    lag_168h = _ontario_at(player, index - 168)
    next_1h = _toronto_at(player, index + 1)
    next_3h = _toronto_at(player, min(index + 3, len(player._toronto_hourly) - 1))

    ramp_3h = next_3h - toronto
    rolling_start = max(0, index - 2)
    rolling_slice = player._toronto_hourly[rolling_start : index + 1]
    rolling_mean_3h = sum(rolling_slice) / max(len(rolling_slice), 1)
    rolling_max_24h = max(
        player._toronto_hourly[max(0, index - 23) : index + 1] or [toronto]
    )

    reserve_mw = system.scheduled_operating_reserve_mw
    reserve_ratio = system.reserve_margin_ratio
    temp = temperature_c if temperature_c is not None else system.temperature_c
    hum = humidity if humidity is not None else system.humidity

    return {
        "timestamp": ts.isoformat(),
        "ontario_demand_mw": round(ontario, 2),
        "market_demand_mw": round(toronto, 2),
        "scheduled_operating_reserve_mw": reserve_mw,
        "forecast_market_demand_next_1h_mw": round(next_1h, 2),
        "forecast_market_demand_next_3h_mw": round(
            system.forecast_market_demand_next_3h_mw or next_3h, 2
        ),
        "total_generation_output_mw": round(ontario * 1.02, 2),
        "total_generation_capability_mw": round(ontario * 1.08, 2),
        "temperature_c": temp,
        "humidity": hum,
        "hour": ts.hour,
        "day_of_week": ts.weekday(),
        "month": ts.month,
        "is_weekend": 1 if ts.weekday() >= 5 else 0,
        "is_peak_window": 1 if 16 <= ts.hour <= 20 else 0,
        "demand_lag_1h_mw": round(lag_1h, 2),
        "demand_lag_24h_mw": round(lag_24h, 2),
        "demand_lag_168h_mw": round(lag_168h, 2),
        "demand_ramp_1h_mw": round(system.demand_ramp_1h_mw, 2),
        "demand_ramp_3h_mw": round(ramp_3h, 2),
        "rolling_demand_mean_3h": round(rolling_mean_3h, 2),
        "rolling_demand_max_24h": round(rolling_max_24h, 2),
        "reserve_margin_ratio": round(reserve_ratio, 4),
    }
