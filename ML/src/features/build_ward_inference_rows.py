"""
Build model-ready ward inference rows.

Input:
- Ward-expanded Ontario demand rows:
  zone_id,timestamp,date,hour,market_demand_mw,ontario_demand_mw,year_source

- Ward feature table:
  data/processed/ward_features.csv

Output:
- data/processed/ward_inference_features.csv

Core idea:
The same timestamp appears once per ward, so demand lags/ramps must be
computed on unique timestamp-level system data first, then merged back
onto ward rows.

Run:
python src/features/build_ward_inference_rows.py \
  --input data/processed/ward_inference_input.csv \
  --output data/processed/ward_inference_features.csv
"""

from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd


WARD_FEATURES_CSV = Path("data/processed/ward_features.csv")


FEATURE_COLUMNS = [
    "zone_id",
    "timestamp",
    "date",
    "hour",
    "market_demand_mw",
    "ontario_demand_mw",
    "year_source",

    # calendar
    "day_of_week",
    "month",
    "is_weekend",
    "is_peak_window",

    # system demand history
    "demand_lag_1h_mw",
    "demand_lag_24h_mw",
    "demand_lag_168h_mw",
    "demand_ramp_1h_mw",
    "demand_ramp_3h_mw",
    "rolling_demand_mean_3h",
    "rolling_demand_max_24h",

    # forecast/proxy features matching model schema
    "forecast_market_demand_next_1h_mw",
    "forecast_market_demand_next_3h_mw",
    "scheduled_operating_reserve_mw",
    "reserve_margin_ratio",
    "total_generation_output_mw",
    "total_generation_capability_mw",
    "temperature_c",
    "humidity",

    # ward features
    "ward_load_share",
    "available_flex_mw",
    "local_vulnerability_score",
]


def load_input(path: Path) -> pd.DataFrame:
    if not path.exists():
        raise RuntimeError(f"Missing input file: {path}")

    df = pd.read_csv(path)

    required = {
        "zone_id",
        "timestamp",
        "date",
        "hour",
        "market_demand_mw",
        "ontario_demand_mw",
        "year_source",
    }

    missing = required - set(df.columns)
    if missing:
        raise RuntimeError(f"Input file missing columns: {sorted(missing)}")

    df["timestamp"] = pd.to_datetime(df["timestamp"], errors="coerce")
    df["market_demand_mw"] = pd.to_numeric(df["market_demand_mw"], errors="coerce")
    df["ontario_demand_mw"] = pd.to_numeric(df["ontario_demand_mw"], errors="coerce")
    df["hour"] = pd.to_numeric(df["hour"], errors="coerce").astype("Int64")

    df = df.dropna(
        subset=[
            "zone_id",
            "timestamp",
            "market_demand_mw",
            "ontario_demand_mw",
            "hour",
        ]
    )

    return df.sort_values(["timestamp", "zone_id"]).reset_index(drop=True)


