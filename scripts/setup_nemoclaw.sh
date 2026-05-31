#!/usr/bin/env bash
# One-time NemoClaw setup helper for GridFlex (does not run the interactive installer).
set -euo pipefail
cd "$(dirname "$0")/.."

echo "GridFlex NemoClaw setup"
echo "======================="
echo ""

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: Docker not found. Install Docker Desktop (Mac) or Docker Engine (Spark)." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "ERROR: Docker is not running. Start Docker Desktop or Colima first." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "WARN: Node.js not found. NemoClaw installer will install Node 22+."
else
  echo "Node: $(node --version)"
fi

if command -v openclaw >/dev/null 2>&1; then
  echo "OpenClaw CLI: $(command -v openclaw)"
elif command -v nemoclaw >/dev/null 2>&1; then
  echo "NemoClaw CLI: $(command -v nemoclaw)"
else
  echo ""
  echo "NemoClaw not installed yet. Run (while online):"
  echo "  curl -fsSL https://nvidia.com/nemoclaw.sh | bash"
  echo "  nemoclaw onboard"
  echo ""
fi

chmod +x scripts/install_gridflex_skill.sh
./scripts/install_gridflex_skill.sh

echo ""
echo "Next steps:"
echo "  1. Complete 'nemoclaw onboard' if not done (pick Compatible API → Ollama or NIM)"
echo "  2. Mac: ollama serve && ollama pull llama3.1:8b"
echo "  3. Spark: docker run --gpus all -p 8001:8000 -e NGC_API_KEY nvcr.io/nim/meta/llama-3.1-8b-instruct:latest"
echo "  4. Start GridFlex: ./scripts/run_mac.sh  (Mac) or ./scripts/run_spark.sh  (Spark)"
echo "  5. Verify: curl http://localhost:8000/agent/nemoclaw/health"
