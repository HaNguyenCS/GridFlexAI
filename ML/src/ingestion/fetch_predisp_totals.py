"""
Fetch and parse the latest IESO Predispatch Totals report.

Purpose:
- Pull latest IESO PredispTotals file
- Extract near-future forecast demand/load and operating reserve requirements
- Save normalized JSON snapshot for backend/model enrichment

Output:
data/processed/latest_predisp_totals.json

Run:
python src/ingestion/fetch_predisp_totals.py
"""

from __future__ import annotations

import csv
import json
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urljoin

import requests
import xml.etree.ElementTree as ET


BASE_URL = "https://reports-public.ieso.ca/public/PredispTotals/"
RAW_DIR = Path("data/raw/ieso")
PROCESSED_DIR = Path("data/processed")

OUTPUT_JSON = PROCESSED_DIR / "latest_predisp_totals.json"
CACHE_JSON = PROCESSED_DIR / "cached_predisp_totals.json"
DEBUG_JSON = PROCESSED_DIR / "predisp_totals_debug_records.json"

MOCK_GRID_JSON = Path("data/mock/mock_live_grid.json")


def ensure_dirs() -> None:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)


def fetch_directory_html() -> str:
    response = requests.get(BASE_URL, timeout=20)
    response.raise_for_status()
    return response.text


def find_latest_predisp_file_url(directory_html: str, prefer_csv: bool = True) -> str:
    """
    The directory contains:
    - PUB_PredispTotals.csv
    - PUB_PredispTotals.xml
    - historical dated versions

    Prefer the undated current file if present.
    Otherwise pick latest dated file by filename sort.
    """
    if prefer_csv:
        current_match = re.search(r'href="(PUB_PredispTotals\.csv)"', directory_html)
        if current_match:
            return urljoin(BASE_URL, current_match.group(1))

        files = re.findall(r'href="([^"]*PredispTotals[^"]*\.csv)"', directory_html)
    else:
        current_match = re.search(r'href="(PUB_PredispTotals\.xml)"', directory_html)
        if current_match:
            return urljoin(BASE_URL, current_match.group(1))

        files = re.findall(r'href="([^"]*PredispTotals[^"]*\.xml)"', directory_html)

    if not files:
        raise RuntimeError("No PredispTotals files found in IESO directory.")

    files = sorted(set(files))
    return urljoin(BASE_URL, files[-1])


def download_file(url: str) -> Path:
    response = requests.get(url, timeout=30)
    response.raise_for_status()

    filename = url.split("/")[-1]
    local_path = RAW_DIR / filename
    local_path.write_bytes(response.content)

    return local_path


def clean_key(key: str) -> str:
    return re.sub(r"[^a-z0-9]", "", key.lower())


def to_float(value: Any) -> Optional[float]:
    if value is None:
        return None

    text = str(value).strip().replace(",", "")

    if text == "":
        return None

    try:
        return float(text)
    except ValueError:
        return None


def parse_csv_records(path: Path) -> list[dict[str, Any]]:
    """
    IESO CSVs may have metadata/header lines before the actual table.
    This parser tries to find the row with useful column names.
    """
    text = path.read_text(errors="ignore")
    lines = [line for line in text.splitlines() if line.strip()]

    # Try normal csv.DictReader from every possible header row.
    best_records: list[dict[str, Any]] = []

    for start_idx in range(min(20, len(lines))):
        sample = "\n".join(lines[start_idx:])
        reader = csv.DictReader(sample.splitlines())
        if not reader.fieldnames:
            continue

        fieldnames_clean = [clean_key(f or "") for f in reader.fieldnames]

        has_hour_or_interval = any(
            key in fieldnames_clean
            for key in ["hour", "deliveryhour", "interval", "deliverydate"]
        )

        has_load_or_reserve = any(
            "load" in key or "demand" in key or "reserve" in key or "energy" in key
            for key in fieldnames_clean
        )

        if not (has_hour_or_interval and has_load_or_reserve):
            continue

        records = [dict(row) for row in reader if any((v or "").strip() for v in row.values())]

        if len(records) > len(best_records):
            best_records = records

    return best_records


def strip_namespace(tag: str) -> str:
    return tag.split("}", 1)[-1] if "}" in tag else tag


def parse_xml_records(path: Path) -> list[dict[str, Any]]:
    tree = ET.parse(path)
    root = tree.getroot()

    records = []

    for elem in root.iter():
        tag = strip_namespace(elem.tag).lower()

        if any(key in tag for key in ["interval", "hour", "row", "record", "totals"]):
            record = {}

            for child in elem.iter():
                child_tag = strip_namespace(child.tag)
                text = (child.text or "").strip()

                if text:
                    record[child_tag] = text

            if record:
                records.append(record)

    return records


def find_first_numeric(record: dict[str, Any], keyword_groups: list[list[str]]) -> Optional[float]:
    normalized = {
        clean_key(str(key)): value
        for key, value in record.items()
    }

    for keywords in keyword_groups:
        for key, value in normalized.items():
            if all(keyword in key for keyword in keywords):
                numeric = to_float(value)
                if numeric is not None:
                    return numeric

    return None


def find_hour(record: dict[str, Any]) -> Optional[int]:
    normalized = {
        clean_key(str(key)): value
        for key, value in record.items()
    }

    for possible_key in ["hour", "deliveryhour", "predispatchhour", "interval"]:
        if possible_key in normalized:
            num = to_float(normalized[possible_key])
            if num is not None:
                return int(num)

    # Fuzzy fallback
    for key, value in normalized.items():
        if "hour" in key or "interval" in key:
            num = to_float(value)
            if num is not None:
                return int(num)

    return None


