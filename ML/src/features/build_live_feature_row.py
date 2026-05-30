"""
Build a model-ready live feature row by combining:
- latest IESO RealtimeTotals
- latest IESO PredispTotals
- weather fallback
- lag/rolling fallbacks

Output:
data/processed/live_feature_row.json

Run:
python src/features/build_live_feature_row.py
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any


REALTIME_JSON = Path("data/processed/latest_realtime_totals.json")
PREDISP_JSON = Path("data/processed/latest_predisp_totals.json")
MOCK_JSON = Path("data/mock/mock_live_grid.json")
OUTPUT_JSON = Path("data/processed/live_feature_row.json")


def load_json(path: Path) -> dict[str, Any]:
    with path.open("r") as f:
        return json.load(f)


def safe_get(data: dict[str, Any], key: str, default: Any) -> Any:
    value = data.get(key)
    if value is None:
        return default
    return value


def derive_time_features(timestamp: str) -> dict[str, int]:
    try:
        dt = datetime.fromisoformat(timestamp)
    except Exception:
        dt = datetime.now()

    return {
        "hour": dt.hour,
        "day_of_week": dt.weekday(),
        "month": dt.month,
        "is_weekend": int(dt.weekday() >= 5),
        "is_peak_window": int(16 <= dt.hour <= 21),
    }


def build_live_feature_row() -> dict[str, Any]:
    if not MOCK_JSON.exists():
        raise RuntimeError("Missing data/mock/mock_live_grid.json fallback file.")

    mock = load_json(MOCK_JSON)

    realtime = load_json(REALTIME_JSON) if REALTIME_JSON.exists() else {}
    predisp = load_json(PREDISP_JSON) if PREDISP_JSON.exists() else {}

    timestamp = safe_get(
        realtime,
        "timestamp",
        datetime.now().isoformat()
    )

    time_features = derive_time_features(timestamp)

    # Real current demand if available, otherwise mock fallback.
    ontario_demand = safe_get(
        realtime,
        "ontario_demand_mw",
        mock["ontario_demand_mw"]
    )

    # If market demand is not available, fallback to Ontario demand.
    market_demand = safe_get(
        realtime,
        "market_demand_mw",
        ontario_demand
    )

    # RealtimeTotals may not expose reserve in the file we receive.
    # If reserve is missing or zero, estimate a conservative reserve.
    scheduled_reserve = realtime.get("scheduled_operating_reserve_mw")

    if scheduled_reserve is None or scheduled_reserve <= 0:
        scheduled_reserve = max(800.0, ontario_demand * 0.06)

    reserve_margin_ratio = (
        scheduled_reserve / ontario_demand if ontario_demand else 0.0
    )

    # Real Predispatch forecast if available.
    forecast_1h = safe_get(
        predisp,
        "forecast_market_demand_next_1h_mw",
        mock["forecast_market_demand_next_1h_mw"]
    )

    forecast_3h = safe_get(
        predisp,
        "forecast_market_demand_next_3h_mw",
        mock["forecast_market_demand_next_3h_mw"]
    )

    # Until we store real historical rows, derive lags from current real demand.
    # Do not use old mock lags when live IESO demand is available, because that can create unrealistic ramps.
    if realtime.get("ontario_demand_mw") is not None:
        demand_lag_1h = ontario_demand * 0.985
        demand_lag_24h = ontario_demand * 0.97
        demand_lag_168h = ontario_demand * 0.95
    else:
        demand_lag_1h = safe_get(mock, "demand_lag_1h_mw", ontario_demand * 0.985)
        demand_lag_24h = safe_get(mock, "demand_lag_24h_mw", ontario_demand * 0.97)
        demand_lag_168h = safe_get(mock, "demand_lag_168h_mw", ontario_demand * 0.95)

    demand_ramp_1h = ontario_demand - demand_lag_1h
    demand_ramp_3h = demand_ramp_1h * 2

    # Use live-demand-consistent generation/capability estimates until GenOutputCapability is wired.
    total_generation_output = ontario_demand * 1.02
    total_generation_capability = ontario_demand + scheduled_reserve + 1800

    rolling_demand_mean_3h = (ontario_demand + demand_lag_1h) / 2
    rolling_demand_max_24h = max(ontario_demand, demand_lag_24h)

    row = {
        "timestamp": timestamp,

        # Real / semi-real grid values
        "ontario_demand_mw": round(float(ontario_demand), 3),
        "market_demand_mw": round(float(market_demand), 3),
        "scheduled_operating_reserve_mw": round(float(scheduled_reserve), 3),

        # Real Predisp forecast if available
        "forecast_market_demand_next_1h_mw": round(float(forecast_1h), 3),
        "forecast_market_demand_next_3h_mw": round(float(forecast_3h), 3),

        # Estimated until GenOutputCapability parser is wired
        "total_generation_output_mw": round(float(total_generation_output), 3),
        "total_generation_capability_mw": round(float(total_generation_capability), 3),

        # Weather fallback until ECCC ingestion is wired
        "temperature_c": safe_get(mock, "temperature_c", 31.2),
        "humidity": safe_get(mock, "humidity", 68),

        # Time features
        **time_features,

        # Lag / ramp / rolling fallbacks
        "demand_lag_1h_mw": round(float(demand_lag_1h), 3),
        "demand_lag_24h_mw": round(float(demand_lag_24h), 3),
        "demand_lag_168h_mw": round(float(demand_lag_168h), 3),
        "demand_ramp_1h_mw": round(float(demand_ramp_1h), 3),
        "demand_ramp_3h_mw": round(float(demand_ramp_3h), 3),
        "rolling_demand_mean_3h": round(float(rolling_demand_mean_3h), 3),
        "rolling_demand_max_24h": round(float(rolling_demand_max_24h), 3),
        "reserve_margin_ratio": round(float(reserve_margin_ratio), 6),

        # Metadata for transparency
        "_metadata": {
            "realtime_source": realtime.get("source", "fallback"),
            "predisp_source": predisp.get("source", "fallback"),
            "weather_source": "mock_fallback",
            "reserve_source": (
                "IESO RealtimeTotals"
                if realtime.get("scheduled_operating_reserve_mw", 0) > 0
                else "estimated_fallback"
            ),
            "generation_source": "estimated_fallback_until_GenOutputCapability",
            "lag_source": (
                "derived_from_live_demand"
                if realtime.get("ontario_demand_mw") is not None
                else "mock_or_derived_fallback"
            ),
            "built_at_utc": datetime.utcnow().isoformat(),
        },
    }

    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_JSON.write_text(json.dumps(row, indent=2))

    return row


if __name__ == "__main__":
    result = build_live_feature_row()
    print(json.dumps(result, indent=2))