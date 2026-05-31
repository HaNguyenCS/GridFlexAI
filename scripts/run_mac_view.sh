#!/usr/bin/env bash
# Mac: SSH tunnels to GX10 + open dashboard in browser.
# GX10 must be running: ./scripts/run_gx10_all.sh
set -euo pipefail
cd "$(dirname "$0")/.."

GX10_SSH="${GX10_SSH:-}"
if [[ -z "${GX10_SSH}" && -n "${GX10_HOST:-}" ]]; then
  GX10_SSH="${GX10_USER:-$USER}@${GX10_HOST}"
fi
GX10_SSH="${GX10_SSH:?Set GX10_SSH (e.g. export GX10_SSH=gx10 from ~/.ssh/config)}"

UI_PORT="${LOCAL_UI_PORT:-5174}"
API_PORT="${LOCAL_API_PORT:-8000}"
ML_PORT="${LOCAL_ML_PORT:-8002}"
UI_URL="http://127.0.0.1:${UI_PORT}"

echo "=== GridFlex viewer (Mac → GX10 over SSH) ==="
echo ""
echo "Before this, on GX10 run:  ./scripts/run_gx10_all.sh"
echo ""
echo "Tunnels:"
echo "  ${UI_URL}  → GX10 dashboard"
echo "  http://127.0.0.1:${API_PORT}  → GX10 backend (WebSockets + API)"
echo "  http://127.0.0.1:${ML_PORT}  → GX10 ML (optional debug)"
echo ""

if ssh -o ConnectTimeout=10 "${GX10_SSH}" \
  "curl -sf http://127.0.0.1:${UI_PORT}/ >/dev/null && curl -sf http://127.0.0.1:${API_PORT}/health >/dev/null"; then
  echo "GX10 services detected."
else
  echo "WARNING: GX10 services not responding yet."
  echo "  SSH in and run: ./scripts/run_gx10_all.sh"
  echo "  Continuing anyway — retry browser in ~30s."
fi
echo ""

if command -v open >/dev/null 2>&1; then
  ( sleep 3 && open "${UI_URL}" ) &
fi

echo "Opening ${UI_URL} in 3s. Keep this terminal open (tunnel active)."
echo "Ctrl+C closes tunnels."
echo ""

exec ssh -N \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -L "127.0.0.1:${UI_PORT}:127.0.0.1:5174" \
  -L "127.0.0.1:${API_PORT}:127.0.0.1:8000" \
  -L "127.0.0.1:${ML_PORT}:127.0.0.1:8002" \
  "${GX10_SSH}"
