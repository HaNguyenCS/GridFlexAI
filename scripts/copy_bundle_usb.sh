#!/usr/bin/env bash
# USB bundle when you cannot rsync over SSH.
set -euo pipefail
cd "$(dirname "$0")/.."

OUT="${USB_BUNDLE_DIR:-./gridflex-usb-bundle}"

echo "Building offline bundle at ${OUT} ..."
rm -rf "${OUT}"
mkdir -p "${OUT}"

rsync -a \
  --exclude .git \
  --exclude gridflex-usb-bundle \
  ./ "${OUT}/"

if [[ -f gridflex-ml-arm64.tar.gz ]]; then
  cp gridflex-ml-arm64.tar.gz "${OUT}/"
fi

cat > "${OUT}/INSTALL.txt" <<'EOF'
GridFlex offline install

1. Copy this folder to the GX10 (USB).

2. On GX10:
   cd /path/to/gridflex-usb-bundle
   gunzip -c gridflex-ml-arm64.tar.gz | docker load
   python3 -m venv .venv && source .venv/bin/activate
   pip install -r requirements.txt
   ./scripts/run_gx10_all.sh

3. On Mac:
   export GX10_SSH=your-ssh-target
   ./scripts/run_mac_view.sh

4. Open http://127.0.0.1:5174 on Mac
   curl -X POST http://127.0.0.1:8000/demo/reset-playback
EOF

echo "Done. Copy ${OUT}/ to USB → GX10 → follow INSTALL.txt"
