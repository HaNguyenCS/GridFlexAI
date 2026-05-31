#!/usr/bin/env bash
# Run GridFlex on DGX Spark with NemoClaw agents (NIM or Ollama inference backend).
set -euo pipefail
cd "$(dirname "$0")/.."

export AGENT_MODE=nemoclaw
export REPORTER_MODE=llm
export NEMOCLAW_AGENT_ID="${NEMOCLAW_AGENT_ID:-main}"
export NEMOCLAW_SESSION_ID="${NEMOCLAW_SESSION_ID:-gridflex-sim}"
export NEMOCLAW_OPENCLAW_BIN="${NEMOCLAW_OPENCLAW_BIN:-openclaw}"
export NEMOCLAW_TIMEOUT_SEC="${NEMOCLAW_TIMEOUT_SEC:-120}"
export NEMOCLAW_STREAM_INTERVAL_SEC="${NEMOCLAW_STREAM_INTERVAL_SEC:-20}"
export NEMOCLAW_GATEWAY_URL="${NEMOCLAW_GATEWAY_URL:-http://127.0.0.1:18789}"

# Fallback chain uses NIM if NemoClaw fails
export NIM_BASE_URL="${NIM_BASE_URL:-http://localhost:8001/v1}"
export NIM_MODEL="${NIM_MODEL:-meta/llama-3.1-8b-instruct}"
export NIM_TIMEOUT_SEC="${NIM_TIMEOUT_SEC:-45}"

echo "GridFlex Spark mode: AGENT_MODE=$AGENT_MODE openclaw=$NEMOCLAW_OPENCLAW_BIN"
echo "Prerequisites:"
echo "  - nemoclaw onboard  (Compatible API → http://localhost:8001/v1 for NIM)"
echo "  - docker run --gpus all -p 8001:8000 -e NGC_API_KEY nvcr.io/nim/meta/llama-3.1-8b-instruct:latest"
echo "  - ./scripts/setup_nemoclaw.sh  (install GridFlex skill)"
echo ""

exec python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
