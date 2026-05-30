"""
Ward-level Toronto stress inference.

Core idea:
- Ontario/IESO data tells us when the system is stressed.
- Ward-level features tell us how that stress is distributed across Toronto.

We only use three ward features:
1. ward_load_share
2. available_flex_mw
3. local_vulnerability_score

This module does NOT claim true outage/failure prediction.
It estimates ward-level stress duration and target MW reduction.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List

import pandas as pd


WARD_FEATURES_CSV = Path("data/processed/ward_features.csv")


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def risk_level_from_score(score: float) -> str:
    if score >= 97:
        return "critical"
    if score >= 88:
        return "high"
    if score >= 70:
        return "medium"
    if score >= 50:
        return "elevated"
    return "normal"

def load_ward_features() -> pd.DataFrame:
    if not WARD_FEATURES_CSV.exists():
        raise RuntimeError(
            "Missing data/processed/ward_features.csv. "
            "Create it before running ward-level inference."
        )

    df = pd.read_csv(WARD_FEATURES_CSV)

    required = {
        "zone_id",
        "ward_load_share",
        "available_flex_mw",
        "local_vulnerability_score",
    }

    missing = required - set(df.columns)
    if missing:
        raise RuntimeError(f"ward_features.csv missing columns: {sorted(missing)}")

    df["ward_load_share"] = pd.to_numeric(df["ward_load_share"], errors="coerce")
    df["available_flex_mw"] = pd.to_numeric(df["available_flex_mw"], errors="coerce")
    df["local_vulnerability_score"] = pd.to_numeric(
        df["local_vulnerability_score"],
        errors="coerce",
    )

    df = df.dropna(subset=list(required))

    total_share = df["ward_load_share"].sum()
    if total_share <= 0:
        raise RuntimeError("ward_load_share values must sum to more than 0.")

    # Normalize so ward allocation is stable even if the CSV does not sum exactly to 1.
    df["ward_load_share"] = df["ward_load_share"] / total_share

    return df


def estimate_system_duration_hours(system_prediction: Dict[str, Any]) -> float:
    """
    If the model already gives duration, use it.
    Otherwise derive a simple duration from stress score.
    """

    if "estimated_system_stress_duration_hours" in system_prediction:
        return float(system_prediction["estimated_system_stress_duration_hours"])

    score = float(system_prediction.get("stress_score_before", 0))

    if score >= 90:
        return 3.0
    if score >= 75:
        return 2.0
    if score >= 60:
        return 1.25
    if score >= 40:
        return 0.75
    return 0.25


def build_simple_drivers(
    system_prediction: Dict[str, Any],
    vulnerability: float,
    flex_ratio: float,
) -> List[str]:
    drivers: List[str] = []

    system_drivers = system_prediction.get("drivers", [])
    if system_drivers:
        drivers.append("System stress: " + str(system_drivers[0]))

    if vulnerability >= 0.80:
        drivers.append("High local vulnerability")
    elif vulnerability >= 0.65:
        drivers.append("Moderate local vulnerability")
    else:
        drivers.append("Lower local vulnerability")

    if flex_ratio >= 1.25:
        drivers.append("Strong flexibility buffer")
    elif flex_ratio >= 1.0:
        drivers.append("Adequate flexibility buffer")
    else:
        drivers.append("Limited flexibility buffer")

    return drivers


def predict_ward_stress(
    system_prediction: Dict[str, Any],
    live_row: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    """
    Convert system-wide Ontario stress into ward-level Toronto stress.

    Input:
    - system_prediction from predict_grid_stress()
    - optional live_row/current row with ontario_demand_mw

    Output:
    - JSON-ready dictionary with one prediction per ward
    """

    ward_df = load_ward_features()

    system_score = float(system_prediction.get("stress_score_before", 0))
    system_probability = float(system_prediction.get("stress_probability", 0))
    system_target_mw = float(system_prediction.get("target_reduction_mw", 0))
    system_duration = estimate_system_duration_hours(system_prediction)

    ontario_demand_mw = 0.0
    if live_row:
        ontario_demand_mw = float(live_row.get("ontario_demand_mw", 0) or 0)

    # This is only for explanation/context.
    # It is not a measured Toronto load value.
    toronto_load_share_assumption = 0.22
    toronto_exposure_mw = ontario_demand_mw * toronto_load_share_assumption

    # Allocation weight:
    # A ward receives more MW target if it has higher load share and higher vulnerability.
    ward_df["allocation_weight"] = (
        ward_df["ward_load_share"] * (0.50 + ward_df["local_vulnerability_score"])
    )

    total_weight = ward_df["allocation_weight"].sum()
    if total_weight <= 0:
        total_weight = 1.0

    ward_df["target_reduction_mw"] = (
        system_target_mw * ward_df["allocation_weight"] / total_weight
    )

    predictions: List[Dict[str, Any]] = []

    for _, row in ward_df.iterrows():
        zone_id = str(row["zone_id"])
        ward_load_share = float(row["ward_load_share"])
        available_flex_mw = float(row["available_flex_mw"])
        vulnerability = float(row["local_vulnerability_score"])
        target_mw = float(row["target_reduction_mw"])

        # Stress adjustment:
        # Ontario stress is system-wide, but ward stress should still be differentiated.
        # Vulnerability above 0.70 increases local stress.
        # Vulnerability below 0.70 reduces local stress.
        vulnerability_adjustment = (vulnerability - 0.70) * 35

        ward_stress_score = clamp(
            system_score + vulnerability_adjustment,
            0,
            100,
        )

        vulnerability_multiplier = ward_stress_score / max(system_score, 1)

        ward_probability = clamp(
            system_probability * vulnerability_multiplier,
            0,
            0.99,
        )

        # Flexibility buffer:
        # If available flex comfortably covers target, estimated duration falls.
        # If available flex is insufficient, duration rises.
        flex_ratio = available_flex_mw / max(target_mw, 1)

        if flex_ratio >= 1.25:
            flex_duration_factor = 0.80
        elif flex_ratio >= 1.0:
            flex_duration_factor = 0.95
        elif flex_ratio >= 0.75:
            flex_duration_factor = 1.10
        else:
            flex_duration_factor = 1.30

        duration_hours = clamp(
            system_duration * vulnerability_multiplier * flex_duration_factor,
            0.25,
            6.0,
        )

        recommended_reduction_mw = min(target_mw, available_flex_mw)

        ward_exposure_mw = toronto_exposure_mw * ward_load_share

        predictions.append(
            {
                "zone_id": zone_id,
                "ward_load_share": round(ward_load_share, 4),
                "ward_exposure_mw": round(ward_exposure_mw, 2),
                "local_vulnerability_score": round(vulnerability, 3),
                "system_stress_score": round(system_score),
                "ward_stress_score": round(ward_stress_score),
                "ward_stress_probability": round(ward_probability, 3),
                "risk_level": risk_level_from_score(ward_stress_score),
                "estimated_stress_duration_hours": round(duration_hours, 2),
                "target_reduction_mw": round(target_mw),
                "available_flex_mw": round(available_flex_mw),
                "recommended_reduction_mw": round(recommended_reduction_mw),
                "flexibility_buffer_ratio": round(flex_ratio, 2),
                "drivers": build_simple_drivers(
                    system_prediction=system_prediction,
                    vulnerability=vulnerability,
                    flex_ratio=flex_ratio,
                ),
            }
        )

    predictions.sort(
        key=lambda item: (
            item["ward_stress_score"],
            item["target_reduction_mw"],
        ),
        reverse=True,
    )

    return {
        "system_prediction": {
            **system_prediction,
            "estimated_system_stress_duration_hours": round(system_duration, 2),
        },
        "ward_model": {
            "method": (
                "Ontario system stress distributed across Toronto wards using "
                "ward_load_share, available_flex_mw, and local_vulnerability_score."
            ),
            "features_used": [
                "ward_load_share",
                "available_flex_mw",
                "local_vulnerability_score",
            ],
            "toronto_load_share_assumption": toronto_load_share_assumption,
            "toronto_exposure_mw": round(toronto_exposure_mw, 2),
            "honesty_note": (
                "Ward-level outputs estimate stress and intervention priority. "
                "They are not trained on true ward-level outage labels."
            ),
        },
        "ward_predictions": predictions,
    }


if __name__ == "__main__":
    demo_prediction = {
        "stress_probability": 0.981,
        "risk_level": "critical",
        "stress_score_before": 94,
        "predicted_peak_window": "17:00-20:00",
        "target_reduction_mw": 650,
        "drivers": [
            "Low reserve margin",
            "Rapid 1-hour demand ramp",
            "Forecast demand rising",
            "High cooling load",
        ],
    }

    demo_live_row = {
        "ontario_demand_mw": 23800,
    }

    output = predict_ward_stress(
        system_prediction=demo_prediction,
        live_row=demo_live_row,
    )

    print(json.dumps(output, indent=2))
