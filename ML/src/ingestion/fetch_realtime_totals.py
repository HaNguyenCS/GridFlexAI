"""
Fetch and parse the latest IESO RealtimeTotals report.

Purpose:
- Pull latest real-time IESO grid data
- Extract Ontario demand, market demand, and scheduled operating reserve
- Save a normalized JSON snapshot for the backend

Output:
data/processed/latest_realtime_totals.json

Run:
python src/ingestion/fetch_realtime_totals.py
"""

from __future__ import annotations

import json
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urljoin

import requests
import xml.etree.ElementTree as ET


BASE_URL = "https://reports-public.ieso.ca/public/RealtimeTotals/"
RAW_DIR = Path("data/raw/ieso")
PROCESSED_DIR = Path("data/processed")
OUTPUT_JSON = PROCESSED_DIR / "latest_realtime_totals.json"
CACHE_JSON = PROCESSED_DIR / "cached_realtime_totals.json"
MOCK_JSON = Path("data/mock/mock_live_grid.json")


def ensure_dirs() -> None:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)


def fetch_directory_html() -> str:
    response = requests.get(BASE_URL, timeout=20)
    response.raise_for_status()
    return response.text


def find_latest_realtime_totals_url(directory_html: str) -> str:
    """
    IESO public report directories usually list files like:
    PUB_RealtimeTotals_YYYYMMDDHH.xml

    This function finds XML links and returns the latest by filename sort.
    """
    xml_files = re.findall(r'href="([^"]*RealtimeTotals[^"]*\.xml)"', directory_html)

    if not xml_files:
        # Fallback: any XML file in the directory
        xml_files = re.findall(r'href="([^"]*\.xml)"', directory_html)

    if not xml_files:
        raise RuntimeError("No XML files found in IESO RealtimeTotals directory.")

    xml_files = sorted(set(xml_files))
    latest_file = xml_files[-1]

    return urljoin(BASE_URL, latest_file)


def download_file(url: str) -> Path:
    response = requests.get(url, timeout=30)
    response.raise_for_status()

    filename = url.split("/")[-1]
    local_path = RAW_DIR / filename
    local_path.write_bytes(response.content)

    return local_path


def strip_namespace(tag: str) -> str:
    return tag.split("}", 1)[-1] if "}" in tag else tag


def xml_to_records(root: ET.Element) -> list[dict[str, Any]]:
    """
    Converts XML tree into nested-ish flat records.

    Because IESO XML schemas can be annoying, this is intentionally flexible:
    - It walks all elements
    - Captures tag text where present
    - Groups likely interval records
    """
    records = []

    for elem in root.iter():
        tag = strip_namespace(elem.tag).lower()

        # These are common container names in IESO report files.
        if any(key in tag for key in ["interval", "row", "record", "totals"]):
            record = {}

            for child in elem.iter():
                child_tag = strip_namespace(child.tag)
                text = (child.text or "").strip()

                if text:
                    record[child_tag] = text

            if record:
                records.append(record)

    return records


def find_numeric_value(record: dict[str, Any], candidate_keywords: list[str]) -> Optional[float]:
    """
    Tries to find a numeric value from a record using fuzzy key matching.
    """
    normalized = {
        re.sub(r"[^a-z0-9]", "", key.lower()): value
        for key, value in record.items()
    }

    for raw_key, raw_value in normalized.items():
        if all(keyword in raw_key for keyword in candidate_keywords):
            try:
                return float(str(raw_value).replace(",", ""))
            except ValueError:
                continue

    return None


def find_text_value(record: dict[str, Any], candidate_keywords: list[str]) -> Optional[str]:
    normalized = {
        re.sub(r"[^a-z0-9]", "", key.lower()): value
        for key, value in record.items()
    }

    for raw_key, raw_value in normalized.items():
        if all(keyword in raw_key for keyword in candidate_keywords):
            return str(raw_value)

    return None


def parse_timestamp_from_filename(path: Path) -> Optional[str]:
    """
    Extracts timestamp from filenames like:
    PUB_RealtimeTotals_2026053011.xml

    Returns ISO-like string if possible.
    """
    match = re.search(r"(\d{10})", path.name)
    if not match:
        return None

    raw = match.group(1)

    try:
        dt = datetime.strptime(raw, "%Y%m%d%H")
        return dt.isoformat()
    except ValueError:
        return None


