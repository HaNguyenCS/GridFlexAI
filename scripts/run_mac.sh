#!/usr/bin/env bash
# Local Mac backend (dev / fallback). For GX10 demo use run_gx10_all.sh + run_mac_view.sh.
set -euo pipefail
cd "$(dirname "$0")/.."

export AGENT_MODE="${AGENT_MODE:-deterministic}"
export REPORTER_MODE="${REPORTER_MODE:-template}"

echo "GridFlex local dev: AGENT_MODE=$AGENT_MODE"
echo "GX10 demo: ./scripts/run_gx10_all.sh (GX10) + ./scripts/run_mac_view.sh (Mac)"
echo ""

exec python3 -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
