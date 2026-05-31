import { useEffect, useState } from "react";
import type { SimulationConnection, SimulationTick } from "./simulationTypes";

const WS = import.meta.env.VITE_WS_URL ?? "ws://localhost:8000";

function wsUrl(path: string): string {
  return `${WS}${path}`;
}

export function useSimulationStream() {
  const [tick, setTick] = useState<SimulationTick | null>(null);
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
          setTick(data as SimulationTick);
        }
      } catch {
        // ignore malformed frames
      }
    };

    return () => socket.close();
  }, []);

  return { tick, connection };
}
