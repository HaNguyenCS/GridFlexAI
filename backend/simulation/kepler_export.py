"""Kepler-style node and flow export for ward simulation ticks."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from backend.schemas.simulation import (
    Bid,
    KeplerFlow,
    KeplerNode,
    MarketClearResponse,
    WardPrediction,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
GEOJSON_PATH = REPO_ROOT / "ML" / "data" / "processed" / "toronto_wards_zones.geojson"
GRID_CENTER = (43.6532, -79.3832)


@lru_cache(maxsize=1)
def _ward_centroids() -> dict[str, tuple[float, float]]:
    if not GEOJSON_PATH.exists():
        return {}

    with GEOJSON_PATH.open(encoding="utf-8") as handle:
        geojson = json.load(handle)

    centroids: dict[str, tuple[float, float]] = {}
    for feature in geojson.get("features", []):
        props = feature.get("properties", {})
        zone_id = props.get("zone_id")
        geometry = feature.get("geometry", {})
        coords = geometry.get("coordinates", [])
        if not zone_id or not coords:
            continue

        points: list[tuple[float, float]] = []

        def walk(node) -> None:
            if isinstance(node, (list, tuple)):
                if len(node) >= 2 and isinstance(node[0], (int, float)):
                    points.append((float(node[1]), float(node[0])))
                else:
                    for child in node:
                        walk(child)

        walk(coords)
        if not points:
            continue
        lat = sum(p[0] for p in points) / len(points)
        lng = sum(p[1] for p in points) / len(points)
        centroids[zone_id] = (lat, lng)

    return centroids


def _accepted_mw_by_ward(
    market_result: MarketClearResponse,
) -> dict[str, float]:
    totals: dict[str, float] = {}
    for bid in market_result.accepted_bids:
        totals[bid.ward_id] = totals.get(bid.ward_id, 0.0) + bid.quantity_mw
    return totals


def build_kepler_nodes(
    timestamp: str,
    ward_predictions: list[WardPrediction],
    market_result: MarketClearResponse,
    *,
    stress_score: int,
) -> list[KeplerNode]:
    centroids = _ward_centroids()
    accepted = _accepted_mw_by_ward(market_result)

    nodes: list[KeplerNode] = []
    for prediction in ward_predictions:
        lat, lng = centroids.get(prediction.ward_id, GRID_CENTER)
        accepted_mw = accepted.get(prediction.ward_id, 0.0)
        dispatch = "accepted" if accepted_mw > 0 else "none"
        if prediction.recommended_action.value != "none" and accepted_mw == 0:
            dispatch = "rejected"

        nodes.append(
            KeplerNode(
                ward_id=prediction.ward_id,
                ward_name=prediction.ward_name,
                timestamp=timestamp,
                lat=lat,
                lng=lng,
                event_type=prediction.event_type.value,
                event_probability=prediction.event_probability,
                risk_level=prediction.risk_level.value,
                stress_score=stress_score,
                predicted_duration_minutes=prediction.predicted_duration_minutes,
                recommended_action=prediction.recommended_action.value,
                recommended_bid_mw=prediction.recommended_bid_mw,
                accepted_bid_mw=accepted_mw,
                dispatch_status=dispatch,
                ward_load_proxy_mw=prediction.baseline_load_mw,
                ward_flexible_capacity_mw=prediction.ward_flexible_capacity_mw,
            )
        )
    return nodes


def build_kepler_flows(
    timestamp: str,
    accepted_bids: list[Bid],
    ward_predictions: list[WardPrediction],
) -> list[KeplerFlow]:
    centroids = _ward_centroids()
    risk_by_ward = {p.ward_id: p.risk_level.value for p in ward_predictions}
    target_lat, target_lng = GRID_CENTER

    flows: list[KeplerFlow] = []
    for index, bid in enumerate(accepted_bids):
        lat, lng = centroids.get(bid.ward_id, GRID_CENTER)
        flows.append(
            KeplerFlow(
                flow_id=f"flow_{bid.bid_id}",
                timestamp=timestamp,
                source_ward_id=bid.ward_id,
                source_lat=lat,
                source_lng=lng,
                target_lat=target_lat,
                target_lng=target_lng,
                flow_mw=bid.quantity_mw,
                risk_level=risk_by_ward.get(bid.ward_id, "normal"),
                dispatch_status=bid.status.value,
            )
        )
    return flows
