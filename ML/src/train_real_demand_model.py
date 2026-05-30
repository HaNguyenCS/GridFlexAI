"""
Train GridFlex stress model using real IESO historical demand.

Training data:
- data/processed/historical_demand.csv

The model learns real Ontario demand, market demand, calendar, lag, ramp,
and rolling-window patterns.

The target label is an engineered stress proxy:
- high demand percentile
- high market demand percentile
- high ramp pressure
- low reserve proxy pressure
- future 3-hour stress window

This does NOT train on outage/failure labels.
It trains on a reliability-stress proxy because public outage labels are not available.

Outputs:
- artifacts/grid_stress_xgb.json
- artifacts/feature_columns.json
- artifacts/model_training_status.json

Run:
python src/train_real_demand_model.py
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import precision_score, recall_score, roc_auc_score


HISTORICAL_DEMAND_CSV = Path("data/processed/historical_demand.csv")
ARTIFACTS_DIR = Path("artifacts")

MODEL_PATH = ARTIFACTS_DIR / "grid_stress_xgb.json"
FEATURE_COLUMNS_PATH = ARTIFACTS_DIR / "feature_columns.json"
STATUS_PATH = ARTIFACTS_DIR / "model_training_status.json"

TARGET = "stress_event_next_3h"

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


def percentile_rank(series: pd.Series) -> pd.Series:
    return series.rank(method="average", pct=True) * 100


def build_training_table() -> pd.DataFrame:
    if not HISTORICAL_DEMAND_CSV.exists():
        raise RuntimeError(
            "Missing data/processed/historical_demand.csv. "
            "Run python src/ingestion/fetch_historical_demand.py first."
        )

    df = pd.read_csv(HISTORICAL_DEMAND_CSV)

    df["timestamp"] = pd.to_datetime(df["timestamp"], errors="coerce")
    df["ontario_demand_mw"] = pd.to_numeric(df["ontario_demand_mw"], errors="coerce")
    df["market_demand_mw"] = pd.to_numeric(df["market_demand_mw"], errors="coerce")

    df = df.dropna(subset=["timestamp", "ontario_demand_mw", "market_demand_mw"])
    df = df.sort_values("timestamp").reset_index(drop=True)

    # Calendar features
    df["hour"] = df["timestamp"].dt.hour
    df["day_of_week"] = df["timestamp"].dt.dayofweek
    df["month"] = df["timestamp"].dt.month
    df["is_weekend"] = (df["day_of_week"] >= 5).astype(int)
    df["is_peak_window"] = ((df["hour"] >= 16) & (df["hour"] <= 21)).astype(int)

    # Historical lag features from real IESO demand
    df["demand_lag_1h_mw"] = df["ontario_demand_mw"].shift(1)
    df["demand_lag_24h_mw"] = df["ontario_demand_mw"].shift(24)
    df["demand_lag_168h_mw"] = df["ontario_demand_mw"].shift(168)

    # Ramp features from real IESO demand
    df["demand_ramp_1h_mw"] = df["ontario_demand_mw"] - df["demand_lag_1h_mw"]
    df["demand_ramp_3h_mw"] = df["ontario_demand_mw"] - df["ontario_demand_mw"].shift(3)

    # Rolling pressure features
    df["rolling_demand_mean_3h"] = df["ontario_demand_mw"].rolling(3).mean()
    df["rolling_demand_max_24h"] = df["ontario_demand_mw"].rolling(24).max()

    # Forecast-like targets from historical future values.
    # During live inference, these come from PredispTotals.
    df["forecast_market_demand_next_1h_mw"] = df["market_demand_mw"].shift(-1)
    df["forecast_market_demand_next_3h_mw"] = df["market_demand_mw"].shift(-3)

    # Reserve proxy.
    # Real /Demand/ files do not include operating reserve, so use a proxy:
    # when demand is historically high, available reserve is assumed tighter.
    demand_75 = df["ontario_demand_mw"].quantile(0.75)
    demand_pressure = (df["ontario_demand_mw"] - demand_75).clip(lower=0)

    df["scheduled_operating_reserve_mw"] = (
        2600 - 0.10 * demand_pressure
    ).clip(lower=800, upper=3500)

    df["reserve_margin_ratio"] = (
        df["scheduled_operating_reserve_mw"] / df["ontario_demand_mw"]
    )

    # Generation estimates to match live API schema.
    df["total_generation_output_mw"] = df["ontario_demand_mw"] * 1.02
    df["total_generation_capability_mw"] = (
        df["ontario_demand_mw"] + df["scheduled_operating_reserve_mw"] + 1800
    )

    # Weather is not joined historically yet.
    # Use neutral values so schema matches live inference.
    # Live inference uses actual Open-Meteo weather.
    df["temperature_c"] = 15.0
    df["humidity"] = 55.0

    # Build engineered stress score.
    df["ontario_demand_pct"] = percentile_rank(df["ontario_demand_mw"])
    df["market_demand_pct"] = percentile_rank(df["market_demand_mw"])
    df["ramp_pressure_pct"] = percentile_rank(df["demand_ramp_1h_mw"].fillna(0))

    reserve_pct = percentile_rank(df["scheduled_operating_reserve_mw"])
    df["low_reserve_proxy_pressure"] = 100 - reserve_pct

    df["stress_score_proxy"] = (
        0.42 * df["ontario_demand_pct"]
        + 0.23 * df["market_demand_pct"]
        + 0.22 * df["ramp_pressure_pct"]
        + 0.13 * df["low_reserve_proxy_pressure"]
    )

    # Label = whether the next 3 hours enter a high-stress condition.
    df["future_stress_1h"] = df["stress_score_proxy"].shift(-1)
    df["future_stress_2h"] = df["stress_score_proxy"].shift(-2)
    df["future_stress_3h"] = df["stress_score_proxy"].shift(-3)

    df["future_stress_max_3h"] = df[
        ["future_stress_1h", "future_stress_2h", "future_stress_3h"]
    ].max(axis=1)

    df[TARGET] = (df["future_stress_max_3h"] >= 80).astype(int)

    df = df.dropna(subset=FEATURE_COLUMNS + [TARGET])
    df = df.sort_values("timestamp").reset_index(drop=True)

    return df


def train_model(df: pd.DataFrame) -> dict:
    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)

    # Time-based split to avoid future leakage.
    split_index = int(len(df) * 0.8)

    train = df.iloc[:split_index]
    test = df.iloc[split_index:]

    X_train = train[FEATURE_COLUMNS]
    y_train = train[TARGET]

    X_test = test[FEATURE_COLUMNS]
    y_test = test[TARGET]

    dtrain = xgb.DMatrix(X_train, label=y_train)
    dtest = xgb.DMatrix(X_test, label=y_test)

    params = {
        "objective": "binary:logistic",
        "eval_metric": ["auc", "logloss"],
        "tree_method": "hist",
        "device": "cuda",
        "max_depth": 5,
        "eta": 0.05,
        "subsample": 0.85,
        "colsample_bytree": 0.85,
        "min_child_weight": 5,
        "seed": 42,
    }

    model = xgb.train(
        params=params,
        dtrain=dtrain,
        num_boost_round=500,
        evals=[(dtrain, "train"), (dtest, "test")],
        early_stopping_rounds=40,
        verbose_eval=50,
    )

    preds = model.predict(dtest)
    pred_labels = (preds >= 0.5).astype(int)

    metrics = {
        "auc": float(roc_auc_score(y_test, preds)),
        "precision": float(precision_score(y_test, pred_labels, zero_division=0)),
        "recall": float(recall_score(y_test, pred_labels, zero_division=0)),
        "train_rows": int(len(train)),
        "test_rows": int(len(test)),
        "positive_rate_train": float(y_train.mean()),
        "positive_rate_test": float(y_test.mean()),
    }

    model.save_model(MODEL_PATH)
    FEATURE_COLUMNS_PATH.write_text(json.dumps(FEATURE_COLUMNS, indent=2))

    STATUS_PATH.write_text(
        json.dumps(
            {
                "model_training": "historical_ieso_demand_with_proxy_stress_labels",
                "training_source": str(HISTORICAL_DEMAND_CSV),
                "target": TARGET,
                "real_training_features": [
                    "ontario_demand_mw",
                    "market_demand_mw",
                    "calendar_features",
                    "demand_lag_features",
                    "demand_ramp_features",
                    "rolling_demand_features",
                ],
                "estimated_training_features": [
                    "scheduled_operating_reserve_mw",
                    "reserve_margin_ratio",
                    "total_generation_output_mw",
                    "total_generation_capability_mw",
                    "temperature_c",
                    "humidity",
                ],
                "label_note": (
                    "stress_event_next_3h is an engineered reliability-stress proxy. "
                    "It is based on demand percentile, market demand percentile, ramp pressure, "
                    "and reserve-proxy pressure. It is not an outage or blackout label."
                ),
                "metrics": metrics,
                "trained_at_utc": datetime.now(UTC).isoformat(),
            },
            indent=2,
        )
    )

    return metrics


if __name__ == "__main__":
    training_df = build_training_table()

    print("Training rows:", len(training_df))
    print("Target positive rate:", training_df[TARGET].mean())

    metrics = train_model(training_df)

    print(json.dumps(metrics, indent=2))