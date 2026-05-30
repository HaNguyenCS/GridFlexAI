"""
Build a model-ready live feature row by combining:
- latest IESO RealtimeTotals
- latest IESO PredispTotals
- latest weather
- historical IESO demand, if available
- fallback values where needed

Output:
data/processed/live_feature_row.json

Run:
python src/features/build_live_feature_row.py
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pandas as pd


REALTIME_JSON = Path("data/processed/latest_realtime_totals.json")
PREDISP_JSON = Path("data/processed/latest_predisp_totals.json")
WEATHER_JSON = Path("data/processed/latest_weather.json")

DEMAND_HISTORY_CSV = Path("data/processed/demand_history.csv")
HISTORICAL_DEMAND_CSV = Path("data/processed/historical_demand.csv")

MOCK_JSON = Path("data/mock/mock_live_grid.json")
OUTPUT_JSON = Path("data/processed/live_feature_row.json")


def load_json(path: Path) -> dict[str, Any]:
    with path.open("r") as file:
        return json.load(file)


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


def get_history_lags(current_timestamp: str) -> dict[str, Any]:
    """
    Uses historical IESO hourly demand if available.

    Priority:
    1. historical_demand.csv from IESO /Demand/ yearly files
    2. demand_history.csv from local live refreshes
    3. fallback handled inside build_live_feature_row()
    """

    source_path = None

    if HISTORICAL_DEMAND_CSV.exists():
        source_path = HISTORICAL_DEMAND_CSV
    elif DEMAND_HISTORY_CSV.exists():
        source_path = DEMAND_HISTORY_CSV

    if source_path is None:
        return {}

    try:
        df = pd.read_csv(source_path)

        if "timestamp" not in df.columns or "ontario_demand_mw" not in df.columns:
            return {}

        df = df.dropna(subset=["timestamp", "ontario_demand_mw"])
        df["timestamp"] = pd.to_datetime(df["timestamp"], errors="coerce")
        df = df.dropna(subset=["timestamp"])
        df = df.sort_values("timestamp").reset_index(drop=True)

        if df.empty:
            return {}

        try:
            current_dt = pd.to_datetime(current_timestamp)
        except Exception:
            current_dt = df["timestamp"].max()

        past_df = df[df["timestamp"] <= current_dt]

        if past_df.empty:
            past_df = df

        latest_position = past_df.index[-1]
        values = df["ontario_demand_mw"].astype(float).tolist()

        result: dict[str, Any] = {}

        def get_lag(position: int, lag_hours: int):
            lag_position = position - lag_hours
            if lag_position >= 0:
                return values[lag_position]
            return None

        lag_1h = get_lag(latest_position, 1)
        lag_24h = get_lag(latest_position, 24)
        lag_168h = get_lag(latest_position, 168)

        if lag_1h is not None:
            result["demand_lag_1h_mw"] = lag_1h

        if lag_24h is not None:
            result["demand_lag_24h_mw"] = lag_24h

        if lag_168h is not None:
            result["demand_lag_168h_mw"] = lag_168h

        if latest_position >= 2:
            result["rolling_demand_mean_3h"] = (
                values[latest_position - 2]
                + values[latest_position - 1]
                + values[latest_position]
            ) / 3

        if latest_position >= 23:
            result["rolling_demand_max_24h"] = max(
                values[latest_position - 23: latest_position + 1]
            )

        result["_lag_source_path"] = str(source_path)
        return result

    except Exception:
        return {}


def build_live_feature_row() -> dict[str, Any]:
    if not MOCK_JSON.exists():
        raise RuntimeError("Missing data/mock/mock_live_grid.json fallback file.")

    mock = load_json(MOCK_JSON)

    realtime = load_json(REALTIME_JSON) if REALTIME_JSON.exists() else {}
    predisp = load_json(PREDISP_JSON) if PREDISP_JSON.exists() else {}
    weather = load_json(WEATHER_JSON) if WEATHER_JSON.exists() else {}

    timestamp = safe_get(
        realtime,
        "timestamp",
        datetime.now().isoformat(),
    )

    time_features = derive_time_features(timestamp)

    ontario_demand = safe_get(
        realtime,
        "ontario_demand_mw",
        mock["ontario_demand_mw"],
    )

    market_demand = safe_get(
        realtime,
        "market_demand_mw",
        ontario_demand,
    )

    scheduled_reserve = realtime.get("scheduled_operating_reserve_mw")

    if scheduled_reserve is None or scheduled_reserve <= 0:
        scheduled_reserve = max(800.0, ontario_demand * 0.06)

    reserve_margin_ratio = scheduled_reserve / ontario_demand if ontario_demand else 0.0

    forecast_1h = safe_get(
        predisp,
        "forecast_market_demand_next_1h_mw",
        mock["forecast_market_demand_next_1h_mw"],
    )

    forecast_3h = safe_get(
        predisp,
        "forecast_market_demand_next_3h_mw",
        mock["forecast_market_demand_next_3h_mw"],
    )

    history_lags = get_history_lags(timestamp)

    if history_lags:
        demand_lag_1h = history_lags.get("demand_lag_1h_mw", ontario_demand * 0.985)
        demand_lag_24h = history_lags.get("demand_lag_24h_mw", ontario_demand * 0.97)
        demand_lag_168h = history_lags.get("demand_lag_168h_mw", ontario_demand * 0.95)

        if "historical_demand.csv" in history_lags.get("_lag_source_path", ""):
            lag_source = "historical_demand_csv"
        else:
            lag_source = "demand_history_csv_partial"
    else:
        demand_lag_1h = ontario_demand * 0.985
        demand_lag_24h = ontario_demand * 0.97
        demand_lag_168h = ontario_demand * 0.95
        lag_source = "derived_from_live_demand"

    demand_ramp_1h = ontario_demand - demand_lag_1h
    demand_ramp_3h = demand_ramp_1h * 2

    rolling_demand_mean_3h = history_lags.get(
        "rolling_demand_mean_3h",
        (ontario_demand + demand_lag_1h) / 2,
    )

    rolling_demand_max_24h = history_lags.get(
        "rolling_demand_max_24h",
        max(ontario_demand, demand_lag_24h),
    )

    total_generation_output = ontario_demand * 1.02
    total_generation_capability = ontario_demand + scheduled_reserve + 1800

    row = {
        "timestamp": timestamp,

        "ontario_demand_mw": round(float(ontario_demand), 3),
        "market_demand_mw": round(float(market_demand), 3),
        "scheduled_operating_reserve_mw": round(float(scheduled_reserve), 3),

        "forecast_market_demand_next_1h_mw": round(float(forecast_1h), 3),
        "forecast_market_demand_next_3h_mw": round(float(forecast_3h), 3),

        "total_generation_output_mw": round(float(total_generation_output), 3),
        "total_generation_capability_mw": round(float(total_generation_capability), 3),

        "temperature_c": safe_get(
            weather,
            "temperature_c",
            safe_get(mock, "temperature_c", 31.2),
        ),
        "humidity": safe_get(
            weather,
            "humidity",
            safe_get(mock, "humidity", 68),
        ),

        **time_features,

        "demand_lag_1h_mw": round(float(demand_lag_1h), 3),
        "demand_lag_24h_mw": round(float(demand_lag_24h), 3),
        "demand_lag_168h_mw": round(float(demand_lag_168h), 3),
        "demand_ramp_1h_mw": round(float(demand_ramp_1h), 3),
        "demand_ramp_3h_mw": round(float(demand_ramp_3h), 3),
        "rolling_demand_mean_3h": round(float(rolling_demand_mean_3h), 3),
        "rolling_demand_max_24h": round(float(rolling_demand_max_24h), 3),
        "reserve_margin_ratio": round(float(reserve_margin_ratio), 6),

        "_metadata": {
            "realtime_source": realtime.get("source", "fallback"),
            "predisp_source": predisp.get("source", "fallback"),
            "weather_source": weather.get("source", "mock_fallback"),
            "reserve_source": (
                "IESO RealtimeTotals"
                if realtime.get("scheduled_operating_reserve_mw", 0) > 0
                else "estimated_fallback"
            ),
            "generation_source": "estimated_fallback_until_GenOutputCapability",
            "lag_source": lag_source,
            "built_at_utc": datetime.now(UTC).isoformat(),
        },
    }

    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_JSON.write_text(json.dumps(row, indent=2))

    return row


if __name__ == "__main__":
    result = build_live_feature_row()
    print(json.dumps(result, indent=2))