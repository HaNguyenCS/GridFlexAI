#!/usr/bin/env bash
# Start ML + backend + frontend on GX10 (all bind 127.0.0.1).
# View from Mac: export GX10_SSH=gx10 && ./scripts/run_mac_view.sh
set -euo pipefail
cd "$(dirname "$0")/.."

export OFFLINE_MODE=1
export AGENT_MODE=ml_service
export REPORTER_MODE=template
export ML_SERVICE_URL="${ML_SERVICE_URL:-http://127.0.0.1:8002}"
export ML_SERVICE_TIMEOUT_SEC="${ML_SERVICE_TIMEOUT_SEC:-60}"

IMAGE="${GRIDFLEX_ML_IMAGE:-gridflex-ml:latest}"
ML_PORT="${ML_PORT:-8002}"
ML_CONTAINER="${ML_CONTAINER:-gridflex-ml}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
UI_PORT="${UI_PORT:-5174}"
LOG_DIR="${GRIDFLEX_LOG_DIR:-/tmp/gridflex}"

mkdir -p "${LOG_DIR}"

if ! docker image inspect "${IMAGE}" >/dev/null 2>&1; then
  echo "ERROR: Docker image ${IMAGE} not found." >&2
  echo "  gunzip -c gridflex-ml-arm64.tar.gz | docker load" >&2
  exit 1
fi

if [[ ! -d gridflex-viz/node_modules ]]; then
  echo "ERROR: gridflex-viz/node_modules missing (GX10 has no internet)." >&2
  echo "  On Mac: SYNC_NODE_MODULES=1 ./scripts/sync_offline_bundle.sh" >&2
  exit 1
fi

if ! python3 -c "import uvicorn" 2>/dev/null; then
  echo "ERROR: Python deps missing. Sync .venv or pip install -r requirements.txt offline." >&2
  exit 1
fi

docker rm -f "${ML_CONTAINER}" 2>/dev/null || true

echo "=== GridFlex on GX10 (localhost only) ==="
echo "ML:        http://127.0.0.1:${ML_PORT}"
echo "Backend:   http://127.0.0.1:${BACKEND_PORT}"
echo "Dashboard: http://127.0.0.1:${UI_PORT}"
echo "View on Mac: ./scripts/run_mac_view.sh"
echo ""

echo "[1/3] Starting ML container..."
docker run -d --gpus all \
  -p "127.0.0.1:${ML_PORT}:8002" \
  --name "${ML_CONTAINER}" \
  "${IMAGE}"

echo "Waiting for ML..."
for _ in $(seq 1 45); do
  if curl -sf "http://127.0.0.1:${ML_PORT}/health" >/dev/null 2>&1; then
    echo "ML ready."
    break
  fi
  sleep 1
done
if ! curl -sf "http://127.0.0.1:${ML_PORT}/health" >/dev/null 2>&1; then
  echo "ERROR: ML failed. docker logs ${ML_CONTAINER}" >&2
  docker logs "${ML_CONTAINER}" 2>&1 | tail -20
  exit 1
fi

BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
  echo ""
  echo "Shutting down..."
  [[ -n "${FRONTEND_PID}" ]] && kill "${FRONTEND_PID}" 2>/dev/null || true
  [[ -n "${BACKEND_PID}" ]] && kill "${BACKEND_PID}" 2>/dev/null || true
  docker rm -f "${ML_CONTAINER}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "[2/3] Starting backend..."
python3 -m uvicorn backend.main:app \
  --host 127.0.0.1 \
  --port "${BACKEND_PORT}" \
  >"${LOG_DIR}/backend.log" 2>&1 &
BACKEND_PID=$!

for _ in $(seq 1 20); do
  if curl -sf "http://127.0.0.1:${BACKEND_PORT}/health" >/dev/null 2>&1; then
    echo "Backend ready (log: ${LOG_DIR}/backend.log)."
    break
  fi
  sleep 1
done

echo "[3/3] Starting frontend..."
cp -f gridflex-viz/.env.gx10 gridflex-viz/.env
(
  cd gridflex-viz
  npm run dev -- --host 127.0.0.1 --port "${UI_PORT}" --strictPort \
    >"${LOG_DIR}/frontend.log" 2>&1
) &
FRONTEND_PID=$!

for _ in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:${UI_PORT}/" >/dev/null 2>&1; then
    echo "Frontend ready (log: ${LOG_DIR}/frontend.log)."
    break
  fi
  sleep 1
done

echo ""
echo "All services up on GX10."
echo "On your Mac run:  export GX10_SSH=gx10 && ./scripts/run_mac_view.sh"
echo "Then open:        http://127.0.0.1:${UI_PORT}"
echo ""
echo "Reset spike hour (from Mac after tunnel): curl -X POST http://127.0.0.1:8000/demo/reset-playback"
echo "Press Ctrl+C here to stop all services."
echo ""

wait "${BACKEND_PID}"
