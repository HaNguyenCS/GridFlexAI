"""
Build agent trigger payload from ward-level stress predictions.

Required backend schema:
{
  "agent": "agent_1_rebalance",
  "failure_detected": boolean,
  "failing_zones": ["zone name strings"],
  "analysis": {},
  "expected_stress_reduction_percent": number,
  "priority": "CRITICAL | HIGH | MEDIUM | LOW"
}
"""

from __future__ import annotations

from typing import Any, Dict, List


AGENT_NAME = "agent_1_rebalance"
MAX_AGENT_ZONES = 5


def priority_from_predictions(
    system_score: float,
    ward_predictions: List[Dict[str, Any]],
) -> str:
    risk_levels = {str(w.get("risk_level", "")).lower() for w in ward_predictions}

    if system_score >= 90 or "critical" in risk_levels:
        return "CRITICAL"

    if system_score >= 75 or "high" in risk_levels:
        return "HIGH"

    if system_score >= 60 or "medium" in risk_levels:
        return "MEDIUM"

    return "LOW"


def build_reason(
    failure_detected: bool,
    priority: str,
    system_score: float,
    failing_zones: List[str],
) -> str:
    if not failure_detected:
        return (
            "No ward crossed the high-risk threshold. "
            "No rebalance agent activation required."
        )

    return (
        f"{priority} rebalance trigger: Ontario system stress score is "
        f"{round(system_score)}, and {len(failing_zones)} highest-priority "
        "ward(s) were selected for the rebalance agent."
    )


def build_agent_rebalance_payload(
    ward_result: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Converts full ward model output into backend agent trigger JSON.

    Input shape expected:
    {
      "system_prediction": {...},
      "ward_predictions": [...]
    }
    """

    system_prediction = ward_result.get("system_prediction", {})
    ward_predictions = ward_result.get("ward_predictions", [])

    system_score = float(system_prediction.get("stress_score_before", 0) or 0)
    system_risk_level = str(system_prediction.get("risk_level", "normal"))

    all_risky_wards = [
        ward
        for ward in ward_predictions
        if str(ward.get("risk_level", "")).lower() in {"critical", "high"}
    ]

    # Keep the agent trigger focused.
    # The full ward endpoint can show all wards, but the rebalance agent should
    # start with the highest-priority zones only.
    risky_wards = sorted(
        all_risky_wards,
        key=lambda ward: (
            float(ward.get("ward_stress_score", 0) or 0),
            float(ward.get("target_reduction_mw", 0) or 0),
        ),
        reverse=True,
    )[:MAX_AGENT_ZONES]

    failing_zones = [str(ward["zone_id"]) for ward in risky_wards]
    failure_detected = len(failing_zones) > 0

    total_target_reduction = float(system_prediction.get("target_reduction_mw", 0) or 0)

    total_recommended_reduction = sum(
        float(ward.get("recommended_reduction_mw", 0) or 0)
        for ward in risky_wards
    )

    if total_target_reduction > 0:
        expected_stress_reduction_percent = (
            total_recommended_reduction / total_target_reduction
        ) * 100
    else:
        expected_stress_reduction_percent = 0.0

    expected_stress_reduction_percent = round(
        min(expected_stress_reduction_percent, 100.0),
        2,
    )

    priority = priority_from_predictions(
        system_score=system_score,
        ward_predictions=ward_predictions,
    )

    top_zone = None
    if ward_predictions:
        top_zone = max(
            ward_predictions,
            key=lambda item: float(item.get("ward_stress_score", 0) or 0),
        ).get("zone_id")

    analysis = {
        "system_stress_score": round(system_score),
        "system_risk_level": system_risk_level,
        "top_zone": top_zone,
        "zone_count_at_risk": len(failing_zones),
        "total_zones_at_risk": len(all_risky_wards),
        "total_target_reduction_mw": round(total_target_reduction),
        "total_recommended_reduction_mw": round(total_recommended_reduction),
        "reason": build_reason(
            failure_detected=failure_detected,
            priority=priority,
            system_score=system_score,
            failing_zones=failing_zones,
        ),
        "zone_details": [
            {
                "zone_id": ward.get("zone_id"),
                "ward_stress_score": ward.get("ward_stress_score"),
                "risk_level": ward.get("risk_level"),
                "estimated_stress_duration_hours": ward.get(
                    "estimated_stress_duration_hours"
                ),
                "target_reduction_mw": ward.get("target_reduction_mw"),
                "available_flex_mw": ward.get("available_flex_mw"),
                "recommended_reduction_mw": ward.get("recommended_reduction_mw"),
            }
            for ward in risky_wards
        ],
    }

    return {
        "agent": AGENT_NAME,
        "failure_detected": failure_detected,
        "failing_zones": failing_zones,
        "analysis": analysis,
        "expected_stress_reduction_percent": expected_stress_reduction_percent,
        "priority": priority,
    }