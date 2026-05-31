"""
Build spike_training.csv from IESO historical demand.

Detects ward-level spike hours, then outputs historical demand fields plus zone_id:

  zone_id, timestamp, date, hour, market_demand_mw, ontario_demand_mw, year_source

Run:
  python ML/src/ingestion/record_spike_dataset.py
  python ML/src/ingestion/record_spike_dataset.py --max-rows 20
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ML_ROOT = Path(__file__).resolve().parents[2]
PROCESSED = ML_ROOT / "data" / "processed"
REPO_ROOT = ML_ROOT.parent
sys.path.insert(0, str(REPO_ROOT))

from backend.config import (  # noqa: E402
    HISTORICAL_SPIKE_THRESHOLD,
    ROLLING_BASELINE_HOURS,
    TORONTO_BASE_DEMAND_MW,
)

HISTORICAL_CSV = PROCESSED / "historical_demand.csv"
REGISTRY_JSON = PROCESSED / "ward_zone_registry.json"
TRAINING_CSV = PROCESSED / "spike_training.csv"
META_JSON = PROCESSED / "spike_dataset_meta.json"

MIN_SPIKE_HOURS = 1

OUTPUT_COLUMNS = [
    "zone_id",
    "timestamp",
    "date",
    "hour",
    "market_demand_mw",
    "ontario_demand_mw",
    "year_source",
]


def load_historical(path: Path = HISTORICAL_CSV) -> pd.DataFrame:
    if not path.exists():
        raise FileNotFoundError(
            f"Missing {path}. Run ML/src/ingestion/fetch_historical_demand.py first."
        )
    df = pd.read_csv(path, parse_dates=["timestamp"])
    df = df.sort_values("timestamp").reset_index(drop=True)
    df["hour_0_23"] = df["timestamp"].dt.hour

    median_ontario = float(df["ontario_demand_mw"].median())
    toronto_scale = TORONTO_BASE_DEMAND_MW / max(median_ontario, 1.0)
    df["toronto_demand_mw"] = df["ontario_demand_mw"] * toronto_scale
    return df


def load_ward_shares(path: Path = REGISTRY_JSON) -> pd.DataFrame:
    with path.open(encoding="utf-8") as handle:
        registry = json.load(handle)
    return pd.DataFrame(
        [
            {
                "zone_id": zone["zone_id"],
                "load_share_pct": float(zone["load_share_pct"]),
            }
            for zone in registry["zones"]
        ]
    )


def ward_diurnal_shape(zone_id: str, hour: np.ndarray) -> np.ndarray:
    ward_index = int(zone_id.split("_")[1])
    phase = (ward_index % 25) * 0.28
    return 1.0 + 0.055 * np.sin(2 * np.pi * (hour - phase) / 24)


def ward_demand_series(
    historical: pd.DataFrame, zone_id: str, load_share_pct: float
) -> pd.Series:
    share = load_share_pct / 100.0
    shape = ward_diurnal_shape(zone_id, historical["hour_0_23"].to_numpy())
    return pd.Series(
        historical["toronto_demand_mw"].to_numpy() * share * shape,
        index=historical.index,
        name=zone_id,
    )


def rolling_baseline(series: pd.Series, window: int = ROLLING_BASELINE_HOURS) -> pd.Series:
    return series.rolling(window, min_periods=24, center=True).median()


def detect_spike_runs(
    series: pd.Series,
    baseline: pd.Series,
    *,
    threshold: float,
    min_hours: int = MIN_SPIKE_HOURS,
) -> list[tuple[int, int]]:
    mask = (series > baseline * threshold).fillna(False).to_numpy()
    runs: list[tuple[int, int]] = []
    index = 0
    length = len(mask)

    while index < length:
        if not mask[index]:
            index += 1
            continue
        start = index
        while index < length and mask[index]:
            index += 1
        run_len = index - start
        if run_len >= min_hours:
            runs.append((start, run_len))

    return runs


def runs_to_training_rows(
    historical: pd.DataFrame,
    zone_id: str,
    runs: list[tuple[int, int]],
) -> list[dict]:
    rows: list[dict] = []

    for start_idx, run_hours in runs:
        for idx in range(start_idx, start_idx + run_hours):
            row = historical.loc[idx]
            rows.append(
                {
                    "zone_id": zone_id,
                    "timestamp": row["timestamp"].strftime("%Y-%m-%d %H:%M:%S"),
                    "date": row["date"],
                    "hour": int(row["hour"]),
                    "market_demand_mw": int(row["market_demand_mw"]),
                    "ontario_demand_mw": int(row["ontario_demand_mw"]),
                    "year_source": int(row["year_source"]),
                }
            )

    return rows


def build_training_table(
    historical: pd.DataFrame,
    wards: pd.DataFrame,
    *,
    threshold: float,
) -> pd.DataFrame:
    rows: list[dict] = []

    for ward in wards.itertuples(index=False):
        series = ward_demand_series(historical, ward.zone_id, ward.load_share_pct)
        baseline = rolling_baseline(series)
        runs = detect_spike_runs(series, baseline, threshold=threshold)
        rows.extend(runs_to_training_rows(historical, ward.zone_id, runs))

    if not rows:
        return pd.DataFrame(columns=OUTPUT_COLUMNS)

    training = pd.DataFrame(rows)[OUTPUT_COLUMNS]
    return training.sort_values(["timestamp", "zone_id"]).reset_index(drop=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Build spike training CSV")
    parser.add_argument("--threshold", type=float, default=HISTORICAL_SPIKE_THRESHOLD)
    parser.add_argument("--max-rows", type=int, default=None)
    args = parser.parse_args()

    historical = load_historical()
    wards = load_ward_shares()
    training_df = build_training_table(historical, wards, threshold=args.threshold)
    if args.max_rows is not None:
        training_df = training_df.head(args.max_rows)

    PROCESSED.mkdir(parents=True, exist_ok=True)
    training_df.to_csv(TRAINING_CSV, index=False)

    meta = {
        "sources": {
            "historical_demand": str(HISTORICAL_CSV.relative_to(REPO_ROOT)),
            "ward_registry": str(REGISTRY_JSON.relative_to(REPO_ROOT)),
        },
        "detection": {
            "spike_threshold": args.threshold,
            "min_spike_hours": MIN_SPIKE_HOURS,
            "rolling_baseline_hours": ROLLING_BASELINE_HOURS,
            "note": "One row per ward per spike hour; demand columns match historical_demand.csv",
        },
        "training_rows": len(training_df),
        "output": str(TRAINING_CSV.relative_to(REPO_ROOT)),
        "columns": OUTPUT_COLUMNS,
    }
    META_JSON.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")

    print(f"Wrote {TRAINING_CSV} ({len(training_df):,} rows, {len(OUTPUT_COLUMNS)} columns)")


if __name__ == "__main__":
    main()
