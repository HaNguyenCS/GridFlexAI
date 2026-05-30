import cudf


def prepare_features_rapids(input_csv: str, output_parquet: str):
    gdf = cudf.read_csv(input_csv)

    gdf["timestamp"] = cudf.to_datetime(gdf["timestamp"])
    gdf = gdf.sort_values("timestamp")

    gdf["hour"] = gdf["timestamp"].dt.hour
    gdf["day_of_week"] = gdf["timestamp"].dt.weekday
    gdf["month"] = gdf["timestamp"].dt.month
    gdf["is_weekend"] = (gdf["day_of_week"] >= 5).astype("int8")
    gdf["is_peak_window"] = ((gdf["hour"] >= 16) & (gdf["hour"] <= 21)).astype("int8")

    gdf["demand_lag_1h_mw"] = gdf["ontario_demand_mw"].shift(1)
    gdf["demand_lag_24h_mw"] = gdf["ontario_demand_mw"].shift(24)
    gdf["demand_lag_168h_mw"] = gdf["ontario_demand_mw"].shift(168)

    gdf["demand_ramp_1h_mw"] = gdf["ontario_demand_mw"] - gdf["demand_lag_1h_mw"]
    gdf["demand_ramp_3h_mw"] = gdf["ontario_demand_mw"] - gdf["ontario_demand_mw"].shift(3)

    gdf["rolling_demand_mean_3h"] = gdf["ontario_demand_mw"].rolling(3).mean()
    gdf["rolling_demand_max_24h"] = gdf["ontario_demand_mw"].rolling(24).max()

    gdf["reserve_margin_ratio"] = (
        gdf["scheduled_operating_reserve_mw"] / gdf["ontario_demand_mw"]
    )

    # Percentile-ish ranks
    gdf["ontario_demand_pct"] = gdf["ontario_demand_mw"].rank(method="average") / len(gdf) * 100
    gdf["market_demand_pct"] = gdf["market_demand_mw"].rank(method="average") / len(gdf) * 100
    gdf["reserve_pct"] = gdf["scheduled_operating_reserve_mw"].rank(method="average") / len(gdf) * 100
    gdf["ramp_pct"] = gdf["demand_ramp_1h_mw"].fillna(0).rank(method="average") / len(gdf) * 100

    gdf["low_reserve_pressure"] = 100 - gdf["reserve_pct"]

    gdf["stress_score"] = (
        0.35 * gdf["ontario_demand_pct"]
        + 0.25 * gdf["market_demand_pct"]
        + 0.25 * gdf["low_reserve_pressure"]
        + 0.15 * gdf["ramp_pct"]
    )

    gdf["future_stress_1h"] = gdf["stress_score"].shift(-1)
    gdf["future_stress_2h"] = gdf["stress_score"].shift(-2)
    gdf["future_stress_3h"] = gdf["stress_score"].shift(-3)

    gdf["future_stress_max_3h"] = gdf[
        ["future_stress_1h", "future_stress_2h", "future_stress_3h"]
    ].max(axis=1)

    gdf["stress_event_next_3h"] = (gdf["future_stress_max_3h"] >= 80).astype("int8")

    gdf = gdf.dropna()
    gdf.to_parquet(output_parquet)

    print(f"Saved {output_parquet}")


if __name__ == "__main__":
    prepare_features_rapids(
        "data/raw/synthetic_grid.csv",
        "data/processed/training_features_rapids.parquet"
    )