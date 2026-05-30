from fastapi import FastAPI
from pydantic import BaseModel
from typing import List, Dict, Any

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


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/grid/predict")
def grid_predict(row: GridFeatureRow) -> Dict[str, Any]:
    return predict_grid_stress(row.model_dump())

@app.post("/flex/intervention")
def flex_intervention(request: InterventionRequest) -> Dict[str, Any]:
    return plan_intervention(
        target_reduction_mw=request.target_reduction_mw,
        stress_score_before=request.stress_score_before,
    )
