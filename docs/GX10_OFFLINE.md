# Offline demo: everything on ASUS GX10, UI viewed on Mac via SSH

## Overview

| Runs on GX10 | Viewed on Mac |
|---|---|
| ML Docker `:8002` | via SSH tunnel |
| Backend `:8000` | via SSH tunnel |
| Vite dashboard `:5174` | **http://127.0.0.1:5174** in Mac browser |

No LAN IP on GX10. No internet. SSH only.

```
┌──────────── Mac browser ────────────┐
│  http://127.0.0.1:5174            │
│  ws://127.0.0.1:8000                │
└──────────────┬──────────────────────┘
               │  ssh -L 5174 -L 8000 -L 8002
┌──────────────▼──────────────────────┐
│  ASUS GX10 (127.0.0.1 only)         │
│  ML → backend → 25 agents → market  │
│  → WebSocket → Vite :5174           │
└─────────────────────────────────────┘
```

---

## One-time setup

### 1. Mac — build Docker image

```bash
./scripts/build_ml_docker.sh
```

### 2. Mac — sync repo + offline deps to GX10

```bash
export GX10_SSH=gx10   # ~/.ssh/config Host name

cd gridflex-viz && npm install && cd ..   # ensure node_modules exists on Mac
python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt

SYNC_NODE_MODULES=1 SYNC_VENV=1 ./scripts/sync_offline_bundle.sh
```

### 3. GX10 — load Docker image (first time only)

```bash
ssh gx10
cd ~/gridflex
gunzip -c gridflex-ml-arm64.tar.gz | docker load
```

---

## Every demo

### Terminal 1 — GX10 (SSH in)

```bash
cd ~/gridflex
./scripts/run_gx10_all.sh
```

Wait for: `All services up on GX10.`

### Terminal 2 — Mac

```bash
export GX10_SSH=gx10
./scripts/run_mac_view.sh
```

Browser opens **http://127.0.0.1:5174** on your Mac.

Reset spike hour (from Mac):

```bash
curl -X POST http://127.0.0.1:8000/demo/reset-playback
```

---

## What you see on the UI

1. **Agent → Market Pipeline** — ML forecast → 25 agents → market clear → dispatch  
2. **Map** — blue wards = accepted bids, orange = rejected, cyan flow arcs  
3. **Agent Observatory** — 25 ward agent cells with bid / accepted / idle  
4. **Simulation panel** — accepted vs rejected bid lists, stress before→after  

---

## SSH config example

```
Host gx10
  HostName <your-ssh-endpoint>
  User youruser
  IdentityFile ~/.ssh/id_ed25519
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Blank page on Mac | GX10 `run_gx10_all.sh` running? Tunnel terminal open? |
| WebSocket error | Tunnel must forward `:8000`; check `gridflex-viz/.env.gx10` |
| `node_modules missing` on GX10 | `SYNC_NODE_MODULES=1 ./scripts/sync_offline_bundle.sh` |
| ML fails | `docker logs gridflex-ml` on GX10 |
| No bids | `curl -X POST http://127.0.0.1:8000/demo/reset-playback` |
| Logs on GX10 | `/tmp/gridflex/backend.log`, `/tmp/gridflex/frontend.log` |

---

## Scripts

| Script | Where | Purpose |
|---|---|---|
| `run_gx10_all.sh` | GX10 | Start ML + backend + frontend |
| `run_mac_view.sh` | Mac | SSH tunnels + open browser |
| `sync_offline_bundle.sh` | Mac | rsync repo over SSH |
| `build_ml_docker.sh` | Mac | Build + save Docker image |