def build_system_features(ward_df: pd.DataFrame) -> pd.DataFrame:
    """
    Build system-level features once per timestamp.

    Do NOT calculate lag features directly on ward_df because ward_df has
    repeated timestamps for multiple wards.
    """

    system_df = (
        ward_df[
            [
                "timestamp",
                "date",
                "hour",
                "market_demand_mw",
                "ontario_demand_mw",
                "year_source",
            ]
        ]
        .drop_duplicates(subset=["timestamp"])
        .sort_values("timestamp")
        .reset_index(drop=True)
    )

    system_df["day_of_week"] = system_df["timestamp"].dt.dayofweek
    system_df["month"] = system_df["timestamp"].dt.month
    system_df["is_weekend"] = (system_df["day_of_week"] >= 5).astype(int)
    system_df["is_peak_window"] = (
        (system_df["hour"].astype(int) >= 16)
        & (system_df["hour"].astype(int) <= 21)
    ).astype(int)

    # Demand lags
    system_df["demand_lag_1h_mw"] = system_df["ontario_demand_mw"].shift(1)
    system_df["demand_lag_24h_mw"] = system_df["ontario_demand_mw"].shift(24)
    system_df["demand_lag_168h_mw"] = system_df["ontario_demand_mw"].shift(168)

    # Ramps
    system_df["demand_ramp_1h_mw"] = (
        system_df["ontario_demand_mw"] - system_df["demand_lag_1h_mw"]
    )
    system_df["demand_ramp_3h_mw"] = (
        system_df["ontario_demand_mw"] - system_df["ontario_demand_mw"].shift(3)
    )

    # Rolling demand features
    system_df["rolling_demand_mean_3h"] = (
        system_df["ontario_demand_mw"].rolling(3, min_periods=1).mean()
    )
    system_df["rolling_demand_max_24h"] = (
        system_df["ontario_demand_mw"].rolling(24, min_periods=1).max()
    )

    # Forecast proxies:
    # For historical/inference CSV with future timestamps available, use shift(-1), shift(-3).
    # For live rows with no future data, fallback to current market demand.
    system_df["forecast_market_demand_next_1h_mw"] = (
        system_df["market_demand_mw"].shift(-1)
    )
    system_df["forecast_market_demand_next_3h_mw"] = (
        system_df["market_demand_mw"].shift(-3)
    )

    system_df["forecast_market_demand_next_1h_mw"] = system_df[
        "forecast_market_demand_next_1h_mw"
    ].fillna(system_df["market_demand_mw"])

    system_df["forecast_market_demand_next_3h_mw"] = system_df[
        "forecast_market_demand_next_3h_mw"
    ].fillna(system_df["market_demand_mw"])

    # Reserve proxy:
    # Higher demand implies tighter reserve. This keeps feature schema consistent.
    demand_75 = system_df["ontario_demand_mw"].quantile(0.75)
    demand_pressure = (system_df["ontario_demand_mw"] - demand_75).clip(lower=0)

    system_df["scheduled_operating_reserve_mw"] = (
        2600 - 0.10 * demand_pressure
    ).clip(lower=800, upper=3500)

    system_df["reserve_margin_ratio"] = (
        system_df["scheduled_operating_reserve_mw"] / system_df["ontario_demand_mw"]
    )

    # Generation proxies for schema compatibility
    system_df["total_generation_output_mw"] = system_df["ontario_demand_mw"] * 1.02
    system_df["total_generation_capability_mw"] = (
        system_df["ontario_demand_mw"]
        + system_df["scheduled_operating_reserve_mw"]
        + 1800
    )

    # Weather placeholders.
    # If you later have weather by timestamp, merge it before this step or replace these columns.
    system_df["temperature_c"] = 15.0
    system_df["humidity"] = 55.0

    # Fill early lag gaps with reasonable local fallbacks.
    system_df["demand_lag_1h_mw"] = system_df["demand_lag_1h_mw"].fillna(
        system_df["ontario_demand_mw"]
    )
    system_df["demand_lag_24h_mw"] = system_df["demand_lag_24h_mw"].fillna(
        system_df["demand_lag_1h_mw"]
    )
    system_df["demand_lag_168h_mw"] = system_df["demand_lag_168h_mw"].fillna(
        system_df["demand_lag_24h_mw"]
    )

    system_df["demand_ramp_1h_mw"] = system_df["demand_ramp_1h_mw"].fillna(0)
    system_df["demand_ramp_3h_mw"] = system_df["demand_ramp_3h_mw"].fillna(
        system_df["demand_ramp_1h_mw"]
    )

    return system_df


def load_ward_features() -> pd.DataFrame:
    if not WARD_FEATURES_CSV.exists():
        raise RuntimeError(
            f"Missing {WARD_FEATURES_CSV}. Create ward_features.csv first."
        )

    ward_features = pd.read_csv(WARD_FEATURES_CSV)

    required = {
        "zone_id",
        "ward_load_share",
        "available_flex_mw",
        "local_vulnerability_score",
    }

    missing = required - set(ward_features.columns)
    if missing:
        raise RuntimeError(f"ward_features.csv missing columns: {sorted(missing)}")

    for col in ["ward_load_share", "available_flex_mw", "local_vulnerability_score"]:
        ward_features[col] = pd.to_numeric(ward_features[col], errors="coerce")

    ward_features = ward_features.dropna(subset=list(required))

    total_share = ward_features["ward_load_share"].sum()
    if total_share > 0:
        ward_features["ward_load_share"] = ward_features["ward_load_share"] / total_share

    return ward_features


def build_ward_inference_features(input_path: Path, output_path: Path) -> pd.DataFrame:
    ward_df = load_input(input_path)
    system_df = build_system_features(ward_df)
    ward_features = load_ward_features()

    # Keep original ward rows but merge system features by timestamp.
    system_feature_cols = [
        col for col in system_df.columns
        if col not in ["date", "hour", "market_demand_mw", "ontario_demand_mw", "year_source"]
    ]

    merged = ward_df.merge(
        system_df[system_feature_cols],
        on="timestamp",
        how="left",
    )

    merged = merged.merge(
        ward_features,
        on="zone_id",
        how="left",
    )

    missing_ward_features = merged[
        ["ward_load_share", "available_flex_mw", "local_vulnerability_score"]
    ].isna().any(axis=1)

    if missing_ward_features.any():
        missing_zones = sorted(merged.loc[missing_ward_features, "zone_id"].unique())
        raise RuntimeError(
            "Missing ward features for zone_id values: "
            f"{missing_zones}. Add them to data/processed/ward_features.csv."
        )

    # Final column order
    available_cols = [col for col in FEATURE_COLUMNS if col in merged.columns]
    remaining_cols = [col for col in merged.columns if col not in available_cols]
    merged = merged[available_cols + remaining_cols]

    output_path.parent.mkdir(parents=True, exist_ok=True)
    merged.to_csv(output_path, index=False)

    return merged


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--input",
        required=True,
        help="Path to ward-expanded inference CSV.",
    )
    parser.add_argument(
        "--output",
        default="data/processed/ward_inference_features.csv",
        help="Output path for model-ready ward inference rows.",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()

    result = build_ward_inference_features(
        input_path=Path(args.input),
        output_path=Path(args.output),
    )

    print(f"Built {len(result)} ward inference rows")
    print(f"Output: {args.output}")
    print(result.head().to_string(index=False))
