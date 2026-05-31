#!/usr/bin/env bash
# Run GridFlex on DGX Spark with local NVIDIA NIM (LLM agents).
# Usage: ./scripts/run_spark.sh
# Prerequisite: NIM container listening on port 8001 (see below).

set -euo pipefail
cd "$(dirname "$0")/.."

export AGENT_MODE=llm
export REPORTER_MODE=llm
export NIM_BASE_URL="${NIM_BASE_URL:-http://localhost:8001/v1}"
export NIM_MODEL="${NIM_MODEL:-meta/llama-3.1-8b-instruct}"
export NIM_TIMEOUT_SEC="${NIM_TIMEOUT_SEC:-45}"
export LLM_STREAM_INTERVAL_SEC="${LLM_STREAM_INTERVAL_SEC:-15}"

echo "GridFlex Spark mode: AGENT_MODE=$AGENT_MODE NIM=$NIM_BASE_URL model=$NIM_MODEL"
echo "Start NIM separately, e.g.:"
echo "  docker run --gpus all -p 8001:8000 -e NGC_API_KEY nvcr.io/nim/meta/llama-3.1-8b-instruct:latest"
echo ""

exec python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
