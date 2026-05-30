from predict import predict_grid_stress
from intervention import plan_intervention

demo_payload = {
    "ontario_demand_mw": 23800,
    "market_demand_mw": 25100,
    "scheduled_operating_reserve_mw": 980,
    "forecast_market_demand_next_1h_mw": 25700,
    "forecast_market_demand_next_3h_mw": 26200,
    "total_generation_output_mw": 24400,
    "total_generation_capability_mw": 28700,
    "temperature_c": 31.2,
    "humidity": 68,
    "hour": 17,
    "day_of_week": 2,
    "month": 7,
    "is_weekend": 0,
    "is_peak_window": 1,
    "demand_lag_1h_mw": 22400,
    "demand_lag_24h_mw": 21900,
    "demand_lag_168h_mw": 21000,
    "demand_ramp_1h_mw": 1400,
    "demand_ramp_3h_mw": 2500,
    "rolling_demand_mean_3h": 22900,
    "rolling_demand_max_24h": 23800,
    "reserve_margin_ratio": 0.041,
}

prediction = predict_grid_stress(demo_payload)
intervention = plan_intervention(
    prediction["target_reduction_mw"],
    prediction["stress_score_before"]
)

print("Prediction:")
print(prediction)
print("\nIntervention:")
print(intervention)