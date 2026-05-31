// useMapAgent — observes the ward colour map produced by useGridStreams
// and emits an agent message whenever a ward transitions from a non-green
// severity (critical / high / moderate) back to green (normal).
//
// Two transition paths are handled:
//   1. Explicit: a new "normal" severity event arrives for a ward that
//      was previously coloured with a higher severity.
//   2. Expiry: the ward's coloured state expires (pruned from the map),
//      returning it to the default green baseline.

import { useEffect, useRef, useState } from "react";
import type { WardGridColor } from "./gridStreams";
import type { GridSeverity } from "./types";
import type { Ward } from "./wards";

export interface AgentMessage {
  /** Unique id for this agent message. */
  id: string;
  /** ISO timestamp of detection. */
  ts: string;
  /** Ward that transitioned. */
  wardId: string;
  /** Human-readable ward name (e.g. "Ward 13 — Toronto Centre"). */
  wardLabel: string;
  /** Severity the ward was in before the transition. */
  fromSeverity: GridSeverity;
  /** Metric that was active during the non-green state. */
  metric: string;
  /** Last observed value for that metric. */
  value: number;
  /** Agent's justification narrative. */
  justification: string;
  /** Whether the operator has acknowledged / actioned this card. */
  actioned: boolean;
}

interface UseMapAgentOptions {
  wardColors: Map<string, WardGridColor>;
  wards: Ward[];
  /** Maximum number of messages to retain in the inbox. Default 20. */
  cap?: number;
}

interface UseMapAgentResult {
  messages: AgentMessage[];
  /** Number of unread (non-actioned) messages. */
  unreadCount: number;
  /** Mark a single message as actioned. */
  markActioned: (id: string) => void;
  /** Dismiss a message from the inbox. */
  dismiss: (id: string) => void;
}

function isNonGreen(sev: GridSeverity): boolean {
  return sev !== "normal";
}

function buildJustification(
  wardLabel: string,
  fromSev: GridSeverity,
  metric: string,
  value: number,
  cause: "explicit" | "expiry"
): string {
  const causeLabel =
    cause === "explicit"
      ? "a fresh normal-band reading"
      : "the alert TTL expiring without further escalation";
  return `${wardLabel} has recovered from ${fromSev} to green. `
    + `The last observed ${metric} was ${value.toFixed(1)}, now cleared by ${causeLabel}. `
    + `Operator intervention is recommended to confirm field conditions and close the loop.`;
}

export function useMapAgent({
  wardColors,
  wards,
  cap = 20,
}: UseMapAgentOptions): UseMapAgentResult {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  // Track last non-green state per ward so we can detect both transitions.
  const lastNonGreenRef = useRef<
    Map<string, { severity: GridSeverity; metric: string; value: number }>
  >(new Map());
  const counterRef = useRef(0);

  const wardNameById = useRef<Map<string, Ward>>(new Map());
  useEffect(() => {
    const m = new Map<string, Ward>();
    for (const w of wards) m.set(w.id, w);
    wardNameById.current = m;
  }, [wards]);

  // Detect transitions on every wardColors update.
  useEffect(() => {
    const prev = lastNonGreenRef.current;
    const nextNonGreen = new Map<string, { severity: GridSeverity; metric: string; value: number }>();

    // Collect current non-green wards.
    for (const [wardId, wc] of wardColors) {
      if (isNonGreen(wc.severity)) {
        nextNonGreen.set(wardId, { severity: wc.severity, metric: wc.metric, value: wc.value });
      }
    }

    const fresh: AgentMessage[] = [];

    // Case 1 (expiry): ward was non-green, now absent from the map → returned to green.
    for (const [wardId, info] of prev) {
      if (!wardColors.has(wardId)) {
        const ward = wardNameById.current.get(wardId);
        const wardLabel = ward
          ? `Ward ${ward.wardNumber} — ${ward.name}`
          : wardId;
        fresh.push({
          id: `agent-${++counterRef.current}`,
          ts: new Date().toISOString(),
          wardId,
          wardLabel,
          fromSeverity: info.severity,
          metric: info.metric,
          value: info.value,
          justification: buildJustification(wardLabel, info.severity, info.metric, info.value, "expiry"),
          actioned: false,
        });
      }
    }

    // Case 2 (explicit): ward was non-green, now has a normal event → transitioned.
    // We detect this by checking if the ward was tracked as non-green but now
    // has a severity that is "normal" (i.e. present in wardColors with normal).
    for (const [wardId, wc] of wardColors) {
      if (wc.severity === "normal" && prev.has(wardId)) {
        const info = prev.get(wardId)!;
        // Avoid duplicate with expiry case (ward absent handled above).
        if (fresh.some((m) => m.wardId === wardId)) continue;
        const ward = wardNameById.current.get(wardId);
        const wardLabel = ward
          ? `Ward ${ward.wardNumber} — ${ward.name}`
          : wardId;
        fresh.push({
          id: `agent-${++counterRef.current}`,
          ts: new Date().toISOString(),
          wardId,
          wardLabel,
          fromSeverity: info.severity,
          metric: info.metric,
          value: info.value,
          justification: buildJustification(wardLabel, info.severity, info.metric, info.value, "explicit"),
          actioned: false,
        });
      }
    }

    lastNonGreenRef.current = nextNonGreen;

    if (fresh.length > 0) {
      setMessages((prev) => {
        const next = [...fresh, ...prev];
        return next.length > cap ? next.slice(0, cap) : next;
      });
    }
  }, [wardColors, cap]);

  const unreadCount = messages.filter((m) => !m.actioned).length;

  function markActioned(id: string) {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, actioned: true } : m)));
  }

  function dismiss(id: string) {
    setMessages((prev) => prev.filter((m) => m.id !== id));
  }

  return { messages, unreadCount, markActioned, dismiss };
}
