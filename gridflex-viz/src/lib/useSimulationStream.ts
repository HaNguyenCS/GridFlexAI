import { useEffect, useState } from "react";
import type {
  SimulationConnection,
  SimulationTick,
  TickSummary,
} from "./simulationTypes";

const WS = import.meta.env.VITE_WS_URL ?? "ws://localhost:8000";
const MAX_HISTORY = 30;

function wsUrl(path: string): string {
  return `${WS}${path}`;
}

function toSummary(tick: SimulationTick): TickSummary {
  const cr = tick.market_result.clearing_result;
  return {
    timestamp: tick.timestamp,
    stressBefore: cr.stress_score_before,
    stressAfter: cr.stress_score_after,
    bids: tick.submitted_bids.length,
    accepted: tick.market_result.accepted_bids.length,
    targetMw: tick.grid_prediction.target_reduction_mw,
  };
}

export function useSimulationStream() {
  const [tick, setTick] = useState<SimulationTick | null>(null);
  const [tickCount, setTickCount] = useState(0);
  const [history, setHistory] = useState<TickSummary[]>([]);
  const [connection, setConnection] = useState<SimulationConnection>("connecting");

  useEffect(() => {
    const socket = new WebSocket(wsUrl("/ws/simulation/live"));

    socket.onopen = () => setConnection("live");
    socket.onerror = () => setConnection("error");
    socket.onclose = () => setConnection("error");
    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string);
        if (data.type === "connected") return;
        if (data.type === "simulation_tick") {
          const next = data as SimulationTick;
          setTick(next);
          setTickCount((n) => n + 1);
          setHistory((prev) =>
            [toSummary(next), ...prev].slice(0, MAX_HISTORY)
          );
        }
      } catch {
        // ignore malformed frames
      }
    };

    return () => socket.close();
  }, []);

  return { tick, tickCount, history, connection };
}
