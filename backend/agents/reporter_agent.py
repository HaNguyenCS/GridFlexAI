"""Template-based Reporter / Alert Agent (no LLM for MVP)."""

from __future__ import annotations

from backend.schemas.simulation import (
    MarketClearResponse,
    OperatorAlert,
    ReporterOutput,
    SystemPredictionDetail,
)


class ReporterAgent:
    agent_id = "agent_reporter"

    def build_alert(
        self,
        system: SystemPredictionDetail,
        market: MarketClearResponse,
    ) -> ReporterOutput:
        clearing = market.clearing_result
        severity = system.risk_level.value
        title = f"Grid stress {system.risk_level.value.upper()} — {system.event_type.value.replace('_', ' ')}"

        summary = (
            f"System stress score {clearing.stress_score_before} → "
            f"{clearing.stress_score_after}. "
            f"Target reduction {clearing.target_reduction_mw} MW; "
            f"accepted {clearing.accepted_reduction_mw} MW "
            f"({clearing.clearing_status})."
        )

        if clearing.unfilled_reduction_mw > 0:
            market_action = (
                f"Partial clear — {clearing.unfilled_reduction_mw:.0f} MW unfilled. "
                "Consider manual dispatch or price adjustment."
            )
        elif clearing.target_reduction_mw > 0:
            market_action = (
                f"Cleared at ${clearing.clearing_price_per_mwh:.0f}/MWh "
                f"across {len(market.accepted_bids)} ward bids."
            )
        else:
            market_action = "No flex dispatch required — grid within normal bounds."

        impact = (
            f"Duration ~{system.predicted_duration_minutes} min. "
            f"Drivers: {', '.join(system.drivers[:3])}."
        )

        return ReporterOutput(
            alert=OperatorAlert(
                title=title,
                severity=severity,
                summary=summary,
                market_action=market_action,
                impact=impact,
                operator_note="GridFlex simulated flex-market dispatch (historical replay mode).",
            )
        )


reporter_agent = ReporterAgent()
