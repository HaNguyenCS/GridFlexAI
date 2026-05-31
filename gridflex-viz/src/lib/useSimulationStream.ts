import { useEffect, useRef, useState } from "react";
import type {
  SimulationConnection,
  SimulationTick,
  TickSummary,
} from "./simulationTypes";

const WS = import.meta.env.VITE_WS_URL ?? "ws://127.0.0.1:8080";
const MAX_HISTORY = 30;

function wsUrl(path: string): string {
  return `${WS}${path}`;
}

function isSimulationTick(data: unknown): data is SimulationTick {
  if (!data || typeof data !== "object") return false;

  const obj = data as Record<string, unknown>;

  return Boolean(
    obj.grid_prediction &&
      obj.market_result &&
      obj.ward_predictions &&
      obj.submitted_bids
  );
}

function normalizeTick(data: unknown): SimulationTick | null {
  if (!data || typeof data !== "object") return null;

  const obj = data as Record<string, unknown>;

  if (obj.type === "connected") return null;

  if (obj.type === "simulation_tick") {
    return obj as unknown as SimulationTick;
  }

  if (isSimulationTick(obj)) {
    return obj;
  }

  return null;
}

function toSummary(tick: SimulationTick): TickSummary {
  const cr = tick.market_result.clearing_result;

  return {
    timestamp: tick.timestamp ?? new Date().toISOString(),
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
  const [connection, setConnection] =
    useState<SimulationConnection>("connecting");

  const reconnectTimer = useRef<number | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    function connect() {
      const url = wsUrl("/ws/simulation/live");
      console.log("APP SIM WS CONNECTING", url);

      const socket = new WebSocket(url);
      socketRef.current = socket;

      socket.onopen = () => {
        if (!mountedRef.current) return;
        console.log("APP SIM WS OPEN");
        setConnection("live");
      };

      socket.onerror = (event) => {
        if (!mountedRef.current) return;
        console.log("APP SIM WS ERROR", event);
        setConnection("error");
      };

      socket.onclose = (event) => {
        if (!mountedRef.current) return;

        console.log("APP SIM WS CLOSE", event.code, event.reason);
        setConnection("error");

        reconnectTimer.current = window.setTimeout(() => {
          if (mountedRef.current) connect();
        }, 1200);
      };

      socket.onmessage = (event) => {
        try {
          const raw = JSON.parse(event.data as string);
          console.log("APP SIM WS RAW", raw);

          const next = normalizeTick(raw);
          if (!next) return;

          const phase = next.snapshot?.stress_phase;
          const cr = next.market_result.clearing_result;

          console.log("APP SET SIM TICK", {
            phase,
            risk: next.grid_prediction.risk_level,
            target: next.grid_prediction.target_reduction_mw,
            before: cr.stress_score_before,
            after: cr.stress_score_after,
            bids: next.submitted_bids.length,
            accepted: next.market_result.accepted_bids.length,
          });

          setTick(next);
          setTickCount((n) => n + 1);
          setConnection("live");

          setHistory((prev) => [toSummary(next), ...prev].slice(0, MAX_HISTORY));
        } catch (error) {
          console.warn("APP SIM WS BAD FRAME", error);
        }
      };
    }

    connect();

    return () => {
      mountedRef.current = false;

      if (reconnectTimer.current != null) {
        window.clearTimeout(reconnectTimer.current);
      }

      socketRef.current?.close();
    };
  }, []);

  return { tick, tickCount, history, connection };
}
