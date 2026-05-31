"""Map replay simulator state to ML service GridFeatureRow payloads."""

from __future__ import annotations

from typing import Any

from backend.ingestion.historical_demand import HistoricalDemandPlayer
from backend.schemas.simulation import SystemFeatures


def _ontario_at(player: HistoricalDemandPlayer, hour_index: int) -> float:
    index = max(0, min(hour_index, len(player._rows) - 1))
    return player._rows[index].ontario_mw


def _toronto_at(player: HistoricalDemandPlayer, hour_index: int) -> float:
    index = max(0, min(hour_index, len(player._toronto_hourly) - 1))
    return player._toronto_hourly[index]


def build_ml_feature_row(
    system: SystemFeatures,
    player: HistoricalDemandPlayer,
    *,
    temperature_c: float | None = None,
    humidity: float | None = None,
) -> dict[str, Any]:
    """Build a full ML GridFeatureRow from historical replay state."""
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
