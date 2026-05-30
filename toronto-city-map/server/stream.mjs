// Optional Node WebSocket broadcaster.
//
// Run `npm run stream` to start a local WS server on :8787 that emits
// stochastic StreamEvent frames against an assumed building set. Point
// the frontend at it via:  VITE_STREAM_URL=ws://localhost:8787 npm run dev
//
// The server doesn't know which building IDs your frontend is using —
// it tags events with the well-known landmark IDs from `getProceduralToronto`
// (lm-0..lm-13) plus a sweep of the procedural grid (g-0..g-N).

import { WebSocketServer } from "ws";

const PORT = Number(process.env.PORT ?? 8787);
const wss = new WebSocketServer({ port: PORT });

const KINDS = ["highlight", "annotate", "alert", "clear"];
const COLORS = ["#5cf2c8", "#7ad4ff", "#ffc66e", "#ff8a8a", "#c89cff"];
const NOTES = {
  highlight: [
    "Sensor reading anomaly",
    "Energy spike detected",
    "Pedestrian density rising",
    "Wi-Fi mesh saturation",
  ],
  annotate: [
    "Inspection scheduled",
    "Permit issued · facade",
    "Heritage flag lifted",
    "BIM sync 2 mins ago",
  ],
  alert: [
    "Smoke alarm tripped",
    "Elevator outage",
    "Power phase imbalance",
    "Security cordon active",
  ],
  clear: [""],
};

const TARGETS = [
  // Landmarks (mirrors the procedural set)
  ...Array.from({ length: 14 }, (_, i) => `lm-${i.toString(36)}`),
  // A sweep of the grid (1700+ buildings; we just cover the early ones)
  ...Array.from({ length: 600 }, (_, i) => `g-${i.toString(36)}`),
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

setInterval(() => {
  if (wss.clients.size === 0) return;
  const kind = Math.random() < 0.55 ? "highlight"
    : Math.random() < 0.78 ? "annotate"
    : Math.random() < 0.94 ? "alert"
    : "clear";
  const event = {
    ts: new Date().toISOString(),
    buildingId: pick(TARGETS),
    kind,
    color: kind === "alert" ? "#ff6b6b"
      : kind === "annotate" ? "#7ad4ff"
      : pick(COLORS),
    note: pick(NOTES[kind]),
    ttlMs: kind === "alert" ? 9000 : kind === "annotate" ? 14000 : 5500,
    severity: kind === "alert" ? 0.85 + Math.random() * 0.15 : Math.random() * 0.6,
  };
  const frame = JSON.stringify(event);
  for (const ws of wss.clients) {
    if (ws.readyState === ws.OPEN) ws.send(frame);
  }
}, 450);

console.log(`[stream] Toronto topology stream listening on ws://localhost:${PORT}`);
console.log(`[stream] Set VITE_STREAM_URL=ws://localhost:${PORT} and restart vite to consume.`);
