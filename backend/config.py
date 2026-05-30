from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]

# WebSocket stream cadence (seconds).
STREAM_INTERVAL_SEC = 5

# Ward zone registry and map geometry.
WARD_REGISTRY_JSON = REPO_ROOT / "ML" / "data" / "processed" / "ward_zone_registry.json"
WARDS_GEOJSON = REPO_ROOT / "ML" / "data" / "processed" / "toronto_wards_zones.geojson"

# Supply solver budget ($) applied each tick of the simulation.
SUPPLY_BUDGET = 4_500_000.0

# Price per MW when one ward imports capacity from another.
CAPACITY_TRANSFER_PRICE_PER_MW = 120.0

# Over-capacity escalation thresholds (seconds of continuous demand > capacity).
OVER_CAPACITY_WARNING_SEC = 30
OVER_CAPACITY_ISSUE_SEC = 60

# Demand spike simulation (random load events on top of the baseline walk).
SPIKE_START_PROB = 0.18          # chance per tick to start a local ward spike
SPIKE_CITY_START_PROB = 0.05     # chance per tick for a city-wide heat-wave spike
SPIKE_ZONE_COUNT = (1, 2)        # how many wards hit per local event
SPIKE_MULTIPLIER = (1.15, 1.45)  # local demand multiplier range
SPIKE_CITY_MULTIPLIER = (1.08, 1.20)
SPIKE_DURATION_TICKS = (4, 10)   # spike lasts 4–10 ticks (20–50s at 5s/tick)
