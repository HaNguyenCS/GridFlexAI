"""
Fetch historical IESO demand data.

Source:
https://reports-public.ieso.ca/public/Demand/

Purpose:
- Download yearly IESO demand CSVs
- Combine into one historical demand table
- Use for real lag features and future model retraining

Output:
data/processed/historical_demand.csv

Run:
python src/ingestion/fetch_historical_demand.py
"""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
import requests


BASE_URL = "https://reports-public.ieso.ca/public/Demand/"
YEARS = [2024, 2025, 2026]

RAW_DIR = Path("data/raw/ieso/demand")
PROCESSED_DIR = Path("data/processed")
OUTPUT_CSV = PROCESSED_DIR / "historical_demand.csv"
DEBUG_JSON = PROCESSED_DIR / "historical_demand_debug_columns.json"


def ensure_dirs() -> None:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)


def download_year(year: int) -> Path:
    url = f"{BASE_URL}PUB_Demand_{year}.csv"
    local_path = RAW_DIR / f"PUB_Demand_{year}.csv"

    response = requests.get(url, timeout=30)
    response.raise_for_status()

    local_path.write_bytes(response.content)
    return local_path


def find_header_row(path: Path) -> int:
    """
    IESO Demand CSVs have metadata rows first, then a row like:
    Date,Hour,Market Demand,Ontario Demand

    Return the zero-based index of the header row.
    """
    lines = path.read_text(errors="ignore").splitlines()

    for idx, line in enumerate(lines):
        normalized = line.lower()
        if "date" in normalized and "hour" in normalized and "ontario demand" in normalized:
            return idx

    raise RuntimeError(f"Could not find real header row in {path}")


def parse_demand_csv(path: Path, year: int) -> pd.DataFrame:
    header_row = find_header_row(path)

    df = pd.read_csv(path, skiprows=header_row)

    DEBUG_JSON.write_text(
        json.dumps(
            {
                "file": str(path),
                "header_row": header_row,
                "columns": list(df.columns),
                "sample_rows": df.head(5).to_dict(orient="records"),
            },
            indent=2,
            default=str,
        )
    )

    required_cols = ["Date", "Hour", "Market Demand", "Ontario Demand"]

    missing = [col for col in required_cols if col not in df.columns]
    if missing:
        raise RuntimeError(
            f"Missing required columns {missing} in {path}. "
            f"See {DEBUG_JSON} for columns/sample."
        )

    out = df[required_cols].copy()

    out = out.rename(
        columns={
            "Date": "date",
            "Hour": "hour",
            "Market Demand": "market_demand_mw",
            "Ontario Demand": "ontario_demand_mw",
        }
    )

    out["year_source"] = year

    out["date"] = pd.to_datetime(out["date"], errors="coerce")
    out["hour"] = pd.to_numeric(out["hour"], errors="coerce")
    out["market_demand_mw"] = pd.to_numeric(out["market_demand_mw"], errors="coerce")
    out["ontario_demand_mw"] = pd.to_numeric(out["ontario_demand_mw"], errors="coerce")

    # IESO hourly data uses hours 1-24.
    # Convert hour 1 to 00:00, hour 24 to 23:00.
    out["hour_zero_based"] = out["hour"] - 1
    out["timestamp"] = out["date"] + pd.to_timedelta(out["hour_zero_based"], unit="h")

    out = out.dropna(
        subset=[
            "timestamp",
            "hour",
            "market_demand_mw",
            "ontario_demand_mw",
        ]
    )

    out = out.sort_values("timestamp")

    return out[
        [
            "timestamp",
            "date",
            "hour",
            "market_demand_mw",
            "ontario_demand_mw",
            "year_source",
        ]
    ]


def fetch_historical_demand() -> pd.DataFrame:
    ensure_dirs()

    frames = []

    for year in YEARS:
        print(f"Downloading demand for {year}...")
        path = download_year(year)

        print(f"Parsing {path}...")
        frame = parse_demand_csv(path, year)
        frames.append(frame)

    combined = pd.concat(frames, ignore_index=True)

    combined = combined.drop_duplicates(subset=["timestamp"], keep="last")
    combined = combined.sort_values("timestamp")

    combined.to_csv(OUTPUT_CSV, index=False)

    return combined


if __name__ == "__main__":
    df = fetch_historical_demand()
    print(df.head())
    print(df.tail())
    print(f"Saved {OUTPUT_CSV}")
    print(f"Rows: {len(df)}")