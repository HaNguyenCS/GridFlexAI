"""
Build Toronto assessment regions from City building outlines.

Uses a fixed square grid in UTM zone 17N (~1.5 km cells). Each region is a
rectangle that contains at least one building footprint centroid.

Input (default):
  ../../Building Outlines - 4326.geojson

Output (default):
  ../../data/processed/toronto_regions_grid.geojson

Run from ML/:
  python src/ingestion/build_toronto_regions.py
"""

from __future__ import annotations

import json
import math
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from pyproj import Transformer
from shapely.geometry import shape

ML_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = ML_ROOT.parent
DEFAULT_BUILDINGS = REPO_ROOT / "Building Outlines - 4326.geojson"
DEFAULT_OUTPUT = ML_ROOT / "data" / "processed" / "toronto_regions_grid.geojson"

CELL_SIZE_M = 1_500
M_PER_DEG_LAT = 111_320

TO_UTM = Transformer.from_crs("EPSG:4326", "EPSG:32617", always_xy=True)
TO_WGS84 = Transformer.from_crs("EPSG:32617", "EPSG:4326", always_xy=True)


@dataclass(frozen=True)
class GridCell:
    row: int
    col: int

    @property
    def zone_id(self) -> str:
        return f"grid_r{self.row:03d}_c{self.col:03d}"


def parent_zone(lat: float, lon: float) -> str:
    if lon < -79.50:
        return "Etobicoke"
    if lon > -79.28:
        return "Scarborough"
    if lat > 43.72:
        return "North York"
    return "Downtown"


def footprint_area_m2(geom, lat: float) -> float:
    m_per_deg_lon = M_PER_DEG_LAT * math.cos(math.radians(lat))
    return abs(geom.area) * M_PER_DEG_LAT * m_per_deg_lon


def iter_building_features(path: Path):
    feature_prefix = '{ "type": "Feature"'
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            stripped = line.strip().rstrip(",")
            if not stripped.startswith(feature_prefix):
                continue
            yield json.loads(stripped)


