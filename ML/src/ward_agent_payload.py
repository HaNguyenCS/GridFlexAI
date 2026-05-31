"""
Build one prediction/action payload per ward agent.

Purpose:
- The ML model predicts Ontario system stress.
- The ward layer estimates stress for all 25 wards.
- This module converts each ward prediction into a ward-agent instruction.

Each ward agent can then decide/send a bid.
A separate market/allocator agent can compare all ward bids.
"""

from __future__ import annotations

from typing import Any, Dict, List


MARKET_AGENT_NAME = "agent_market_allocator"


def priority_from_score(score: float) -> str:
    if score >= 97:
        return "CRITICAL"
    if score >= 88:
        return "HIGH"
    if score >= 70:
        return "MEDIUM"
    return "LOW"


def stress_state_from_ward(ward: Dict[str, Any]) -> str:
    """
    A ward can either need electricity/reduction support,
    offer flexibility, or stay neutral.

    In this project:
    - High stress means the ward needs load relief.
    - Lower relative stress with available flexibility means the ward can offer flex.
    """

    score = float(ward.get("ward_stress_score", 0) or 0)
    flex_ratio = float(ward.get("flexibility_buffer_ratio", 0) or 0)

    if score >= 88:
        return "NEEDS_ELECTRICITY"

    if score < 88 and flex_ratio >= 1.25:
        return "SUPPORT_AVAILABLE"

    return "NEUTRAL"


def bid_type_from_state(stress_state: str) -> str:
    if stress_state == "NEEDS_ELECTRICITY":
        return "BUY_REDUCTION"

    if stress_state == "SUPPORT_AVAILABLE":
        return "SELL_FLEX"

    return "NO_BID"


def estimate_price_signal(
    ward: Dict[str, Any],
    system_score: float,
    stress_state: str,
) -> float:
    """
    Simple price signal for the demo market.

    Higher stress = higher willingness to pay for reduction.
    More available flexibility = lower offer price for flexible supply.
    """

    ward_score = float(ward.get("ward_stress_score", 0) or 0)
    vulnerability = float(ward.get("local_vulnerability_score", 0) or 0)
    flex_ratio = float(ward.get("flexibility_buffer_ratio", 1) or 1)

    if stress_state == "NEEDS_ELECTRICITY":
        price = 40 + 0.45 * system_score + 0.35 * ward_score + 15 * vulnerability
        return round(min(price, 150), 2)

    if stress_state == "SUPPORT_AVAILABLE":
        price = 35 + 20 * vulnerability - 5 * min(flex_ratio, 3)
        return round(max(price, 10), 2)

    return 0.0


def quantity_from_ward(
    ward: Dict[str, Any],
    stress_state: str,
) -> float:
    target = float(ward.get("target_reduction_mw", 0) or 0)
    available = float(ward.get("available_flex_mw", 0) or 0)
    recommended = float(ward.get("recommended_reduction_mw", 0) or 0)

    if stress_state == "NEEDS_ELECTRICITY":
        return round(max(recommended, 0), 2)

    if stress_state == "SUPPORT_AVAILABLE":
        # Offer a conservative portion of available flex to the market.
        offer = min(available * 0.35, max(target, 1))
        return round(max(offer, 0), 2)

    return 0.0


def build_reason(
    ward: Dict[str, Any],
    stress_state: str,
    priority: str,
) -> str:
    zone_id = ward.get("zone_id")
    score = ward.get("ward_stress_score")
    target = ward.get("target_reduction_mw")
    available = ward.get("available_flex_mw")

    if stress_state == "NEEDS_ELECTRICITY":
        return (
            f"{zone_id} is under {priority} stress with ward stress score {score}. "
            f"Agent should seek approximately {target} MW of load relief."
        )

    if stress_state == "SUPPORT_AVAILABLE":
        return (
            f"{zone_id} has lower relative stress and {available} MW available flex. "
            "Agent may offer flexible load reduction into the ward market."
        )

    return f"{zone_id} does not require active bidding in this interval."


def build_ward_agent_market_payload(
    ward_result: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Converts full ward model output into one payload for each ward agent.

    Input:
    {
      "system_prediction": {...},
      "ward_predictions": [...]
    }

    Output:
    {
      "market_agent": "agent_market_allocator",
      "system_prediction": {...},
      "ward_agent_predictions": [...]
    }
    """

    system_prediction = ward_result.get("system_prediction", {})
    ward_predictions = ward_result.get("ward_predictions", [])

    system_score = float(system_prediction.get("stress_score_before", 0) or 0)
    system_priority = priority_from_score(system_score)

    ward_agent_predictions: List[Dict[str, Any]] = []

    for ward in ward_predictions:
        zone_id = str(ward.get("zone_id"))
        ward_score = float(ward.get("ward_stress_score", 0) or 0)

        stress_state = stress_state_from_ward(ward)
        bid_type = bid_type_from_state(stress_state)
        priority = priority_from_score(ward_score)
        quantity_mw = quantity_from_ward(ward, stress_state)
        price_signal = estimate_price_signal(
            ward=ward,
            system_score=system_score,
            stress_state=stress_state,
        )

        ward_agent_predictions.append(
            {
                "agent": f"agent_{zone_id}",
                "zone_id": zone_id,
                "stress_state": stress_state,
                "bid_type": bid_type,
                "quantity_mw": quantity_mw,
                "price_signal": price_signal,
                "priority": priority,
                "ward_stress_score": round(ward_score),
                "ward_stress_probability": ward.get("ward_stress_probability"),
                "estimated_stress_duration_hours": ward.get(
                    "estimated_stress_duration_hours"
                ),
                "target_reduction_mw": ward.get("target_reduction_mw"),
                "available_flex_mw": ward.get("available_flex_mw"),
                "recommended_reduction_mw": ward.get("recommended_reduction_mw"),
                "local_vulnerability_score": ward.get("local_vulnerability_score"),
                "flexibility_buffer_ratio": ward.get("flexibility_buffer_ratio"),
                "reason": build_reason(
                    ward=ward,
                    stress_state=stress_state,
                    priority=priority,
                ),
            }
        )

    return {
        "market_agent": MARKET_AGENT_NAME,
        "system_prediction": {
            **system_prediction,
            "system_priority": system_priority,
        },
        "ward_agent_predictions": ward_agent_predictions,
        "market_summary": {
            "total_ward_agents": len(ward_agent_predictions),
            "buy_reduction_agents": sum(
                1
                for item in ward_agent_predictions
                if item["bid_type"] == "BUY_REDUCTION"
            ),
            "sell_flex_agents": sum(
                1
                for item in ward_agent_predictions
                if item["bid_type"] == "SELL_FLEX"
            ),
            "no_bid_agents": sum(
                1
                for item in ward_agent_predictions
                if item["bid_type"] == "NO_BID"
            ),
            "total_buy_reduction_mw": round(
                sum(
                    item["quantity_mw"]
                    for item in ward_agent_predictions
                    if item["bid_type"] == "BUY_REDUCTION"
                ),
                2,
            ),
            "total_sell_flex_mw": round(
                sum(
                    item["quantity_mw"]
                    for item in ward_agent_predictions
                    if item["bid_type"] == "SELL_FLEX"
                ),
                2,
            ),
        },
        "honesty_note": (
            "Ward agents receive stress and bid guidance from the ML ward layer. "
            "Bid type, quantity, and price signal are decision-support outputs, "
            "not cleared market prices."
        ),
    }