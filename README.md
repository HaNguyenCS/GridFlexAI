# GridFlex AI

Step-by-step build tracker for Toronto GTA grid coordination.

## Steps

- [x] **Step 1 — WebSocket connection** (`backend/main.py`, `/ws/live`)
- [ ] **Step 2 — Live data ingestion** (IESO poll → store)
- [ ] **Step 3 — SQLite storage** (`backend/db/`)
- [ ] **Step 4 — ML forecast** (`backend/ml/`)
- [ ] **Step 5 — LangGraph agents** (`backend/agents/`)
- [ ] **Step 6 — Email alerts** (`backend/alerts/`)

## Step 1: WebSocket

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn backend.main:app --reload --port 8000
```

Test:

```bash
# health check
curl http://localhost:8000/health

# websocket (requires wscat: npm i -g wscat)
wscat -c ws://localhost:8000/ws/live
```

Expected: connect → receive `connected` message → send `ping` → receive `pong`.

## Structure

```
backend/
├── main.py           # Step 1 — WebSocket server
├── config.py         # Step 2+
├── ingestion/        # Step 2 — IESO live data
├── db/               # Step 3 — SQLite
├── ml/               # Step 4 — forecast model
├── agents/           # Step 5 — LangGraph
└── alerts/           # Step 6 — email
```