def cell_for_point(x_utm: float, y_utm: float, origin_x: float, origin_y: float) -> GridCell:
    col = int((x_utm - origin_x) // CELL_SIZE_M)
    row = int((y_utm - origin_y) // CELL_SIZE_M)
    return GridCell(row=row, col=col)


def cell_bounds_utm(cell: GridCell, origin_x: float, origin_y: float) -> tuple[float, float, float, float]:
    x0 = origin_x + cell.col * CELL_SIZE_M
    y0 = origin_y + cell.row * CELL_SIZE_M
    return x0, y0, x0 + CELL_SIZE_M, y0 + CELL_SIZE_M


def ring_from_cell(cell: GridCell, origin_x: float, origin_y: float) -> list[list[float]]:
    x0, y0, x1, y1 = cell_bounds_utm(cell, origin_x, origin_y)
    corners_utm = [(x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0)]
    ring: list[list[float]] = []
    for x, y in corners_utm:
        lon, lat = TO_WGS84.transform(x, y)
        ring.append([lon, lat])
    return ring


def aggregate_buildings(path: Path) -> tuple[dict[GridCell, dict], float, float]:
    stats: dict[GridCell, dict] = defaultdict(
        lambda: {
            "building_count": 0,
            "load_proxy": 0.0,
            "max_height_m": 0.0,
            "sum_lat": 0.0,
            "sum_lon": 0.0,
        }
    )
    min_x = math.inf
    min_y = math.inf
    max_x = -math.inf
    max_y = -math.inf

    for idx, feature in enumerate(iter_building_features(path), start=1):
        props = feature.get("properties") or {}
        geom = shape(feature["geometry"])
        centroid = geom.centroid
        lat = centroid.y
        lon = centroid.x
        x_utm, y_utm = TO_UTM.transform(lon, lat)

        min_x = min(min_x, x_utm)
        min_y = min(min_y, y_utm)
        max_x = max(max_x, x_utm)
        max_y = max(max_y, y_utm)

        if idx % 100_000 == 0:
            print(f"  scanned {idx:,} buildings for grid bounds")

    origin_x = math.floor(min_x / CELL_SIZE_M) * CELL_SIZE_M
    origin_y = math.floor(min_y / CELL_SIZE_M) * CELL_SIZE_M
    print(f"  grid origin UTM: ({origin_x:.0f}, {origin_y:.0f})")
    print(f"  cell size: {CELL_SIZE_M} m")

    for idx, feature in enumerate(iter_building_features(path), start=1):
        props = feature.get("properties") or {}
        geom = shape(feature["geometry"])
        centroid = geom.centroid
        lat = centroid.y
        lon = centroid.x
        x_utm, y_utm = TO_UTM.transform(lon, lat)
        cell = cell_for_point(x_utm, y_utm, origin_x, origin_y)

        raw_height = props.get("DERIVED_HEIGHT")
        try:
            height = float(raw_height) if raw_height not in (None, "", "None") else 0.0
        except (TypeError, ValueError):
            height = 0.0
        area_m2 = footprint_area_m2(geom, lat)

        bucket = stats[cell]
        bucket["building_count"] += 1
        bucket["load_proxy"] += height * area_m2
        bucket["max_height_m"] = max(bucket["max_height_m"], height)
        bucket["sum_lat"] += lat
        bucket["sum_lon"] += lon

        if idx % 100_000 == 0:
            print(f"  processed {idx:,} buildings, {len(stats):,} regions so far")

    return stats, origin_x, origin_y


def build_feature_collection(
    stats: dict[GridCell, dict],
    origin_x: float,
    origin_y: float,
) -> dict:
    total_load = sum(item["load_proxy"] for item in stats.values())
    features = []

    for cell in sorted(stats, key=lambda c: (c.row, c.col)):
        item = stats[cell]
        count = item["building_count"]
        center_lat = item["sum_lat"] / count
        center_lon = item["sum_lon"] / count
        load_share_pct = (
            round(100.0 * item["load_proxy"] / total_load, 4) if total_load else 0.0
        )

        features.append(
            {
                "type": "Feature",
                "properties": {
                    "zone_id": cell.zone_id,
                    "region_id": cell.zone_id,
                    "region_type": "grid_1500m",
                    "grid_row": cell.row,
                    "grid_col": cell.col,
                    "parent_zone": parent_zone(center_lat, center_lon),
                    "building_count": count,
                    "load_proxy": round(item["load_proxy"], 2),
                    "load_share_pct": load_share_pct,
                    "max_height_m": round(item["max_height_m"], 2),
                    "center_lat": round(center_lat, 6),
                    "center_lon": round(center_lon, 6),
                },
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [ring_from_cell(cell, origin_x, origin_y)],
                },
            }
        )

    return {
        "type": "FeatureCollection",
        "name": "Toronto Regions Grid 1500m",
        "crs": {
            "type": "name",
            "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"},
        },
        "metadata": {
            "source": "City of Toronto Building Outlines",
            "method": "Square grid (UTM 17N) from building centroids",
            "cell_size_m": CELL_SIZE_M,
            "projection": "EPSG:32617",
            "region_count": len(features),
            "built_at_utc": datetime.now(UTC).isoformat(),
            "note": (
                "Synthetic rectangular grid regions for visualization. "
                "Not official Toronto Hydro feeder boundaries."
            ),
        },
        "features": features,
    }


def build_toronto_regions(
    buildings_path: Path = DEFAULT_BUILDINGS,
    output_path: Path = DEFAULT_OUTPUT,
) -> dict:
    if not buildings_path.exists():
        raise FileNotFoundError(f"Missing building outlines: {buildings_path}")

    print(f"Reading buildings from {buildings_path}")
    stats, origin_x, origin_y = aggregate_buildings(buildings_path)
    collection = build_feature_collection(stats, origin_x, origin_y)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(collection, indent=2), encoding="utf-8")

    print(f"Wrote {collection['metadata']['region_count']} regions to {output_path}")
    return collection


if __name__ == "__main__":
    build_toronto_regions()
