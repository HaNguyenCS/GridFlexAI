#!/usr/bin/env bash
# Balancer + Trader + Orchestrator stream agents (separate from backend).
set -euo pipefail
cd "$(dirname "$0")/.."

export GRIDFLEX_WS_URL="${GRIDFLEX_WS_URL:-ws://127.0.0.1:8000}"
export GRIDFLEX_API_URL="${GRIDFLEX_API_URL:-http://127.0.0.1:8000}"
export ORCHESTRATOR_INTERVAL_SEC="${ORCHESTRATOR_INTERVAL_SEC:-2}"

echo "GridFlex stream agents"
echo "  WS:  $GRIDFLEX_WS_URL"
echo "  API: $GRIDFLEX_API_URL"
echo "  Tick every ${ORCHESTRATOR_INTERVAL_SEC}s"
echo ""
echo "Prerequisite: backend running (./scripts/run_mac.sh)"
echo ""

exec python3 -m backend.stream_agents.runner "$@"
