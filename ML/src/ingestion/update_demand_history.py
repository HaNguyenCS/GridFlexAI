"""
Append latest IESO RealtimeTotals row into a local demand history CSV.

Purpose:
- Store real Ontario demand snapshots over time
- Eventually compute real lag/ramp/rolling features

Input:
data/processed/latest_realtime_totals.json

Output:
data/processed/demand_history.csv

Run:
python src/ingestion/update_demand_history.py
"""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd


LATEST_REALTIME_JSON = Path("data/processed/latest_realtime_totals.json")
HISTORY_CSV = Path("data/processed/demand_history.csv")


def update_demand_history() -> pd.DataFrame:
    if not LATEST_REALTIME_JSON.exists():
        raise RuntimeError(
            "Missing latest_realtime_totals.json. Run fetch_realtime_totals.py first."
        )

    with LATEST_REALTIME_JSON.open("r") as file:
        latest = json.load(file)

    row = {
        "timestamp": latest.get("timestamp"),
        "source_file": latest.get("source_file"),
        "interval": latest.get("interval"),
        "ontario_demand_mw": latest.get("ontario_demand_mw"),
        "market_demand_mw": latest.get("market_demand_mw"),
        "scheduled_operating_reserve_mw": latest.get("scheduled_operating_reserve_mw"),
        "reserve_margin_ratio": latest.get("reserve_margin_ratio"),
    }

    new_df = pd.DataFrame([row])

    if HISTORY_CSV.exists():
        history = pd.read_csv(HISTORY_CSV)
        combined = pd.concat([history, new_df], ignore_index=True)
    else:
        combined = new_df

    combined = combined.drop_duplicates(
        subset=["timestamp", "interval"],
        keep="last",
    )

    combined = combined.sort_values(["timestamp", "interval"])

    HISTORY_CSV.parent.mkdir(parents=True, exist_ok=True)
    combined.to_csv(HISTORY_CSV, index=False)

    return combined


if __name__ == "__main__":
    df = update_demand_history()
    print(df.tail())
    print(f"Rows in demand history: {len(df)}")