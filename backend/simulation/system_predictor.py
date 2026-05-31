"""System-level grid stress scoring (fallback rules; optional XGBoost if artifacts exist)."""

from __future__ import annotations

import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
ML_ARTIFACTS = REPO_ROOT / "ML" / "artifacts"


def risk_level(prob: float) -> str:
    if prob >= 0.80:
        return "critical"
    if prob >= 0.60:
        return "high"
    if prob >= 0.35:
        return "medium"
    return "normal"


def estimate_target_reduction_mw(stress_score: int) -> int:
    if stress_score >= 90:
        return 650
    if stress_score >= 80:
        return 400
    if stress_score >= 70:
        return 200
    return 0


def fallback_stress_score(row: dict) -> int:
    score = 0
    if row.get("reserve_margin_ratio", 1) < 0.05:
        score += 35
    if row.get("demand_ramp_1h_mw", 0) > 1000:
        score += 25
    if row.get("temperature_c", 0) > 30:
        score += 20
    if row.get("forecast_market_demand_next_3h_mw", 0) > row.get(
        "market_demand_mw", 0
    ) * 1.03:
        score += 20
    if row.get("ontario_demand_mw", 0) > 20000:
        score += 15
    return min(score, 100)


def explain_drivers(row: dict) -> list[str]:
    drivers: list[str] = []
    if row.get("reserve_margin_ratio", 1) < 0.05:
        drivers.append("Low scheduled operating reserve")
    if row.get("demand_ramp_1h_mw", 0) > 1000:
        drivers.append("Rapid 1-hour demand ramp")
    if row.get("temperature_c", 0) > 30:
        drivers.append("High temperature / cooling load")
    if row.get("forecast_market_demand_next_3h_mw", 0) > row.get(
        "market_demand_mw", 0
    ):
        drivers.append("High forecast market demand")
    if row.get("ontario_demand_mw", 0) > 20000:
        drivers.append("Elevated Ontario demand")
    return drivers or ["No single dominant driver"]


def predict_grid_stress(feature_row: dict) -> dict:
    stress_score = fallback_stress_score(feature_row)
    prob = stress_score / 100.0

    model_path = ML_ARTIFACTS / "grid_stress_xgb.json"
    columns_path = ML_ARTIFACTS / "feature_columns.json"
    if model_path.exists() and columns_path.exists():
        try:
            import pandas as pd
            import xgboost as xgb

            with columns_path.open(encoding="utf-8") as handle:
                feature_columns = json.load(handle)
            model_input = {col: feature_row.get(col, 0) for col in feature_columns}
            df = pd.DataFrame([model_input])
            dmatrix = xgb.DMatrix(df[feature_columns])
            model = xgb.Booster()
            model.load_model(str(model_path))
            prob = float(model.predict(dmatrix)[0])
            stress_score = int(max(0, min(94, round(prob * 100))))
        except Exception:
            pass

    hour = int(feature_row.get("hour", 12))
    peak_end = min(23, hour + 3)
    return {
        "stress_probability": round(prob, 3),
        "risk_level": risk_level(prob),
        "stress_score_before": stress_score,
        "predicted_peak_window": f"{hour:02d}:00-{peak_end:02d}:00",
        "target_reduction_mw": estimate_target_reduction_mw(stress_score),
        "drivers": explain_drivers(feature_row),
    }
