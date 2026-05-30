import json
import xgboost as xgb
import pandas as pd


with open("artifacts/feature_columns.json") as f:
    FEATURE_COLUMNS = json.load(f)


model = xgb.Booster()
model.load_model("artifacts/grid_stress_xgb.json")


def risk_level(prob: float) -> str:
    if prob >= 0.80:
        return "critical"
    if prob >= 0.60:
        return "high"
    if prob >= 0.35:
        return "elevated"
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

    if row.get("forecast_market_demand_next_3h_mw", 0) > row.get("market_demand_mw", 0) * 1.03:
        score += 20

    return min(score, 100)


def explain_drivers(row: dict) -> list[str]:
    drivers = []

    if row.get("reserve_margin_ratio", 1) < 0.05:
        drivers.append("Low scheduled operating reserve")

    if row.get("demand_ramp_1h_mw", 0) > 1000:
        drivers.append("Rapid 1-hour demand ramp")

    if row.get("temperature_c", 0) > 30:
        drivers.append("High temperature / cooling load")

    if row.get("forecast_market_demand_next_3h_mw", 0) > row.get("market_demand_mw", 0):
        drivers.append("Forecast market demand rising")

    return drivers or ["No single dominant driver"]


def predict_grid_stress(feature_row: dict) -> dict:
    try:
        model_input = {col: feature_row.get(col, 0) for col in FEATURE_COLUMNS}
        df = pd.DataFrame([model_input])
        dmatrix = xgb.DMatrix(df[FEATURE_COLUMNS])

        prob = float(model.predict(dmatrix)[0])

        # For demo, convert probability to meter-style stress score
        stress_score = int(max(0, min(94, round(prob * 100))))

    except Exception:
        stress_score = fallback_stress_score(feature_row)
        prob = stress_score / 100

    return {
        "stress_probability": round(prob, 3),
        "risk_level": risk_level(prob),
        "stress_score_before": stress_score,
        "predicted_peak_window": "17:00-20:00",
        "target_reduction_mw": estimate_target_reduction_mw(stress_score),
        "drivers": explain_drivers(feature_row),
    }