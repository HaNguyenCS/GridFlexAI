"""
Build a Toronto flexibility asset registry.

Current MVP:
- Uses synthetic asset pools grounded in Toronto intervention categories.
- Later can be replaced/enriched by City of Toronto Open Data:
  - Annual Energy Consumption
  - EV Charging Stations
  - Renewable Energy Installations
  - Apartment Building Registration

Output:
data/processed/flex_assets.json

Run:
python src/ingestion/build_toronto_flex_assets.py
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path


OUTPUT_JSON = Path("data/processed/flex_assets.json")


def build_flex_assets() -> dict:
    assets = [
        {
            "asset_id": "BATTERY_POOL_001",
            "asset_type": "Battery / Storage",
            "zone": "Etobicoke",
            "estimated_reduction_mw": 100,
            "activation_minutes": 1,
            "duration_minutes": 60,
            "comfort_impact": "low",
            "source_dataset": "synthetic_demo_pool",
            "toronto_open_data_role": "future renewable/storage asset enrichment",
        },
        {
            "asset_id": "EV_POOL_001",
            "asset_type": "EV Charging Delay",
            "zone": "North York",
            "estimated_reduction_mw": 180,
            "activation_minutes": 5,
            "duration_minutes": 90,
            "comfort_impact": "low",
            "source_dataset": "synthetic_demo_pool",
            "toronto_open_data_role": "future City EV charging station map enrichment",
        },
        {
            "asset_id": "HVAC_POOL_001",
            "asset_type": "City / Commercial HVAC",
            "zone": "Downtown",
            "estimated_reduction_mw": 250,
            "activation_minutes": 10,
            "duration_minutes": 120,
            "comfort_impact": "medium",
            "source_dataset": "synthetic_demo_pool",
            "toronto_open_data_role": "future Annual Energy Consumption enrichment",
        },
        {
            "asset_id": "THERMO_POOL_001",
            "asset_type": "Residential Thermostat Cluster",
            "zone": "Scarborough",
            "estimated_reduction_mw": 120,
            "activation_minutes": 10,
            "duration_minutes": 120,
            "comfort_impact": "medium",
            "source_dataset": "synthetic_demo_pool",
            "toronto_open_data_role": "future Apartment Building Registration enrichment",
        },
    ]

    result = {
        "source": "GridFlex demo flexibility registry",
        "assets": assets,
        "total_available_mw": sum(asset["estimated_reduction_mw"] for asset in assets),
        "built_at_utc": datetime.now(UTC).isoformat(),
        "honesty_note": (
            "Current asset MW values are simulated for the hackathon demo. "
            "Asset categories are designed to map to Toronto Open Data datasets."
        ),
    }

    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_JSON.write_text(json.dumps(result, indent=2))

    return result


if __name__ == "__main__":
    print(json.dumps(build_flex_assets(), indent=2))