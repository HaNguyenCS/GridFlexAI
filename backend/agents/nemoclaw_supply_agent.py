"""Supply agent with NemoClaw / OpenClaw operator narrative."""

from __future__ import annotations

import logging

from backend.agents.nemoclaw_client import nemoclaw_client
from backend.agents.supply_agent import DefaultCapacityAgent, SupplyContext, SupplyDecision

logger = logging.getLogger(__name__)


class NemoClawSupplyAgent(DefaultCapacityAgent):
    name = "nemoclaw_supply_agent"

    def decide(self, context: SupplyContext) -> SupplyDecision:
        base = super().decide(context)
        if not nemoclaw_client.is_available():
            return SupplyDecision(
                trades=base.trades,
                market=base.market,
                grid_solution=base.grid_solution,
                agent=self.name,
                note=base.note,
            )
        try:
            note = self._nemoclaw_note(context, base)
            return SupplyDecision(
                trades=base.trades,
                market=base.market,
                grid_solution=base.grid_solution,
                agent=self.name,
                note=note,
            )
        except Exception:
            logger.exception("NemoClaw supply agent failed; using deterministic note")
            return SupplyDecision(
                trades=base.trades,
                market=base.market,
                grid_solution=base.grid_solution,
                agent=self.name,
                note=f"{base.note} (NemoClaw unavailable — deterministic fallback)",
            )

    def _nemoclaw_note(self, context: SupplyContext, base: SupplyDecision) -> str:
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
        note = nemoclaw_client.run_supply_note_turn_sync(payload)
        return note or base.note
