"""
Build ward-based zone registry from City of Toronto Open Data.

Input (default):
  ../../City Wards Data - 4326.geojson

Outputs:
  ../../data/processed/toronto_wards_zones.geojson
  ../../data/processed/ward_zone_registry.json

Run from ML/:
  python src/ingestion/build_ward_zones.py
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

from pyproj import Transformer # type: ignore
from shapely.geometry import shape
from shapely.ops import transform

ML_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = ML_ROOT.parent
DEFAULT_WARDS = REPO_ROOT / "City Wards Data - 4326.geojson"
ZONES_GEOJSON = ML_ROOT / "data" / "processed" / "toronto_wards_zones.geojson"
REGISTRY_JSON = ML_ROOT / "data" / "processed" / "ward_zone_registry.json"

TO_UTM = Transformer.from_crs("EPSG:4326", "EPSG:32617", always_xy=True)

# Synthetic marginal supply cost ($/MW) tiers by ward character.
COST_TIERS: dict[str, int] = {
    "ward_13": 7_800,  # Toronto Centre
    "ward_10": 7_500,  # Spadina-Fort York
    "ward_11": 7_400,  # University-Rosedale
    "ward_09": 6_200,  # Davenport
    "ward_12": 6_000,  # Toronto-St. Paul's
    "ward_14": 5_900,  # Toronto-Danforth
    "ward_04": 5_700,  # Parkdale-High Park
    "ward_15": 5_500,  # Don Valley West
}
DEFAULT_OUTER_COST = 3_400
DEFAULT_MID_COST = 4_600

# Nominal Toronto envelope used to derive per-ward MW limits.
TORONTO_NOMINAL_DEMAND_MW = 5_200
# Hard capacity = share of this total. Demand above this is over-capacity.
CAPACITY_SHARE_FACTOR = 0.82
# Existing grid supply before the solver adds incremental MW.
BASELINE_SUPPLY_FACTOR = 0.86


def zone_id_from_props(props: dict) -> str:
    return f"ward_{int(props['AREA_SHORT_CODE']):02d}"


def supply_cost_for_zone(zone_id: str) -> int:
    if zone_id in COST_TIERS:
        return COST_TIERS[zone_id]
    number = int(zone_id.split("_")[1])
    if number in {6, 7, 8, 16, 17, 18, 19, 21}:
        return DEFAULT_MID_COST
    return DEFAULT_OUTER_COST


def projected_area_km2(geometry: dict) -> float:
    geom = shape(geometry)
    projected = transform(lambda x, y, z=None: TO_UTM.transform(x, y), geom)
    return projected.area / 1_000_000


def build_ward_zones(wards_path: Path = DEFAULT_WARDS) -> dict:
    if not wards_path.exists():
        raise FileNotFoundError(f"Missing wards file: {wards_path}")

    with wards_path.open(encoding="utf-8") as handle:
        source = json.load(handle)

    features = []
    registry_zones = []
    total_area = 0.0

    for feature in source["features"]:
        props = feature["properties"]
        zone_id = zone_id_from_props(props)
        area_km2 = round(projected_area_km2(feature["geometry"]), 4)
        total_area += area_km2

        enriched = {
            **props,
            "zone_id": zone_id,
            "ward_number": props["AREA_SHORT_CODE"],
            "ward_name": props["AREA_NAME"],
            "area_km2": area_km2,
            "supply_cost_per_mw": supply_cost_for_zone(zone_id),
        }
        features.append(
            {
                "type": "Feature",
                "properties": enriched,
                "geometry": feature["geometry"],
            }
        )
        registry_zones.append(
            {
                "zone_id": zone_id,
                "ward_number": props["AREA_SHORT_CODE"],
                "ward_name": props["AREA_NAME"],
                "area_id": int(props["AREA_ID"]),
                "object_id": int(props["OBJECTID"]),
                "area_attr_id": int(props["AREA_ATTR_ID"]),
                "area_km2": area_km2,
                "supply_cost_per_mw": supply_cost_for_zone(zone_id),
            }
        )

    for zone in registry_zones:
        share = zone["area_km2"] / total_area
        zone["load_share_pct"] = round(100.0 * share, 4)
        zone["capacity_mw"] = round(TORONTO_NOMINAL_DEMAND_MW * share * CAPACITY_SHARE_FACTOR, 3)
        zone["baseline_supply_mw"] = round(
            TORONTO_NOMINAL_DEMAND_MW * share * BASELINE_SUPPLY_FACTOR, 3
        )

    for feature in features:
        props = feature["properties"]
        zone_id = props["zone_id"]
        match = next(z for z in registry_zones if z["zone_id"] == zone_id)
        props["load_share_pct"] = match["load_share_pct"]
        props["capacity_mw"] = match["capacity_mw"]
        props["baseline_supply_mw"] = match["baseline_supply_mw"]

    features.sort(key=lambda f: f["properties"]["ward_number"])
    registry_zones.sort(key=lambda z: z["ward_number"])

    collection = {
        "type": "FeatureCollection",
        "name": "Toronto City Wards — GridFlex Zones",
        "crs": source.get("crs"),
        "metadata": {
            "source": "City of Toronto — City Wards Data",
            "zone_count": len(features),
            "built_at_utc": datetime.now(UTC).isoformat(),
            "note": (
                "Each zone_id maps to a city ward. supply_cost_per_mw is a "
                "synthetic fixed marginal cost used by the supply solver."
            ),
        },
        "features": features,
    }

    registry = {
        "source": "City Wards Data - 4326.geojson",
        "zone_count": len(registry_zones),
        "zone_ids": [zone["zone_id"] for zone in registry_zones],
        "zones": registry_zones,
        "built_at_utc": datetime.now(UTC).isoformat(),
    }

    ZONES_GEOJSON.parent.mkdir(parents=True, exist_ok=True)
    ZONES_GEOJSON.write_text(json.dumps(collection, indent=2), encoding="utf-8")
    REGISTRY_JSON.write_text(json.dumps(registry, indent=2), encoding="utf-8")

    print(f"Wrote {len(features)} ward zones to {ZONES_GEOJSON}")
    print(f"Wrote registry to {REGISTRY_JSON}")
    return registry


if __name__ == "__main__":
    registry = build_ward_zones()
    print("Zone IDs:", ", ".join(registry["zone_ids"]))
