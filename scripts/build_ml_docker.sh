#!/usr/bin/env bash
# Build ML Docker image on a machine WITH internet. Transfer tarball to offline GX10.
set -euo pipefail
cd "$(dirname "$0")/.."

IMAGE="${GRIDFLEX_ML_IMAGE:-gridflex-ml:latest}"
PLATFORM="${DOCKER_PLATFORM:-linux/arm64}"
OUT="${GRIDFLEX_ML_TAR:-gridflex-ml-arm64.tar.gz}"

echo "Building ${IMAGE} for ${PLATFORM} ..."
docker build --platform "${PLATFORM}" -t "${IMAGE}" -f docker/ml-service/Dockerfile .

echo "Saving ${OUT} (transfer this to the GX10 via USB/scp on LAN) ..."
docker save "${IMAGE}" | gzip > "${OUT}"

echo ""
echo "Done. On offline GX10:"
echo "  gunzip -c ${OUT} | docker load"
echo "  ./scripts/run_gx10_all.sh"
