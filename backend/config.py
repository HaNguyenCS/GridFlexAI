from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]

# WebSocket stream cadence (seconds). Lower = snappier dashboard updates.
STREAM_INTERVAL_SEC = 2

# Simulated grid clock: each tick advances this many minutes of "grid time".
# At 2s/tick and 4 min/tick → 120× time compression (6 sim hours per 3 real minutes).
SIM_MINUTES_PER_TICK = 4

# Ward zone registry and map geometry.
WARD_REGISTRY_JSON = REPO_ROOT / "ML" / "data" / "processed" / "ward_zone_registry.json"
WARDS_GEOJSON = REPO_ROOT / "ML" / "data" / "processed" / "toronto_wards_zones.geojson"

# IESO historical demand replay (live stream foundation).
HISTORICAL_DEMAND_CSV = REPO_ROOT / "ML" / "data" / "processed" / "historical_demand.csv"
WARD_LABELED_TRAINING_CSV = REPO_ROOT / "ML" / "data" / "processed" / "ward_labeled_training.csv"
HISTORICAL_SPIKE_THRESHOLD = 1.035
ROLLING_BASELINE_HOURS = 168
TORONTO_BASE_DEMAND_MW = 5_200.0
HISTORICAL_PLAYBACK_START_INDEX = 16  # 2024-01-01 16:00 — known spike hour in spike_training.csv

# Supply solver budget ($) applied each tick of the simulation.
SUPPLY_BUDGET = 4_500_000.0

# Price per MW when one ward imports capacity from another.
CAPACITY_TRANSFER_PRICE_PER_MW = 120.0

# Over-capacity escalation thresholds (seconds of continuous demand > capacity).
OVER_CAPACITY_WARNING_SEC = 30
OVER_CAPACITY_ISSUE_SEC = 60
