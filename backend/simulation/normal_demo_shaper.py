from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any


def _enabled() -> bool:
    return os.getenv("NORMAL_DEMO_SHAPER", "0").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def _forced_scenario() -> str | None:
    value = os.getenv("NORMAL_DEMO_SCENARIO", "").strip().lower()

    aliases = {
        "calm": "calm",
        "normal": "calm",
        "problem": "localized_problem",
        "tightening": "localized_problem",
        "localized": "localized_problem",
        "constrained": "localized_constrained",
        "critical": "localized_constrained",
        "recovery": "recovery",
    }

    return aliases.get(value)


def _scenario_from_clock() -> str:
    forced = _forced_scenario()
    if forced:
        return forced

    now = datetime.now(timezone.utc)

    # 80-second loop, slower and more demo-friendly.
    # 0-19s: calm
    # 20-39s: localized problem
    # 40-59s: localized constrained
    # 60-79s: recovery
    phase = (now.second // 20) % 4

    if phase == 0:
        return "calm"
    if phase == 1:
        return "localized_problem"
    if phase == 2:
        return "localized_constrained"
    return "recovery"


def _ward_num(ward_id: str) -> int:
    digits = "".join(ch for ch in str(ward_id) if ch.isdigit())
    return int(digits) if digits else 0


def _safe_set(obj: Any, key: str, value: Any) -> None:
    try:
        setattr(obj, key, value)
    except Exception:
        try:
            obj[key] = value
        except Exception:
            pass


def _safe_get(obj: Any, key: str, default: Any = None) -> Any:
    try:
        return getattr(obj, key)
    except Exception:
        try:
            return obj.get(key, default)
        except Exception:
            return default


# Chosen for demo geography:
# - East / Scarborough-ish and downtown-adjacent wards become stressed first.
# - These IDs match your backend ward IDs: ward_01 ... ward_25.
RED_WARDS = {10, 14, 15, 19, 20}
ORANGE_WARDS = {9, 13, 16, 17, 21, 22}
WATCH_WARDS = {8, 11, 12, 18, 23, 24}

RECOVERY_FIRST = {10, 14, 19, 20}
RECOVERY_LAGGING = {15, 21, 22}


def _ward_profile(scenario: str, ward_id: str) -> dict[str, Any]:
    n = _ward_num(ward_id)

    if scenario == "calm":
        return {
            "risk_level": "normal",
            "event_type": "normal",
            "event_probability": 0.08,
            "recommended_action": "none",
            "recommended_bid_mw": 0.0,
            "confidence": 0.78,
            "drivers": [
                f"{ward_id} is operating within normal range.",
            ],
        }

    if scenario == "localized_problem":
        if n in RED_WARDS:
            return {
                "risk_level": "high",
                "event_type": "demand_spike",
                "event_probability": 0.72,
                "recommended_action": "reduce_load",
                "recommended_bid_mw": round(18 + (n % 4) * 4, 2),
                "confidence": 0.84,
                "drivers": [
                    f"{ward_id} is locally constrained and needs demand reduction.",
                    "Peak-window load is rising faster than local flexibility.",
                ],
            }

        if n in ORANGE_WARDS:
            return {
                "risk_level": "medium",
                "event_type": "demand_spike",
                "event_probability": 0.52,
                "recommended_action": "shift_load",
                "recommended_bid_mw": round(8 + (n % 5) * 2, 2),
                "confidence": 0.76,
                "drivers": [
                    f"{ward_id} is showing early overload pressure.",
                    "Ward agent can offer load shifting into the market.",
                ],
            }

        if n in WATCH_WARDS:
            return {
                "risk_level": "normal",
                "event_type": "normal",
                "event_probability": 0.26,
                "recommended_action": "monitor",
                "recommended_bid_mw": 0.0,
                "confidence": 0.68,
                "drivers": [
                    f"{ward_id} is stable but close to monitored corridors.",
                ],
            }

        return {
            "risk_level": "normal",
            "event_type": "normal",
            "event_probability": 0.12,
            "recommended_action": "none",
            "recommended_bid_mw": 0.0,
            "confidence": 0.74,
            "drivers": [
                f"{ward_id} has enough local flexibility and remains stable.",
            ],
        }

    if scenario == "localized_constrained":
        if n in RED_WARDS:
            return {
                "risk_level": "critical",
                "event_type": "demand_spike",
                "event_probability": 0.88,
                "recommended_action": "reduce_load",
                "recommended_bid_mw": round(28 + (n % 5) * 5, 2),
                "confidence": 0.91,
                "drivers": [
                    f"{ward_id} is a constrained ward and submits a reduction bid.",
                    "Local demand is above safe operating range.",
                ],
            }

        if n in ORANGE_WARDS:
            return {
                "risk_level": "high",
                "event_type": "demand_spike",
                "event_probability": 0.68,
                "recommended_action": "shift_load",
                "recommended_bid_mw": round(14 + (n % 4) * 3, 2),
                "confidence": 0.82,
                "drivers": [
                    f"{ward_id} is under pressure and prepares flexible load shifting.",
                    "Neighbouring constrained wards are increasing local stress.",
                ],
            }

        if n in WATCH_WARDS:
            return {
                "risk_level": "medium",
                "event_type": "demand_spike",
                "event_probability": 0.44,
                "recommended_action": "monitor",
                "recommended_bid_mw": 0.0,
                "confidence": 0.69,
                "drivers": [
                    f"{ward_id} is being monitored while nearby wards bid.",
                ],
            }

        return {
            "risk_level": "normal",
            "event_type": "normal",
            "event_probability": 0.18,
            "recommended_action": "none",
            "recommended_bid_mw": 0.0,
            "confidence": 0.74,
            "drivers": [
                f"{ward_id} remains stable and does not need to bid.",
            ],
        }

    # Recovery.
    if n in RECOVERY_FIRST:
        return {
            "risk_level": "normal",
            "event_type": "recovery",
            "event_probability": 0.18,
            "recommended_action": "none",
            "recommended_bid_mw": 0.0,
            "confidence": 0.86,
            "drivers": [
                f"{ward_id} has recovered after accepted flexibility dispatch.",
            ],
        }

    if n in RECOVERY_LAGGING:
        return {
            "risk_level": "medium",
            "event_type": "demand_spike",
            "event_probability": 0.42,
            "recommended_action": "shift_load",
            "recommended_bid_mw": round(8 + (n % 3) * 2, 2),
            "confidence": 0.76,
            "drivers": [
                f"{ward_id} is still recovering and may need remaining flexibility.",
            ],
        }

    if n in ORANGE_WARDS or n in WATCH_WARDS:
        return {
            "risk_level": "normal",
            "event_type": "recovery",
            "event_probability": 0.22,
            "recommended_action": "monitor",
            "recommended_bid_mw": 0.0,
            "confidence": 0.75,
            "drivers": [
                f"{ward_id} is stabilizing as the market clears accepted bids.",
            ],
        }

    return {
        "risk_level": "normal",
        "event_type": "normal",
        "event_probability": 0.10,
        "recommended_action": "none",
        "recommended_bid_mw": 0.0,
        "confidence": 0.76,
        "drivers": [
            f"{ward_id} remains stable.",
        ],
    }


def _shape_system_prediction(result: Any, scenario: str) -> None:
    grid = result.grid_prediction
    clearing = result.market_result.clearing_result

    if scenario == "calm":
        grid.event_type = "normal"
        grid.grid_stress_probability = min(float(grid.grid_stress_probability or 0.0), 0.28)
        grid.risk_level = "normal"
        grid.target_reduction_mw = 0
        grid.drivers = [
            "GX10 ML service connected; normal grid conditions.",
            "No material local flexibility dispatch required.",
        ]

        clearing.target_reduction_mw = 0
        clearing.stress_score_before = 24
        clearing.stress_score_after = 24
        clearing.accepted_reduction_mw = 0.0
        clearing.unfilled_reduction_mw = 0.0
        clearing.clearing_status = "monitoring"
        clearing.clearing_price_per_mwh = 0.0

    elif scenario == "localized_problem":
        grid.event_type = "demand_spike"
        grid.grid_stress_probability = 0.62
        grid.risk_level = "medium"
        grid.target_reduction_mw = 260
        grid.drivers = [
            "GX10 ML service predicts rising system stress.",
            "Stress is localized to a subset of Toronto wards.",
        ]

        clearing.target_reduction_mw = 260
        clearing.stress_score_before = 61
        clearing.stress_score_after = 49
        clearing.clearing_status = "partial"

    elif scenario == "localized_constrained":
        grid.event_type = "demand_spike"
        grid.grid_stress_probability = 0.79
        grid.risk_level = "high"
        grid.target_reduction_mw = 420
        grid.drivers = [
            "GX10 ML service predicts high system stress.",
            "Only constrained wards are escalated to red/orange.",
            "Ward agents submit bids where local flexibility is useful.",
        ]

        clearing.target_reduction_mw = 420
        clearing.stress_score_before = 78
        clearing.stress_score_after = 56
        clearing.clearing_status = "partial"

    else:
        grid.event_type = "recovery"
        grid.grid_stress_probability = 0.38
        grid.risk_level = "medium"
        grid.target_reduction_mw = 180
        grid.drivers = [
            "Accepted flexibility is reducing local grid stress.",
            "Recovered wards return to green before lagging wards.",
        ]

        clearing.target_reduction_mw = 180
        clearing.stress_score_before = 56
        clearing.stress_score_after = 34
        clearing.clearing_status = "cleared"


def _shape_ward_predictions(result: Any, scenario: str) -> dict[str, dict[str, Any]]:
    profiles: dict[str, dict[str, Any]] = {}

    for pred in result.ward_predictions:
        ward_id = _safe_get(pred, "ward_id", "")
        profile = _ward_profile(scenario, ward_id)
        profiles[ward_id] = profile

        _safe_set(pred, "risk_level", profile["risk_level"])
        _safe_set(pred, "event_type", profile["event_type"])
        _safe_set(pred, "event_probability", profile["event_probability"])
        _safe_set(pred, "recommended_action", profile["recommended_action"])
        _safe_set(pred, "recommended_bid_mw", profile["recommended_bid_mw"])
        _safe_set(pred, "confidence", profile["confidence"])
        _safe_set(pred, "drivers", profile["drivers"])

        # Keep load delta aligned with visible action.
        if profile["recommended_bid_mw"] > 0:
            _safe_set(pred, "expected_load_delta_mw", round(profile["recommended_bid_mw"] * 0.85, 2))
        else:
            _safe_set(pred, "expected_load_delta_mw", 0.0)

    return profiles


def _shape_agent_decisions(result: Any, profiles: dict[str, dict[str, Any]]) -> None:
    for decision in result.ward_agent_decisions:
        ward_id = _safe_get(decision, "ward_id", "")
        profile = profiles.get(ward_id)

        if not profile or profile["recommended_bid_mw"] <= 0:
            _safe_set(decision, "decision", "no_bid")
            _safe_set(decision, "bid", None)
            continue

        _safe_set(decision, "decision", "submit_bid")

        bid = _safe_get(decision, "bid", None)
        if bid is not None:
            try:
                bid.quantity_mw = profile["recommended_bid_mw"]
            except Exception:
                pass


def _filter_bids(result: Any, profiles: dict[str, dict[str, Any]], scenario: str) -> None:
    market = result.market_result
    clearing = market.clearing_result

    active_wards = {
        ward_id
        for ward_id, profile in profiles.items()
        if profile["recommended_bid_mw"] > 0
    }

    submitted = []
    for bid in getattr(result, "submitted_bids", []) or []:
        ward_id = _safe_get(bid, "ward_id", "")
        if ward_id in active_wards:
            try:
                bid.quantity_mw = profiles[ward_id]["recommended_bid_mw"]
            except Exception:
                pass
            submitted.append(bid)

    result.submitted_bids = submitted

    # Accepted bids should be a subset, not all 25 wards.
    if scenario == "calm":
        accepted_ward_nums: set[int] = set()
    elif scenario == "localized_problem":
        accepted_ward_nums = {10, 14, 19, 20}
    elif scenario == "localized_constrained":
        accepted_ward_nums = {10, 14, 15, 19, 20, 21, 22}
    else:
        accepted_ward_nums = {10, 14, 19, 20}

    accepted = []
    rejected = []

    for bid in submitted:
        ward_id = _safe_get(bid, "ward_id", "")
        if _ward_num(ward_id) in accepted_ward_nums:
            accepted.append(bid)
        else:
            rejected.append(bid)

    market.accepted_bids = accepted
    market.rejected_bids = rejected

    accepted_mw = round(
        sum(float(_safe_get(bid, "quantity_mw", 0.0) or 0.0) for bid in accepted),
        2,
    )

    target = float(_safe_get(clearing, "target_reduction_mw", 0.0) or 0.0)
    clearing.accepted_reduction_mw = accepted_mw
    clearing.unfilled_reduction_mw = round(max(0.0, target - accepted_mw), 2)

    if target <= 0:
        clearing.clearing_status = "monitoring"
        clearing.clearing_price_per_mwh = 0.0
    elif clearing.unfilled_reduction_mw <= 0:
        clearing.clearing_status = "cleared"
        clearing.clearing_price_per_mwh = max(float(_safe_get(b, "price_per_mwh", 0.0) or 0.0) for b in accepted) if accepted else 0.0
    else:
        clearing.clearing_status = "partial"
        clearing.clearing_price_per_mwh = max(float(_safe_get(b, "price_per_mwh", 0.0) or 0.0) for b in accepted) if accepted else 0.0


def _shape_kepler_nodes(result: Any, profiles: dict[str, dict[str, Any]]) -> None:
    accepted_wards = {
        _safe_get(bid, "ward_id", "")
        for bid in getattr(result.market_result, "accepted_bids", []) or []
    }

    submitted_wards = {
        _safe_get(bid, "ward_id", "")
        for bid in getattr(result, "submitted_bids", []) or []
    }

    accepted_bid_mw = {
        _safe_get(bid, "ward_id", ""): float(_safe_get(bid, "quantity_mw", 0.0) or 0.0)
        for bid in getattr(result.market_result, "accepted_bids", []) or []
    }

    for node in result.kepler_nodes:
        ward_id = _safe_get(node, "ward_id", "")
        profile = profiles.get(ward_id)

        if not profile:
            continue

        # Map color story:
        # - accepted wards recover to normal/green
        # - submitted but not accepted are still problem/high
        # - non-bidding wards follow profile risk
        if ward_id in accepted_wards:
            _safe_set(node, "risk_level", "normal")
            _safe_set(node, "dispatch_status", "accepted")
            _safe_set(node, "accepted_bid_mw", accepted_bid_mw.get(ward_id, 0.0))
        elif ward_id in submitted_wards:
            _safe_set(node, "risk_level", profile["risk_level"])
            _safe_set(node, "dispatch_status", "submitted")
            _safe_set(node, "accepted_bid_mw", 0.0)
        else:
            _safe_set(node, "risk_level", profile["risk_level"])
            _safe_set(node, "dispatch_status", "none")
            _safe_set(node, "accepted_bid_mw", 0.0)

        _safe_set(node, "recommended_action", profile["recommended_action"])
        _safe_set(node, "recommended_bid_mw", profile["recommended_bid_mw"])


def _shape_snapshot(result: Any, scenario: str) -> None:
    try:
        accepted = len(result.market_result.accepted_bids)
        submitted = len(result.submitted_bids)
        rejected = len(result.market_result.rejected_bids)

        result.snapshot["normal_demo_shaper"] = True
        result.snapshot["normal_demo_scenario"] = scenario
        result.snapshot["pipeline"] = {
            "forecast": {
                "risk_level": result.grid_prediction.risk_level,
                "stress_probability": result.grid_prediction.grid_stress_probability,
                "target_reduction_mw": result.grid_prediction.target_reduction_mw,
                "phase": scenario,
            },
            "ward_agents": {
                "total": 25,
                "submitted": submitted,
                "idle": max(0, 25 - submitted),
                "phase": scenario,
            },
            "market_clearing": {
                "status": result.market_result.clearing_result.clearing_status,
                "accepted_bids": accepted,
                "rejected_bids": rejected,
                "accepted_mw": result.market_result.clearing_result.accepted_reduction_mw,
                "unfilled_mw": result.market_result.clearing_result.unfilled_reduction_mw,
                "stress_before": result.market_result.clearing_result.stress_score_before,
                "stress_after": result.market_result.clearing_result.stress_score_after,
                "phase": scenario,
            },
            "dispatch": {
                "flows": accepted,
                "wards_accepted": accepted,
                "wards_rejected": rejected,
                "phase": scenario,
            },
        }
    except Exception:
        pass


def shape_result(result: Any) -> Any:
    if not _enabled():
        return result

    # Do not affect the staged stress simulator.
    try:
        agent_mode = result.snapshot.get("agent_mode")
        if agent_mode == "stress_simulator_live":
            return result
    except Exception:
        pass

    scenario = _scenario_from_clock()

    try:
        _shape_system_prediction(result, scenario)
        profiles = _shape_ward_predictions(result, scenario)
        _shape_agent_decisions(result, profiles)
        _filter_bids(result, profiles, scenario)
        _shape_kepler_nodes(result, profiles)
        _shape_snapshot(result, scenario)
    except Exception:
        # Fail open: do not break the working normal sim if a field changes.
        return result

    return result
