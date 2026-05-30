from pathlib import Path
from typing import Any, Dict
import json

from fastapi import FastAPI
from pydantic import BaseModel

from src.predict import predict_grid_stress
from src.intervention import plan_intervention
from src.ward_risk import predict_ward_stress
from src.agent_payload import build_agent_rebalance_payload


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
            "data_status": "GET /data/status",
            "live_mock": "GET /grid/live-mock",
            "live": "GET /grid/live",
            "predict": "POST /grid/predict",
            "intervention": "POST /flex/intervention",
            "demo_run": "GET /demo/run",
            "demo_stress": "GET /demo/stress",
            "demo_wards": "GET /demo/wards",
            "agent_rebalance": "GET /agent/rebalance",
        },
    }


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.get("/data/status")
def data_status() -> Dict[str, Any]:
    live_path = Path("data/processed/live_feature_row.json")
    realtime_path = Path("data/processed/latest_realtime_totals.json")
    predisp_path = Path("data/processed/latest_predisp_totals.json")
    weather_path = Path("data/processed/latest_weather.json")
    demand_history_path = Path("data/processed/demand_history.csv")
    historical_demand_path = Path("data/processed/historical_demand.csv")
    flex_assets_path = Path("data/processed/flex_assets.json")
    ward_features_path = Path("data/processed/ward_features.csv")
    model_path = Path("artifacts/grid_stress_xgb.json")
    feature_columns_path = Path("artifacts/feature_columns.json")
    training_status_path = Path("artifacts/model_training_status.json")

    live_row: Dict[str, Any] = {}
    if live_path.exists():
        with live_path.open("r") as file:
            live_row = json.load(file)

    metadata = live_row.get("_metadata", {})

    model_training = "historical_ieso_demand_with_engineered_stress_labels"
    if training_status_path.exists():
        try:
            with training_status_path.open("r") as file:
                training_status = json.load(file)
            model_training = training_status.get("model_training", model_training)
        except Exception:
            pass

    return {
        "files": {
            "live_feature_row": live_path.exists(),
            "latest_realtime_totals": realtime_path.exists(),
            "latest_predisp_totals": predisp_path.exists(),
            "latest_weather": weather_path.exists(),
            "demand_history": demand_history_path.exists(),
            "historical_demand": historical_demand_path.exists(),
            "flex_assets": flex_assets_path.exists(),
            "ward_features": ward_features_path.exists(),
            "model_artifact": model_path.exists(),
            "feature_columns": feature_columns_path.exists(),
            "model_training_status": training_status_path.exists(),
        },
        "data_sources": {
            "ieso_realtime": metadata.get("realtime_source", "unknown"),
            "ieso_predispatch": metadata.get("predisp_source", "unknown"),
            "weather": metadata.get("weather_source", "unknown"),
            "reserve": metadata.get("reserve_source", "unknown"),
            "generation": metadata.get("generation_source", "unknown"),
            "lags": metadata.get("lag_source", "unknown"),
            "model_training": model_training,
            "ward_layer": (
                "ward_load_share_available_flex_local_vulnerability"
                if ward_features_path.exists()
                else "missing_ward_features"
            ),
        },
        "honesty_note": (
            "The system stress model is trained on historical IESO demand with engineered "
            "grid-stress labels. Ward-level outputs are estimated by distributing Ontario "
            "system stress across Toronto wards using ward_load_share, available_flex_mw, "
            "and local_vulnerability_score. They are not trained on true ward-level outage labels."
        ),
    }


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
    path = Path("data/processed/live_feature_row.json")

    if not path.exists():
        from src.features.build_live_feature_row import build_live_feature_row

        return build_live_feature_row()

    with path.open("r") as file:
        return json.load(file)


@app.post("/grid/predict")
def grid_predict(row: GridFeatureRow) -> Dict[str, Any]:
    return predict_grid_stress(row.model_dump())


@app.post("/flex/intervention")
def flex_intervention(request: InterventionRequest) -> Dict[str, Any]:
    return plan_intervention(
        target_reduction_mw=request.target_reduction_mw,
        stress_score_before=request.stress_score_before,
    )


def strip_non_model_fields(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        key: value
        for key, value in row.items()
        if key not in ["timestamp", "_metadata"]
    }


@app.get("/demo/run")
def demo_run() -> Dict[str, Any]:
    live_row = grid_live()

    model_row = strip_non_model_fields(live_row)
    prediction = predict_grid_stress(model_row)

    intervention = plan_intervention(
        target_reduction_mw=prediction["target_reduction_mw"],
        stress_score_before=prediction["stress_score_before"],
    )

    return {
        "mode": "live_current_grid",
        "live_row": live_row,
        "prediction": prediction,
        "intervention": intervention,
    }


@app.get("/demo/stress")
def demo_stress() -> Dict[str, Any]:
    path = Path("data/mock/mock_live_grid.json")

    if not path.exists():
        return {
            "error": "Missing mock live grid file",
            "expected_path": str(path),
        }

    with path.open("r") as file:
        live_row = json.load(file)

    model_row = strip_non_model_fields(live_row)
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


@app.get("/demo/wards")
def demo_wards() -> Dict[str, Any]:
    path = Path("data/mock/mock_live_grid.json")

    if not path.exists():
        return {
            "error": "Missing mock live grid file",
            "expected_path": str(path),
        }

    with path.open("r") as file:
        stress_row = json.load(file)

    model_row = strip_non_model_fields(stress_row)

    prediction = predict_grid_stress(model_row)
    prediction["estimated_system_stress_duration_hours"] = 3.0

    return predict_ward_stress(
        system_prediction=prediction,
        live_row=stress_row,
    )


@app.get("/agent/rebalance")
def agent_rebalance() -> Dict[str, Any]:
    path = Path("data/mock/mock_live_grid.json")

    if not path.exists():
        return {
            "error": "Missing mock live grid file",
            "expected_path": str(path),
        }

    with path.open("r") as file:
        stress_row = json.load(file)

    model_row = strip_non_model_fields(stress_row)

    prediction = predict_grid_stress(model_row)
    prediction["estimated_system_stress_duration_hours"] = 3.0

    ward_result = predict_ward_stress(
        system_prediction=prediction,
        live_row=stress_row,
    )

    return build_agent_rebalance_payload(ward_result)