def parse_realtime_totals_xml(path: Path) -> dict[str, Any]:
    tree = ET.parse(path)
    root = tree.getroot()

    records = xml_to_records(root)

    if not records:
        raise RuntimeError("No records found in XML. Parser may need schema-specific adjustment.")

    # Keep only rows that have MarketQuantity + EnergyMW
    clean_rows = []
    for record in records:
        market_quantity = record.get("MarketQuantity")
        energy_mw = record.get("EnergyMW")
        interval = record.get("Interval")

        if market_quantity and energy_mw and interval:
            try:
                clean_rows.append({
                    "interval": int(interval),
                    "market_quantity": market_quantity.strip().upper(),
                    "energy_mw": float(str(energy_mw).replace(",", "")),
                })
            except ValueError:
                continue

    if not clean_rows:
        debug_path = PROCESSED_DIR / "realtime_totals_debug_records.json"
        debug_path.write_text(json.dumps(records[:50], indent=2))
        raise RuntimeError(
            f"Could not find MarketQuantity/EnergyMW rows. Wrote sample records to {debug_path}"
        )

    # Use the latest interval available in the current report
    latest_interval = max(row["interval"] for row in clean_rows)
    latest_rows = [row for row in clean_rows if row["interval"] == latest_interval]

    values_by_quantity = {
        row["market_quantity"]: row["energy_mw"]
        for row in latest_rows
    }

    ontario_demand = values_by_quantity.get("ONTARIO DEMAND")

    # IESO sometimes refers to total energy / market demand in RealtimeTotals.
    market_demand = (
        values_by_quantity.get("TOTAL ENERGY")
        or values_by_quantity.get("MARKET DEMAND")
        or values_by_quantity.get("TOTAL ENERGY (MARKET DEMAND)")
    )

    scheduled_reserve = (
        values_by_quantity.get("OPERATING RESERVE")
        or values_by_quantity.get("SCHEDULED OPERATING RESERVE")
        or values_by_quantity.get("10S RESERVE")
        or values_by_quantity.get("10N RESERVE")
        or values_by_quantity.get("30R RESERVE")
    )

    if ontario_demand is None:
        raise RuntimeError(
            f"Could not find ONTARIO DEMAND in latest interval. Found: {list(values_by_quantity.keys())}"
        )

    # If market demand is missing, use Ontario demand as fallback for now.
    if market_demand is None:
        market_demand = ontario_demand

    if scheduled_reserve is None:
        scheduled_reserve = 0.0

    reserve_margin_ratio = scheduled_reserve / ontario_demand if ontario_demand else 0.0

    return {
        "source": "IESO RealtimeTotals",
        "source_file": path.name,
        "timestamp": parse_timestamp_from_filename(path) or datetime.utcnow().isoformat(),
        "interval": latest_interval,
        "ontario_demand_mw": round(float(ontario_demand), 3),
        "market_demand_mw": round(float(market_demand), 3),
        "scheduled_operating_reserve_mw": round(float(scheduled_reserve), 3),
        "reserve_margin_ratio": round(float(reserve_margin_ratio), 6),
        "available_market_quantities": list(values_by_quantity.keys()),
        "ingested_at_utc": datetime.utcnow().isoformat(),
    }

def load_cached_or_mock() -> dict[str, Any]:
    if CACHE_JSON.exists():
        with CACHE_JSON.open("r") as f:
            data = json.load(f)
            data["fallback_used"] = "cached_realtime_totals"
            return data

    if MOCK_JSON.exists():
        with MOCK_JSON.open("r") as f:
            data = json.load(f)
            data["fallback_used"] = "mock_live_grid"
            return data

    raise RuntimeError("No cached realtime totals or mock payload available.")


def fetch_latest_realtime_totals() -> dict[str, Any]:
    ensure_dirs()

    try:
        html = fetch_directory_html()
        latest_url = find_latest_realtime_totals_url(html)
        xml_path = download_file(latest_url)
        parsed = parse_realtime_totals_xml(xml_path)

        OUTPUT_JSON.write_text(json.dumps(parsed, indent=2))
        CACHE_JSON.write_text(json.dumps(parsed, indent=2))

        return parsed

    except Exception as exc:
        print(f"[WARN] Live IESO fetch failed: {exc}", file=sys.stderr)
        fallback = load_cached_or_mock()
        OUTPUT_JSON.write_text(json.dumps(fallback, indent=2))
        return fallback


if __name__ == "__main__":
    result = fetch_latest_realtime_totals()
    print(json.dumps(result, indent=2))