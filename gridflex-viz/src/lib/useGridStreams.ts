import { useEffect, useRef, useState } from "react";
import {
  appendDemandHistory,
  appendSupplyHistory,
  type ZoneHistory,
} from "./history";
import type {
  ActiveSpike,
  Issue,
  SimClock,
  StreamConnection,
  SupplySummary,
  Trade,
  ZoneMetrics,
} from "./types";

const API = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
const WS = import.meta.env.VITE_WS_URL ?? "ws://localhost:8000";

function wsUrl(path: string): string {
  return `${WS}${path}`;
}

function mergeZone(
  map: Map<string, ZoneMetrics>,
  zone_id: string,
  patch: Partial<ZoneMetrics>
) {
  map.set(zone_id, { ...map.get(zone_id), zone_id, ...patch });
}

export function useGridStreams() {
  const [zones, setZones] = useState<Map<string, ZoneMetrics>>(new Map());
  const [trades, setTrades] = useState<Trade[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [spikes, setSpikes] = useState<ActiveSpike[]>([]);
  const [summary, setSummary] = useState<SupplySummary>({});
  const [lastTs, setLastTs] = useState<string | null>(null);
  const [connection, setConnection] = useState<StreamConnection>({
    demand: "connecting",
    supply: "connecting",
    trades: "connecting",
    issues: "connecting",
  });
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [history, setHistory] = useState<ZoneHistory>(new Map());
  const [sim, setSim] = useState<SimClock | null>(null);

  const zonesRef = useRef(zones);
  zonesRef.current = zones;

  useEffect(() => {
    let stopped = false;
    const sockets: WebSocket[] = [];
    const reconnectTimers: number[] = [];

    const open = (
      path: string,
      key: keyof StreamConnection,
      onFrame: (data: Record<string, unknown>) => void
    ) => {
      if (stopped) return;

      setConnection((c) => ({ ...c, [key]: "connecting" }));

      const socket = new WebSocket(wsUrl(path));
      sockets.push(socket);

      socket.onopen = () => {
        if (stopped) return;
        setConnection((c) => ({ ...c, [key]: "live" }));
      };

      socket.onerror = () => {
        if (stopped) return;
        setConnection((c) => ({ ...c, [key]: "error" }));
      };

      socket.onclose = () => {
        if (stopped) return;

        setConnection((c) => ({ ...c, [key]: "connecting" }));

        const timer = window.setTimeout(() => {
          if (!stopped) {
            open(path, key, onFrame);
          }
        }, 1500);

        reconnectTimers.push(timer);
      };

      socket.onmessage = (event) => {
        if (stopped) return;

        try {
          const data = JSON.parse(event.data as string);

          if (data.type === "connected" || data.type === "pong") {
            setConnection((c) => ({ ...c, [key]: "live" }));
            return;
          }

          setConnection((c) => ({ ...c, [key]: "live" }));
          onFrame(data);
        } catch (error) {
          console.warn(`Malformed ${key} frame`, error);
        }
      };
    };

    open("/ws/demand", "demand", (data) => {
      const ts = (data.ts as string) ?? new Date().toISOString();
      const readings = (data.readings as ZoneMetrics[]) ?? [];
      const simClock = data.sim as SimClock | undefined;
      const simTime = simClock?.sim_time;

      const next = new Map(zonesRef.current);
      for (const reading of readings) {
        mergeZone(next, reading.zone_id, reading);
      }

      setZones(next);
      setHistory((prev) => appendDemandHistory(prev, ts, readings, simTime));
      setSpikes((data.active_spikes as ActiveSpike[]) ?? []);
      if (simClock) setSim(simClock);
      setLastTs(ts);
    });

    open("/ws/supply", "supply", (data) => {
      const ts = (data.ts as string) ?? new Date().toISOString();
      const readings = (data.readings as ZoneMetrics[]) ?? [];
      const simTime = (data.sim as SimClock | undefined)?.sim_time;

      const next = new Map(zonesRef.current);
      for (const reading of readings) {
        mergeZone(next, reading.zone_id, reading);
      }

      setZones(next);
      setHistory((prev) => appendSupplyHistory(prev, ts, readings, simTime));
      setSummary({
        agent: data.agent as string,
        agent_note: data.agent_note as string,
        total_unmet_mw: data.total_unmet_mw as number,
        total_cost: data.total_cost as number,
        budget_remaining: data.budget_remaining as number,
        fully_served: data.fully_served as boolean,
      });
      setLastTs(ts);
    });

    open("/ws/trades", "trades", (data) => {
      setTrades((data.trades as Trade[]) ?? []);
      setLastTs((data.ts as string) ?? null);
    });

    open("/ws/issues", "issues", (data) => {
      setIssues((data.issues as Issue[]) ?? []);
      setLastTs((data.ts as string) ?? null);
    });

    return () => {
      stopped = true;

      for (const timer of reconnectTimers) {
        window.clearTimeout(timer);
      }

      for (const socket of sockets) {
        try {
          socket.close();
        } catch {
          // ignore cleanup errors
        }
      }
    };
  }, []);

  return {
    apiBase: API,
    zones,
    history,
    sim,
    trades,
    issues,
    spikes,
    summary,
    lastTs,
    connection,
    selectedZone,
    setSelectedZone,
  };
}