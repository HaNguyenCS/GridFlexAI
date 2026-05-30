"""
Fetch current weather for Toronto.

For hackathon reliability, this uses Open-Meteo's public API because it is simple
and does not require an API key. This gives us real current temperature and humidity.

Output:
data/processed/latest_weather.json

Run:
python src/ingestion/fetch_weather.py
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, UTC
from pathlib import Path
from typing import Any

import requests


OUTPUT_JSON = Path("data/processed/latest_weather.json")
CACHE_JSON = Path("data/processed/cached_weather.json")
MOCK_JSON = Path("data/mock/mock_live_grid.json")

# Toronto approximate coordinates
TORONTO_LAT = 43.6532
TORONTO_LON = -79.3832


def ensure_dirs() -> None:
    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)


def load_json(path: Path) -> dict[str, Any]:
    with path.open("r") as f:
        return json.load(f)


def fetch_current_weather() -> dict[str, Any]:
    url = "https://api.open-meteo.com/v1/forecast"

    params = {
        "latitude": TORONTO_LAT,
        "longitude": TORONTO_LON,
        "current": "temperature_2m,relative_humidity_2m,wind_speed_10m",
        "timezone": "America/Toronto",
    }

    response = requests.get(url, params=params, timeout=20)
    response.raise_for_status()

    payload = response.json()
    current = payload.get("current", {})

    temperature = current.get("temperature_2m")
    humidity = current.get("relative_humidity_2m")
    wind_speed = current.get("wind_speed_10m")

    if temperature is None or humidity is None:
        raise RuntimeError(f"Weather payload missing required fields: {payload}")

    return {
        "source": "Open-Meteo current weather",
        "location": "Toronto",
        "timestamp": current.get("time") or datetime.now(UTC).isoformat(),
        "temperature_c": float(temperature),
        "humidity": float(humidity),
        "wind_speed_kmh": float(wind_speed) if wind_speed is not None else None,
        "ingested_at_utc": datetime.now(UTC).isoformat(),
    }


def load_cached_or_mock() -> dict[str, Any]:
    if CACHE_JSON.exists():
        data = load_json(CACHE_JSON)
        data["fallback_used"] = "cached_weather"
        return data

    if MOCK_JSON.exists():
        mock = load_json(MOCK_JSON)
        return {
            "source": "mock_live_grid",
            "location": "Toronto",
            "temperature_c": mock.get("temperature_c", 31.2),
            "humidity": mock.get("humidity", 68),
            "wind_speed_kmh": None,
            "fallback_used": "mock_live_grid",
            "ingested_at_utc": datetime.now(UTC).isoformat(),
        }

    raise RuntimeError("No cached weather or mock weather available.")


def fetch_latest_weather() -> dict[str, Any]:
    ensure_dirs()

    try:
        weather = fetch_current_weather()
        OUTPUT_JSON.write_text(json.dumps(weather, indent=2))
        CACHE_JSON.write_text(json.dumps(weather, indent=2))
        return weather

    except Exception as exc:
        print(f"[WARN] Weather fetch failed: {exc}", file=sys.stderr)
        fallback = load_cached_or_mock()
        OUTPUT_JSON.write_text(json.dumps(fallback, indent=2))
        return fallback


if __name__ == "__main__":
    result = fetch_latest_weather()
    print(json.dumps(result, indent=2))