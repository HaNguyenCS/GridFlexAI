import numpy as np
import pandas as pd


def make_synthetic_grid_data(n_hours: int = 24 * 365 * 3) -> pd.DataFrame:
    np.random.seed(42)

    timestamps = pd.date_range("2023-01-01", periods=n_hours, freq="h")

    hour = timestamps.hour
    day_of_week = timestamps.dayofweek
    month = timestamps.month

    # Normal daily load pattern
    daily_pattern = 2200 * np.sin((hour - 8) / 24 * 2 * np.pi)

    # Seasonal pattern
    summer_effect = np.maximum(0, np.sin((month - 4) / 12 * 2 * np.pi)) * 2500
    winter_effect = np.maximum(0, -np.sin((month - 4) / 12 * 2 * np.pi)) * 1200

    # Weekend effect
    weekend_effect = np.where(day_of_week >= 5, -900, 0)

    # Weather
    temperature = (
        10
        + 14 * np.sin((month - 4) / 12 * 2 * np.pi)
        + np.random.normal(0, 4, n_hours)
    )

    humidity = np.random.uniform(35, 85, n_hours)

    # Cooling load when hot
    cooling_load = np.maximum(temperature - 24, 0) * 450

    noise = np.random.normal(0, 450, n_hours)

    ontario_demand = (
        17000
        + daily_pattern
        + summer_effect
        + winter_effect
        + weekend_effect
        + cooling_load
        + noise
    )

    ontario_demand = np.clip(ontario_demand, 10000, 30000)

    market_demand = ontario_demand + np.random.normal(900, 300, n_hours)

    # Reserve falls when demand is very high
    demand_pressure = np.maximum(
        ontario_demand - np.percentile(ontario_demand, 75), 0
    )

    scheduled_reserve = (
        2600
        - demand_pressure * 0.10
        + np.random.normal(0, 220, n_hours)
    )

    scheduled_reserve = np.clip(scheduled_reserve, 300, 4000)

    total_generation_output = ontario_demand + np.random.normal(500, 200, n_hours)
    total_generation_capability = ontario_demand + scheduled_reserve + np.random.normal(1800, 500, n_hours)

    df = pd.DataFrame({
        "timestamp": timestamps,
        "ontario_demand_mw": ontario_demand,
        "market_demand_mw": market_demand,
        "scheduled_operating_reserve_mw": scheduled_reserve,
        "total_generation_output_mw": total_generation_output,
        "total_generation_capability_mw": total_generation_capability,
        "temperature_c": temperature,
        "humidity": humidity,
    })

    # Pretend predispatch forecast is noisy future demand
    df["forecast_market_demand_next_1h_mw"] = df["market_demand_mw"].shift(-1) + np.random.normal(0, 250, n_hours)
    df["forecast_market_demand_next_3h_mw"] = df["market_demand_mw"].shift(-3) + np.random.normal(0, 400, n_hours)

    return df


if __name__ == "__main__":
    df = make_synthetic_grid_data()
    df.to_csv("data/raw/synthetic_grid.csv", index=False)
    print(df.head())
    print("Saved data/raw/synthetic_grid.csv")