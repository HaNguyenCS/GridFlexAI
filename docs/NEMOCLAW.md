# NemoClaw Integration for GridFlex

GridFlex simulation agents run through **NVIDIA NemoClaw** (OpenClaw inside OpenShell sandbox). Each simulation tick invokes the OpenClaw agent with the `gridflex-controller` skill, which returns JSON predictions for all 25 wards.

Fallback chain on failure: **NemoClaw → direct NIM → deterministic Python agents**.

## Architecture

```
GridFlex (Python)  →  openclaw agent --json  →  NemoClaw sandbox
                                                    ↓
                                              inference.local
                                                    ↓
                                              Ollama (Mac) or NIM (Spark)
```

## One-time setup

### Mac (local dev)

Requirements: Docker Desktop or Colima, Node 22+, 16 GB RAM recommended.

```bash
# 1. Install NemoClaw (while online)
curl -fsSL https://nvidia.com/nemoclaw.sh | bash
nemoclaw onboard
# Wizard: Compatible API → http://host.docker.internal:11434/v1 → llama3.1:8b

# 2. Ollama inference
brew install ollama
ollama pull llama3.1:8b

# 3. GridFlex
cd GridFlexAI
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
chmod +x scripts/*.sh
./scripts/setup_nemoclaw.sh

cd gridflex-viz && npm install
```

### DGX Spark (production)

```bash
curl -fsSL https://nvidia.com/nemoclaw.sh | bash
nemoclaw onboard
# Wizard: Compatible API → http://localhost:8001/v1 (NIM)

docker pull nvcr.io/nim/meta/llama-3.1-8b-instruct:latest

git clone https://github.com/HaNguyenCS/GridFlexAI.git
cd GridFlexAI
./scripts/setup_nemoclaw.sh
pip install -r requirements.txt
```

## Every session

### Mac

```bash
# Terminal 1 — Ollama
ollama serve

# Terminal 2 — verify NemoClaw
nemoclaw status

# Terminal 3 — GridFlex backend
source .venv/bin/activate
./scripts/run_mac.sh

# Terminal 4 — dashboard
cd gridflex-viz && npm run dev
# Open http://localhost:5174
```

### Spark

```bash
# Terminal 1 — NIM
docker run --gpus all -p 8001:8000 -e NGC_API_KEY \
  nvcr.io/nim/meta/llama-3.1-8b-instruct:latest

# Terminal 2 — GridFlex
./scripts/run_spark.sh

# Terminal 3 — UI
cd gridflex-viz && npm run dev -- --host
# Open http://<spark-ip>:5174
```

## Verify

```bash
curl http://localhost:8000/health
# → "agent_mode": "nemoclaw", "supply_agent": "nemoclaw_supply_agent"

curl http://localhost:8000/agent/nemoclaw/health
# → openclaw_found: true, gateway status
```

Open the **Agent Observatory** tab — header should show "NVIDIA NemoClaw / OpenClaw".

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `AGENT_MODE` | `nemoclaw` | `nemoclaw`, `llm`, or `deterministic` |
| `NEMOCLAW_OPENCLAW_BIN` | `openclaw` | Path to OpenClaw CLI |
| `NEMOCLAW_AGENT_ID` | `main` | Agent id for `openclaw agent --agent` |
| `NEMOCLAW_SESSION_ID` | `gridflex-sim` | Session prefix for tick turns |
| `NEMOCLAW_TIMEOUT_SEC` | `120` | Max seconds per agent turn |
| `NEMOCLAW_STREAM_INTERVAL_SEC` | `20` | Simulation tick cadence |
| `NEMOCLAW_GATEWAY_URL` | `http://127.0.0.1:18789` | OpenShell gateway health check |

Set `AGENT_MODE=llm` to bypass NemoClaw and call NIM directly (previous behavior).
Set `AGENT_MODE=deterministic` for rule-based agents with no LLM.

## Skill installation

The OpenClaw skill lives at `nemoclaw/skills/gridflex-controller/SKILL.md`.

Re-install after changes:

```bash
./scripts/install_gridflex_skill.sh
```

Then restart the NemoClaw/OpenClaw gateway so the skill is loaded.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `openclaw not found on PATH` | Run NemoClaw installer; ensure `openclaw` is in PATH |
| Ticks show `agent_mode: llm` or `deterministic` | NemoClaw failed; check backend logs; verify `nemoclaw status` |
| Gateway unreachable | Start Docker; run `nemoclaw onboard` again |
| Slow ticks (30–60s) | Normal for agent turns; increase `NEMOCLAW_STREAM_INTERVAL_SEC` |
| Mac OOM | Close other apps; use 8B model; ensure 16 GB RAM |

## Files

| Path | Role |
|---|---|
| `nemoclaw/skills/gridflex-controller/SKILL.md` | OpenClaw agent instructions |
| `backend/agents/nemoclaw_client.py` | CLI invocation + health check |
| `backend/agents/nemoclaw_orchestrator.py` | Simulation tick orchestrator |
| `backend/agents/nemoclaw_supply_agent.py` | Supply operator notes |
| `backend/simulation/tick_response_builder.py` | Shared JSON → response builder |
| `scripts/setup_nemoclaw.sh` | Setup helper |
| `scripts/run_mac.sh` | Mac launcher |
| `scripts/run_spark.sh` | Spark launcher |
