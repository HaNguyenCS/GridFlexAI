"""Market Clearing Agent — Section 13 sort / clear / stress_score."""

from __future__ import annotations

from copy import deepcopy

from backend.schemas.simulation import (
    Bid,
    ClearingResult,
    DispatchStatus,
    MarketClearRequest,
    MarketClearResponse,
    MarketContext,
)


def _sort_key(bid: Bid) -> tuple:
    comfort_rank = {"low": 0, "medium": 1, "high": 2, "none": 3}.get(
        bid.comfort_impact, 1
    )
    return (
        bid.price_per_mwh,
        bid.activation_minutes,
        -bid.confidence,
        comfort_rank,
    )


def compute_stress_score_after(
    stress_before: int,
    target_mw: int,
    accepted_mw: float,
) -> int:
    if target_mw <= 0:
        return stress_before
    fill_ratio = min(1.0, accepted_mw / target_mw)
    reduction = int(stress_before * fill_ratio * 0.45)
    return max(0, stress_before - reduction)


class MarketClearingAgent:
    agent_id = "agent_market_clearing"

    def clear(
        self,
        bids: list[Bid],
        market_context: MarketContext,
        *,
        event_id: str,
        timestamp: str,
    ) -> MarketClearResponse:
        target = market_context.target_reduction_mw
        stress_before = market_context.stress_score_before
        sorted_bids = sorted(bids, key=_sort_key)

        accepted: list[Bid] = []
        rejected: list[Bid] = []
        accumulated = 0.0
        clearing_price = 0.0

        for bid in sorted_bids:
            copy = deepcopy(bid)
            if target <= 0 or accumulated >= target:
                copy.status = DispatchStatus.rejected
                copy.reason = "Target already met or zero target"
                rejected.append(copy)
                continue

            remaining = target - accumulated
            qty = min(bid.quantity_mw, remaining)
            if qty <= 0:
                copy.status = DispatchStatus.rejected
                rejected.append(copy)
                continue

            copy.quantity_mw = round(qty, 2)
            copy.status = DispatchStatus.accepted
            accepted.append(copy)
            accumulated += qty
            clearing_price = bid.price_per_mwh

        stress_after = compute_stress_score_after(
            stress_before, target, accumulated
        )
        unfilled = max(0.0, target - accumulated)
        status = "cleared" if unfilled <= 0 else "partial"

        result = ClearingResult(
            target_reduction_mw=target,
            accepted_reduction_mw=round(accumulated, 2),
            unfilled_reduction_mw=round(unfilled, 2),
            stress_score_before=stress_before,
            stress_score_after=stress_after,
            clearing_status=status,
            clearing_price_per_mwh=round(clearing_price, 2),
        )

        return MarketClearResponse(
            event_id=event_id,
            clearing_result=result,
            accepted_bids=accepted,
            rejected_bids=rejected,
        )

    def clear_request(self, request: MarketClearRequest) -> MarketClearResponse:
        return self.clear(
            request.bids,
            request.market_context,
            event_id=request.event_id,
            timestamp=request.timestamp,
        )


market_clearing_agent = MarketClearingAgent()
