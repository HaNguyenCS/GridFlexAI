"""Supply agent with NVIDIA NIM operator narrative on DGX Spark."""

from __future__ import annotations

import json
import logging

import httpx

from backend.agents.supply_agent import DefaultCapacityAgent, SupplyContext, SupplyDecision
from backend.config import NIM_API_KEY, NIM_BASE_URL, NIM_MODEL, NIM_TIMEOUT_SEC

logger = logging.getLogger(__name__)

SUPPLY_SYSTEM = """detailed thinking off
You are the GridFlex Supply Agent for Toronto ward capacity markets.
Given zone demand/capacity snapshots and deterministic trade results, write JSON:
{"agent_note": "2-3 sentence operator summary", "priority_zones": ["ward_id", ...]}
JSON only, no markdown."""


class LLMSupplyAgent(DefaultCapacityAgent):
    name = "llm_supply_agent"

    def decide(self, context: SupplyContext) -> SupplyDecision:
        base = super().decide(context)
        try:
            note = self._llm_note(context, base)
            return SupplyDecision(
                trades=base.trades,
                market=base.market,
                grid_solution=base.grid_solution,
                agent=self.name,
                note=note,
            )
        except Exception:
            logger.exception("NIM supply agent failed; using deterministic note")
            return SupplyDecision(
                trades=base.trades,
                market=base.market,
                grid_solution=base.grid_solution,
                agent=self.name,
                note=f"{base.note} (NIM unavailable — deterministic fallback)",
            )

    def _llm_note(self, context: SupplyContext, base: SupplyDecision) -> str:
        payload = {
            "timestamp": context.ts,
            "budget": context.budget,
            "zones": [
                {
                    "zone_id": z.zone_id,
                    "ward_name": z.ward_name,
                    "demand_mw": z.demand_mw,
                    "owned_capacity_mw": z.owned_capacity_mw,
                    "status": z.status,
                }
                for z in context.zones
            ],
            "trades": [
                {
                    "from": t.from_zone_id,
                    "to": t.to_zone_id,
                    "mw": t.mw,
                    "cost": t.cost,
                }
                for t in base.trades
            ],
            "total_traded_mw": base.market.total_traded_mw if base.market else 0,
            "active_issues": context.active_issues,
        }
        url = f"{NIM_BASE_URL.rstrip('/')}/chat/completions"
        response = httpx.post(
            url,
            json={
                "model": NIM_MODEL,
                "messages": [
                    {"role": "system", "content": SUPPLY_SYSTEM},
                    {"role": "user", "content": json.dumps(payload)},
                ],
                "max_tokens": 256,
                "temperature": 0.2,
            },
            headers={
                "Authorization": f"Bearer {NIM_API_KEY}",
                "Content-Type": "application/json",
            },
            timeout=NIM_TIMEOUT_SEC,
        )
        response.raise_for_status()
        content = response.json()["choices"][0]["message"]["content"]
        if content.strip().startswith("```"):
            lines = content.strip().splitlines()
            content = "\n".join(lines[1:-1])
        parsed = json.loads(content)
        return str(parsed.get("agent_note", base.note))
