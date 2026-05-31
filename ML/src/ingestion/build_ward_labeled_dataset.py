"""
Build ward_labeled_training.csv — full ward-hour grid with spike labels.

Combines:
  - Positive rows from spike detection (is_spike=1)
  - Normal ward-hours from historical_demand.csv (is_spike=0)

Run:
  python ML/src/ingestion/build_ward_labeled_dataset.py
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
SPIKE_CSV = PROCESSED / "spike_training.csv"
OUTPUT_CSV = PROCESSED / "ward_labeled_training.csv"
META_JSON = PROCESSED / "ward_labeled_meta.json"

OUTPUT_COLUMNS = [
    "zone_id",
    "timestamp",
    "date",
    "hour",
    "market_demand_mw",
    "ontario_demand_mw",
    "year_source",
    "load_share_pct",
    "ward_load_proxy_mw",
    "spike_multiplier",
    "is_spike",
]


def ward_diurnal_shape(zone_id: str, hour: np.ndarray) -> np.ndarray:
    ward_index = int(zone_id.split("_")[1])
    phase = (ward_index % 25) * 0.28
    return 1.0 + 0.055 * np.sin(2 * np.pi * (hour - phase) / 24)


def load_historical(path: Path = HISTORICAL_CSV) -> pd.DataFrame:
    df = pd.read_csv(path, parse_dates=["timestamp"])
    df = df.sort_values("timestamp").reset_index(drop=True)
    df["hour_0_23"] = df["timestamp"].dt.hour
    median_ontario = float(df["ontario_demand_mw"].median())
    toronto_scale = TORONTO_BASE_DEMAND_MW / max(median_ontario, 1.0)
    df["toronto_demand_mw"] = df["ontario_demand_mw"] * toronto_scale
    df["timestamp_str"] = df["timestamp"].dt.strftime("%Y-%m-%d %H:%M:%S")
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


def load_spike_keys(path: Path = SPIKE_CSV) -> set[tuple[str, str]]:
    if not path.exists():
        return set()
    spikes = pd.read_csv(path, usecols=["zone_id", "timestamp"])
    return {
        (row.zone_id, row.timestamp)
        for row in spikes.itertuples(index=False)
    }


def build_labeled_table(
    historical: pd.DataFrame,
    wards: pd.DataFrame,
    spike_keys: set[tuple[str, str]],
    *,
    threshold: float,
) -> pd.DataFrame:
    rows: list[dict] = []

    for ward in wards.itertuples(index=False):
        share = ward.load_share_pct / 100.0
        shape = ward_diurnal_shape(ward.zone_id, historical["hour_0_23"].to_numpy())
        ward_load = historical["toronto_demand_mw"].to_numpy() * share * shape
        baseline = (
            pd.Series(ward_load, index=historical.index)
            .rolling(ROLLING_BASELINE_HOURS, min_periods=24, center=True)
            .median()
            .to_numpy()
        )
        multiplier = np.where(baseline > 0, ward_load / baseline, 1.0)

        for idx, hist_row in historical.iterrows():
            ts_str = hist_row["timestamp_str"]
            key = (ward.zone_id, ts_str)
            is_spike = 1 if key in spike_keys else 0
            mult = float(multiplier[idx])

            rows.append(
                {
                    "zone_id": ward.zone_id,
                    "timestamp": ts_str,
                    "date": hist_row["date"],
                    "hour": int(hist_row["hour"]),
                    "market_demand_mw": int(hist_row["market_demand_mw"]),
                    "ontario_demand_mw": int(hist_row["ontario_demand_mw"]),
                    "year_source": int(hist_row["year_source"]),
                    "load_share_pct": round(ward.load_share_pct, 4),
                    "ward_load_proxy_mw": round(float(ward_load[idx]), 3),
                    "spike_multiplier": round(mult, 4),
                    "is_spike": is_spike,
                }
            )

    return pd.DataFrame(rows)[OUTPUT_COLUMNS].sort_values(
        ["timestamp", "zone_id"]
    ).reset_index(drop=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Build labeled ward training CSV")
    parser.add_argument("--threshold", type=float, default=HISTORICAL_SPIKE_THRESHOLD)
    args = parser.parse_args()

    historical = load_historical()
    wards = load_ward_shares()
    spike_keys = load_spike_keys()

    labeled = build_labeled_table(
        historical, wards, spike_keys, threshold=args.threshold
    )

    PROCESSED.mkdir(parents=True, exist_ok=True)
    labeled.to_csv(OUTPUT_CSV, index=False)

    spike_rows = int(labeled["is_spike"].sum())
    normal_rows = len(labeled) - spike_rows

    meta = {
        "sources": {
            "historical_demand": str(HISTORICAL_CSV.relative_to(REPO_ROOT)),
            "spike_training": str(SPIKE_CSV.relative_to(REPO_ROOT)),
            "ward_registry": str(REGISTRY_JSON.relative_to(REPO_ROOT)),
        },
        "detection": {
            "spike_threshold": args.threshold,
            "rolling_baseline_hours": ROLLING_BASELINE_HOURS,
            "note": "Full ward-hour grid; is_spike=1 rows match spike_training.csv",
        },
        "total_rows": len(labeled),
        "spike_rows": spike_rows,
        "normal_rows": normal_rows,
        "ward_count": labeled["zone_id"].nunique(),
        "output": str(OUTPUT_CSV.relative_to(REPO_ROOT)),
        "columns": OUTPUT_COLUMNS,
    }
    META_JSON.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")

    print(
        f"Wrote {OUTPUT_CSV} ({len(labeled):,} rows: "
        f"{spike_rows:,} spike, {normal_rows:,} normal)"
    )


if __name__ == "__main__":
    main()
