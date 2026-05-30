import { useEffect, useRef, useState } from "react";
import type {
  ActiveSpike,
  Issue,
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
  const zonesRef = useRef(zones);
  zonesRef.current = zones;

  useEffect(() => {
    const sockets: WebSocket[] = [];

    const open = (
      path: string,
      key: keyof StreamConnection,
      onFrame: (data: Record<string, unknown>) => void
    ) => {
      const socket = new WebSocket(wsUrl(path));
      sockets.push(socket);

      socket.onopen = () =>
        setConnection((c) => ({ ...c, [key]: "live" }));
      socket.onerror = () =>
        setConnection((c) => ({ ...c, [key]: "error" }));
      socket.onclose = () =>
        setConnection((c) => ({ ...c, [key]: "error" }));
      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string);
          if (data.type === "connected") return;
          onFrame(data);
        } catch {
          // ignore malformed frames
        }
      };
    };

    open("/ws/demand", "demand", (data) => {
      const next = new Map(zonesRef.current);
      for (const reading of (data.readings as ZoneMetrics[]) ?? []) {
        mergeZone(next, reading.zone_id, reading);
      }
      setZones(next);
      setSpikes((data.active_spikes as ActiveSpike[]) ?? []);
      setLastTs((data.ts as string) ?? null);
    });

    open("/ws/supply", "supply", (data) => {
      const next = new Map(zonesRef.current);
      for (const reading of (data.readings as ZoneMetrics[]) ?? []) {
        mergeZone(next, reading.zone_id, reading);
      }
      setZones(next);
      setSummary({
        agent: data.agent as string,
        agent_note: data.agent_note as string,
        total_unmet_mw: data.total_unmet_mw as number,
        total_cost: data.total_cost as number,
        budget_remaining: data.budget_remaining as number,
        fully_served: data.fully_served as boolean,
      });
      setLastTs((data.ts as string) ?? null);
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
      for (const socket of sockets) socket.close();
    };
  }, []);

  return {
    apiBase: API,
    zones,
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
