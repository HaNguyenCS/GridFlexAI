from pathlib import Path
import os

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

# Agent execution mode.
# ml_service   — HTTP calls to ML/src/api.py (recommended default)
# deterministic — embedded local ML + ward_spike_lookup fallback
# llm         — one NIM call replaces forecast/ward/reporter
# nemoclaw    — same as llm but via OpenClaw/NemoClaw on Spark
AGENT_MODE = os.getenv("AGENT_MODE", "ml_service")
REPORTER_MODE = os.getenv(
    "REPORTER_MODE",
    "template" if os.getenv("OFFLINE_MODE", "0").lower() in ("1", "true", "yes")
    else ("llm" if AGENT_MODE in ("llm", "nemoclaw") else "template"),
)

# GridFlex ML service (ML/src/api.py) — separate process on port 8002.
ML_SERVICE_URL = os.getenv("ML_SERVICE_URL", "http://localhost:8002")
ML_SERVICE_TIMEOUT_SEC = float(os.getenv("ML_SERVICE_TIMEOUT_SEC", "30"))

# Offline demo: GX10 has no internet; Mac talks to ML over LAN only.
# Forces template reporter, skips external NIM/NemoClaw; no cloud dependencies.
OFFLINE_MODE = os.getenv("OFFLINE_MODE", "0").lower() in ("1", "true", "yes")
NIM_BASE_URL = os.getenv("NIM_BASE_URL", "http://localhost:8001/v1")
NIM_API_KEY = os.getenv("NIM_API_KEY", "not-needed")
# DGX Spark GB10 (128GB unified): 8B–70B locally; Ultra 253B typically needs hosted NIM or 2× Spark.
NIM_MODEL = os.getenv("NIM_MODEL", "meta/llama-3.1-8b-instruct")
NIM_TIMEOUT_SEC = float(os.getenv("NIM_TIMEOUT_SEC", "45"))
# LLM inference may exceed 2s — use a longer tick when AGENT_MODE=llm on Spark.
LLM_STREAM_INTERVAL_SEC = float(os.getenv("LLM_STREAM_INTERVAL_SEC", "15"))

# NemoClaw / OpenClaw agent runtime (Mac dev or DGX Spark prod).
NEMOCLAW_AGENT_ID = os.getenv("NEMOCLAW_AGENT_ID", "main")
NEMOCLAW_SESSION_ID = os.getenv("NEMOCLAW_SESSION_ID", "gridflex-sim")
NEMOCLAW_OPENCLAW_BIN = os.getenv("NEMOCLAW_OPENCLAW_BIN", "openclaw")
NEMOCLAW_TIMEOUT_SEC = float(os.getenv("NEMOCLAW_TIMEOUT_SEC", "120"))
NEMOCLAW_STREAM_INTERVAL_SEC = float(os.getenv("NEMOCLAW_STREAM_INTERVAL_SEC", "20"))
NEMOCLAW_GATEWAY_URL = os.getenv("NEMOCLAW_GATEWAY_URL", "http://127.0.0.1:18789")
NEMOCLAW_GATEWAY_TOKEN = os.getenv("NEMOCLAW_GATEWAY_TOKEN", "")
