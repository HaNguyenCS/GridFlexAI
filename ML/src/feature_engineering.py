import pandas as pd
import numpy as np


FEATURE_COLUMNS = [
    "ontario_demand_mw",
    "market_demand_mw",
    "scheduled_operating_reserve_mw",
    "forecast_market_demand_next_1h_mw",
    "forecast_market_demand_next_3h_mw",
    "total_generation_output_mw",
    "total_generation_capability_mw",
    "temperature_c",
    "humidity",
    "hour",
    "day_of_week",
    "month",
    "is_weekend",
    "is_peak_window",
    "demand_lag_1h_mw",
    "demand_lag_24h_mw",
    "demand_lag_168h_mw",
    "demand_ramp_1h_mw",
    "demand_ramp_3h_mw",
    "rolling_demand_mean_3h",
    "rolling_demand_max_24h",
    "reserve_margin_ratio",
]


def add_time_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    df = df.sort_values("timestamp")

    df["hour"] = df["timestamp"].dt.hour
    df["day_of_week"] = df["timestamp"].dt.dayofweek
    df["month"] = df["timestamp"].dt.month
    df["is_weekend"] = (df["day_of_week"] >= 5).astype(int)
    df["is_peak_window"] = ((df["hour"] >= 16) & (df["hour"] <= 21)).astype(int)

    return df


def add_lag_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df = df.sort_values("timestamp")

    df["demand_lag_1h_mw"] = df["ontario_demand_mw"].shift(1)
    df["demand_lag_24h_mw"] = df["ontario_demand_mw"].shift(24)
    df["demand_lag_168h_mw"] = df["ontario_demand_mw"].shift(168)

    df["demand_ramp_1h_mw"] = df["ontario_demand_mw"] - df["demand_lag_1h_mw"]
    df["demand_ramp_3h_mw"] = df["ontario_demand_mw"] - df["ontario_demand_mw"].shift(3)

    df["rolling_demand_mean_3h"] = df["ontario_demand_mw"].rolling(3).mean()
    df["rolling_demand_max_24h"] = df["ontario_demand_mw"].rolling(24).max()

    df["reserve_margin_ratio"] = (
        df["scheduled_operating_reserve_mw"] / df["ontario_demand_mw"]
    )

    return df


def percentile_rank(series: pd.Series) -> pd.Series:
    return series.rank(method="average", pct=True) * 100


def add_stress_labels(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()

    df["ontario_demand_pct"] = percentile_rank(df["ontario_demand_mw"])
    df["market_demand_pct"] = percentile_rank(df["market_demand_mw"])
    df["reserve_pct"] = percentile_rank(df["scheduled_operating_reserve_mw"])
    df["ramp_pct"] = percentile_rank(df["demand_ramp_1h_mw"].fillna(0))

    df["low_reserve_pressure"] = 100 - df["reserve_pct"]

    df["stress_score"] = (
        0.35 * df["ontario_demand_pct"]
        + 0.25 * df["market_demand_pct"]
        + 0.25 * df["low_reserve_pressure"]
        + 0.15 * df["ramp_pct"]
    )

    # Future max stress in next 3 hours
    df["future_stress_1h"] = df["stress_score"].shift(-1)
    df["future_stress_2h"] = df["stress_score"].shift(-2)
    df["future_stress_3h"] = df["stress_score"].shift(-3)

    df["future_stress_max_3h"] = df[
        ["future_stress_1h", "future_stress_2h", "future_stress_3h"]
    ].max(axis=1)

    df["stress_event_next_3h"] = (df["future_stress_max_3h"] >= 80).astype(int)

    return df


def prepare_features(df: pd.DataFrame) -> pd.DataFrame:
    df = add_time_features(df)
    df = add_lag_features(df)
    df = add_stress_labels(df)
    df = df.dropna(subset=FEATURE_COLUMNS + ["stress_event_next_3h"])
    return df