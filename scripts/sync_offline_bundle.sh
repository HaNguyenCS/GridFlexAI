#!/usr/bin/env bash
# Copy repo + offline deps to GX10 over SSH.
#
#   export GX10_SSH=gx10
#   SYNC_NODE_MODULES=1 SYNC_VENV=1 ./scripts/sync_offline_bundle.sh
set -euo pipefail
cd "$(dirname "$0")/.."

GX10_SSH="${GX10_SSH:-}"
if [[ -z "${GX10_SSH}" && -n "${GX10_HOST:-}" ]]; then
  GX10_SSH="${GX10_USER:-$USER}@${GX10_HOST}"
fi
GX10_SSH="${GX10_SSH:?Set GX10_SSH (e.g. export GX10_SSH=gx10)}"
GX10_PATH="${GX10_PATH:-~/gridflex}"

RSYNC_EXCLUDES=(
  --exclude .git
)

if [[ "${SYNC_NODE_MODULES:-0}" != "1" ]]; then
  RSYNC_EXCLUDES+=(--exclude node_modules --exclude gridflex-viz/node_modules)
fi

if [[ "${SYNC_VENV:-0}" != "1" ]]; then
  RSYNC_EXCLUDES+=(--exclude .venv)
fi

echo "Syncing to ${GX10_SSH}:${GX10_PATH} ..."
[[ "${SYNC_NODE_MODULES:-0}" == "1" ]] && echo "  (including gridflex-viz/node_modules)"
[[ "${SYNC_VENV:-0}" == "1" ]] && echo "  (including .venv)"

rsync -avz --progress -e ssh \
  "${RSYNC_EXCLUDES[@]}" \
  ./ "${GX10_SSH}:${GX10_PATH}/"

if [[ -f gridflex-ml-arm64.tar.gz ]]; then
  echo "Copying Docker image tarball ..."
  rsync -avz --progress -e ssh gridflex-ml-arm64.tar.gz \
    "${GX10_SSH}:${GX10_PATH}/"
fi

echo ""
echo "Next on GX10:"
echo "  cd ${GX10_PATH} && gunzip -c gridflex-ml-arm64.tar.gz | docker load  # first time"
echo "  ./scripts/run_gx10_all.sh"
echo ""
echo "On Mac:"
echo "  ./scripts/run_mac_view.sh"
