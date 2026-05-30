from pathlib import Path
from typing import Any, Dict
import json

from fastapi import FastAPI
from pydantic import BaseModel

from src.predict import predict_grid_stress
from src.intervention import plan_intervention


app = FastAPI(title="GridFlex ML API")


class GridFeatureRow(BaseModel):
    ontario_demand_mw: float
    market_demand_mw: float
    scheduled_operating_reserve_mw: float
    forecast_market_demand_next_1h_mw: float
    forecast_market_demand_next_3h_mw: float
    total_generation_output_mw: float
    total_generation_capability_mw: float
    temperature_c: float
    humidity: float
    hour: int
    day_of_week: int
    month: int
    is_weekend: int
    is_peak_window: int
    demand_lag_1h_mw: float
    demand_lag_24h_mw: float
    demand_lag_168h_mw: float
    demand_ramp_1h_mw: float
    demand_ramp_3h_mw: float
    rolling_demand_mean_3h: float
    rolling_demand_max_24h: float
    reserve_margin_ratio: float


class InterventionRequest(BaseModel):
    target_reduction_mw: int
    stress_score_before: int


@app.get("/")
def root() -> Dict[str, Any]:
    return {
        "status": "GridFlex ML API running",
        "docs": "/docs",
        "endpoints": {
            "health": "GET /health",
            "live_mock": "GET /grid/live-mock",
            "live": "GET /grid/live",
            "predict": "POST /grid/predict",
            "intervention": "POST /flex/intervention",
        },
    }


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.get("/grid/live-mock")
def grid_live_mock() -> Dict[str, Any]:
    path = Path("data/mock/mock_live_grid.json")

    if not path.exists():
        return {
            "error": "Missing mock live grid file",
            "expected_path": str(path),
        }

    with path.open("r") as file:
        return json.load(file)


@app.get("/grid/live")
def grid_live() -> Dict[str, Any]:
    """
    Returns the latest model-ready live feature row.

    Current behavior:
    - Reads data/processed/live_feature_row.json if available.
    - If missing, builds it from latest processed IESO + fallback files.

    Refresh flow before calling this endpoint:
    python src/ingestion/fetch_realtime_totals.py
    python src/ingestion/fetch_predisp_totals.py
    python src/features/build_live_feature_row.py
    """
    path = Path("data/processed/live_feature_row.json")

    if not path.exists():
        from src.features.build_live_feature_row import build_live_feature_row

        return build_live_feature_row()

    with path.open("r") as file:
        return json.load(file)


@app.post("/grid/predict")
def grid_predict(row: GridFeatureRow) -> Dict[str, Any]:
    """
    Predicts grid stress from a normalized grid/weather feature row.
    """
    return predict_grid_stress(row.model_dump())


@app.post("/flex/intervention")
def flex_intervention(request: InterventionRequest) -> Dict[str, Any]:
    """
    Simulates a demand-response intervention and returns selected assets
    plus the post-intervention stress score.
    """
    return plan_intervention(
        target_reduction_mw=request.target_reduction_mw,
        stress_score_before=request.stress_score_before,
    )

@app.get("/demo/run")
def demo_run() -> Dict[str, Any]:
    live_row = grid_live()

    # Remove non-model fields before prediction
    model_row = {
        key: value
        for key, value in live_row.items()
        if key not in ["timestamp", "_metadata"]
    }

    prediction = predict_grid_stress(model_row)

    intervention = plan_intervention(
        target_reduction_mw=prediction["target_reduction_mw"],
        stress_score_before=prediction["stress_score_before"],
    )

    return {
        "live_row": live_row,
        "prediction": prediction,
        "intervention": intervention,
    }

@app.get("/demo/stress")
def demo_stress() -> Dict[str, Any]:
    path = Path("data/mock/mock_live_grid.json")

    with path.open("r") as file:
        live_row = json.load(file)

    model_row = {
        key: value
        for key, value in live_row.items()
        if key not in ["timestamp", "_metadata"]
    }

    prediction = predict_grid_stress(model_row)

    intervention = plan_intervention(
        target_reduction_mw=prediction["target_reduction_mw"],
        stress_score_before=prediction["stress_score_before"],
    )

    return {
        "mode": "calibrated_stress_demo",
        "live_row": live_row,
        "prediction": prediction,
        "intervention": intervention,
    }