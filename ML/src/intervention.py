FLEX_ASSETS = [
    {
        "asset_id": "BATTERY_POOL_001",
        "asset_type": "Battery / Storage",
        "zone": "Etobicoke",
        "estimated_reduction_mw": 100,
        "activation_minutes": 1,
        "duration_minutes": 60,
        "comfort_impact": "low",
    },
    {
        "asset_id": "EV_POOL_001",
        "asset_type": "EV Charging Delay",
        "zone": "North York",
        "estimated_reduction_mw": 180,
        "activation_minutes": 5,
        "duration_minutes": 90,
        "comfort_impact": "low",
    },
    {
        "asset_id": "HVAC_POOL_001",
        "asset_type": "City / Commercial HVAC",
        "zone": "Downtown",
        "estimated_reduction_mw": 250,
        "activation_minutes": 10,
        "duration_minutes": 120,
        "comfort_impact": "medium",
    },
    {
        "asset_id": "THERMO_POOL_001",
        "asset_type": "Residential Thermostat Cluster",
        "zone": "Scarborough",
        "estimated_reduction_mw": 120,
        "activation_minutes": 10,
        "duration_minutes": 120,
        "comfort_impact": "medium",
    },
]


def plan_intervention(target_reduction_mw: int, stress_score_before: int) -> dict:
    selected_assets = []
    total_reduction = 0

    for asset in FLEX_ASSETS:
        if total_reduction >= target_reduction_mw:
            break

        selected_assets.append(asset)
        total_reduction += asset["estimated_reduction_mw"]

    # Demo calibration: 650 MW reduction should move 94 -> 71
    stress_drop = round((total_reduction / 650) * 23)
    stress_score_after = max(0, stress_score_before - stress_drop)

    return {
        "selected_assets": selected_assets,
        "total_reduction_mw": total_reduction,
        "stress_score_before": stress_score_before,
        "stress_score_after": stress_score_after,
        "dispatch_status": "simulated",
    }