def parse_timestamp_from_filename(path: Path) -> Optional[str]:
    # Examples:
    # PUB_PredispTotals_20260530.xml
    # PUB_PredispTotals_20260530_v27.xml
    match = re.search(r"(\d{8})", path.name)
    if not match:
        return None

    try:
        dt = datetime.strptime(match.group(1), "%Y%m%d")
        return dt.isoformat()
    except ValueError:
        return None


def parse_predisp_records(path: Path) -> dict[str, Any]:
    if path.suffix.lower() == ".csv":
        records = parse_csv_records(path)
    else:
        records = parse_xml_records(path)

    if not records:
        DEBUG_JSON.write_text("[]")
        raise RuntimeError("No PredispTotals records parsed.")

    parsed_rows = []

    for record in records:
        hour = find_hour(record)

        forecast_demand = find_first_numeric(
            record,
            [
                ["forecast", "market", "demand"],
                ["forecast", "load"],
                ["expected", "load"],
                ["market", "demand"],
                ["total", "energy"],
                ["load"],
                ["demand"],
                ["energy"],
            ],
        )

        reserve_requirement = find_first_numeric(
            record,
            [
                ["operating", "reserve", "requirement"],
                ["reserve", "requirement"],
                ["operating", "reserve"],
                ["reserve"],
            ],
        )

        available_energy = find_first_numeric(
            record,
            [
                ["available", "energy"],
                ["available"],
            ],
        )

        losses = find_first_numeric(
            record,
            [
                ["losses"],
                ["loss"],
            ],
        )

        if hour is not None and (
            forecast_demand is not None
            or reserve_requirement is not None
            or available_energy is not None
        ):
            parsed_rows.append(
                {
                    "hour": hour,
                    "forecast_market_demand_mw": forecast_demand,
                    "operating_reserve_requirement_mw": reserve_requirement,
                    "available_energy_mw": available_energy,
                    "losses_mw": losses,
                    "raw_record": record,
                }
            )

    if not parsed_rows:
        DEBUG_JSON.write_text(json.dumps(records[:50], indent=2))
        raise RuntimeError(
            f"Could not extract useful PredispTotals fields. Wrote sample to {DEBUG_JSON}"
        )

    # Sort by hour and use earliest hours as next 1h / next 3h proxy.
    parsed_rows = sorted(parsed_rows, key=lambda row: row["hour"])

    # In a proper production version, we would align current time to delivery hour.
    # For hackathon MVP, use first forecast row as next 1h and third row as next 3h if available.
    row_1h = parsed_rows[0]
    row_3h = parsed_rows[2] if len(parsed_rows) >= 3 else parsed_rows[-1]

    forecast_1h = row_1h.get("forecast_market_demand_mw")
    forecast_3h = row_3h.get("forecast_market_demand_mw")

    reserve_req_3h = row_3h.get("operating_reserve_requirement_mw")

    result = {
        "source": "IESO PredispTotals",
        "source_file": path.name,
        "timestamp": parse_timestamp_from_filename(path) or datetime.utcnow().isoformat(),
        "forecast_market_demand_next_1h_mw": forecast_1h,
        "forecast_market_demand_next_3h_mw": forecast_3h,
        "operating_reserve_requirement_next_3h_mw": reserve_req_3h,
        "available_energy_next_3h_mw": row_3h.get("available_energy_mw"),
        "losses_next_3h_mw": row_3h.get("losses_mw"),
        "forecast_rows_count": len(parsed_rows),
        "sample_hours": [row["hour"] for row in parsed_rows[:5]],
        "ingested_at_utc": datetime.utcnow().isoformat(),
    }

    # If the fuzzy parser misses forecast demand, write debug but still return partial.
    if forecast_1h is None or forecast_3h is None:
        DEBUG_JSON.write_text(json.dumps(records[:50], indent=2))
        result["warning"] = f"Forecast demand missing or partial. Debug written to {DEBUG_JSON}"

    return result


def load_cached_or_mock() -> dict[str, Any]:
    if CACHE_JSON.exists():
        with CACHE_JSON.open("r") as f:
            data = json.load(f)
            data["fallback_used"] = "cached_predisp_totals"
            return data

    if MOCK_GRID_JSON.exists():
        with MOCK_GRID_JSON.open("r") as f:
            mock = json.load(f)

        return {
            "source": "mock_live_grid",
            "forecast_market_demand_next_1h_mw": mock.get("forecast_market_demand_next_1h_mw"),
            "forecast_market_demand_next_3h_mw": mock.get("forecast_market_demand_next_3h_mw"),
            "operating_reserve_requirement_next_3h_mw": None,
            "fallback_used": "mock_live_grid",
            "ingested_at_utc": datetime.utcnow().isoformat(),
        }

    raise RuntimeError("No cached PredispTotals or mock grid payload available.")


def fetch_latest_predisp_totals() -> dict[str, Any]:
    ensure_dirs()

    try:
        html = fetch_directory_html()
        latest_url = find_latest_predisp_file_url(html, prefer_csv=True)
        local_path = download_file(latest_url)

        parsed = parse_predisp_records(local_path)

        OUTPUT_JSON.write_text(json.dumps(parsed, indent=2))
        CACHE_JSON.write_text(json.dumps(parsed, indent=2))

        return parsed

    except Exception as exc:
        print(f"[WARN] Live IESO PredispTotals fetch failed: {exc}", file=sys.stderr)
        fallback = load_cached_or_mock()
        OUTPUT_JSON.write_text(json.dumps(fallback, indent=2))
        return fallback


if __name__ == "__main__":
    result = fetch_latest_predisp_totals()
    print(json.dumps(result, indent=2))