# GridFlex AI

Toronto 25-ward flex grid demo — ML on ASUS GX10 drives 25 ward agents that bid into a flex market.

## Demo flow (each ~2s tick)

```
historical replay → ML forecast → 25 ward agent bids → market clearing → UI
```

| Step | Where | What |
|---|---|---|
| ML Forecast | GX10 `:8002` | System stress + 25 ward predictions |
| Ward Agents ×25 | GX10 backend | ML bid payloads → submitted bids |
| Market Clearing | GX10 backend | Accept/reject, stress after |
| Dashboard | Mac browser | Map, pipeline, Agent Observatory |

Full offline guide: [docs/GX10_OFFLINE.md](docs/GX10_OFFLINE.md)

---

## GX10 + Mac (production demo)

**One-time (Mac):**
```bash
./scripts/build_ml_docker.sh
export GX10_SSH=asus@gx10-3807.local   # or Host from ~/.ssh/config
cd gridflex-viz && npm install && cd ..
SYNC_NODE_MODULES=1 ./scripts/sync_offline_bundle.sh
```

**GX10 (first time):** `gunzip -c gridflex-ml-arm64.tar.gz | docker load`

**Every demo:**

| Terminal | Command |
|---|---|
| GX10 (SSH) | `cd ~/gridflex && ./scripts/run_gx10_all.sh` |
| Mac | `export GX10_SSH=asus@gx10-3807.local && ./scripts/run_mac_view.sh` |

Open http://127.0.0.1:5174 on Mac. Reset spike: `curl -X POST http://127.0.0.1:8000/demo/reset-playback`

---

## Local Mac dev (optional)

```bash
pip install -r requirements.txt -r ML/requirements_asus.txt
AGENT_MODE=deterministic ./scripts/run_mac.sh
cd gridflex-viz && npm run dev
```

---

## Scripts

| Script | Purpose |
|---|---|
| `run_gx10_all.sh` | ML + backend + frontend on GX10 |
| `run_mac_view.sh` | SSH tunnels + open dashboard on Mac |
| `sync_offline_bundle.sh` | rsync repo to GX10 over SSH |
| `copy_bundle_usb.sh` | USB bundle when SSH sync isn't available |
| `build_ml_docker.sh` | Build + save ML Docker image |
| `run_mac.sh` | Local backend only (dev) |

Optional LLM/NemoClaw: [docs/NEMOCLAW.md](docs/NEMOCLAW.md)
