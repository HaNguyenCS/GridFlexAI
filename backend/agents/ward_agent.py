"""Deterministic ward agents — Section 12 bid logic (no LLM)."""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta, timezone

from backend.schemas.simulation import (
    Bid,
    BidType,
    DispatchStatus,
    EventType,
    MarketContext,
    RecommendedAction,
    RiskLevel,
    WardAgentDecision,
    WardBidsRequest,
    WardBidsResponse,
    WardPrediction,
)

PRICE_BY_RISK = {
    RiskLevel.normal: 45.0,
    RiskLevel.medium: 75.0,
    RiskLevel.high: 110.0,
    RiskLevel.critical: 145.0,
}

ACTIVATION_BY_EVENT = {
    EventType.demand_spike: 5,
    EventType.outage_risk: 10,
    EventType.surplus: 15,
    EventType.normal: 20,
}

COMFORT_BY_ACTION = {
    RecommendedAction.reduce_load: "medium",
    RecommendedAction.shift_load: "low",
    RecommendedAction.increase_load_or_charge_storage: "low",
    RecommendedAction.none: "none",
}


def _bid_type_for(action: RecommendedAction, event_type: EventType) -> BidType:
    if action == RecommendedAction.reduce_load:
        return BidType.demand_reduction
    if action == RecommendedAction.shift_load:
        return BidType.load_shift
    if action == RecommendedAction.increase_load_or_charge_storage:
        if event_type == EventType.surplus:
            return BidType.storage_charge
        return BidType.flexible_load_increase
    return BidType.demand_reduction


class WardAgent:
    def __init__(self, ward_id: str) -> None:
        self.agent_id = f"agent_{ward_id}"
        self.ward_id = ward_id

    def decide_bid(
        self,
        prediction: WardPrediction,
        market_context: MarketContext,
        timestamp: str,
    ) -> WardAgentDecision:
        if prediction.recommended_action == RecommendedAction.none:
            return WardAgentDecision(
                agent_id=self.agent_id,
                ward_id=self.ward_id,
                decision="no_bid",
                bid=None,
            )

        quantity = min(prediction.recommended_bid_mw, prediction.max_bid_mw)
        if quantity <= 0:
            return WardAgentDecision(
                agent_id=self.agent_id,
                ward_id=self.ward_id,
                decision="no_bid",
                bid=None,
            )

        price = PRICE_BY_RISK.get(prediction.risk_level, 75.0)
        if market_context.system_risk_level == RiskLevel.critical:
            price *= 0.92
        elif market_context.system_risk_level == RiskLevel.high:
            price *= 0.96

        activation = ACTIVATION_BY_EVENT.get(prediction.event_type, 10)
        duration = prediction.predicted_duration_minutes
        start = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        if start.tzinfo is None:
            start = start.replace(tzinfo=timezone.utc)
        end = start + timedelta(minutes=duration)

        bid = Bid(
            bid_id=f"bid_{self.ward_id}_{uuid.uuid4().hex[:8]}",
            agent_id=self.agent_id,
            ward_id=self.ward_id,
            bid_type=_bid_type_for(
                prediction.recommended_action, prediction.event_type
            ),
            quantity_mw=round(quantity, 2),
            max_quantity_mw=prediction.max_bid_mw,
            price_per_mwh=round(price, 2),
            available_start_time=start.isoformat(),
            available_end_time=end.isoformat(),
            duration_minutes=duration,
            activation_minutes=activation,
            confidence=prediction.confidence,
            comfort_impact=COMFORT_BY_ACTION.get(
                prediction.recommended_action, "medium"
            ),
            status=DispatchStatus.submitted,
            reason=f"{prediction.event_type.value} / {prediction.risk_level.value}",
        )
        return WardAgentDecision(
            agent_id=self.agent_id,
            ward_id=self.ward_id,
            decision="submit_bid",
            bid=bid,
        )

    async def decide_bid_async(
        self,
        prediction: WardPrediction,
        market_context: MarketContext,
        timestamp: str,
    ) -> WardAgentDecision:
        await asyncio.sleep(0)
        return self.decide_bid(prediction, market_context, timestamp)


def build_ward_agents(ward_ids: list[str]) -> list[WardAgent]:
    return [WardAgent(ward_id) for ward_id in ward_ids]


async def collect_ward_bids(request: WardBidsRequest) -> WardBidsResponse:
    agents = build_ward_agents([p.ward_id for p in request.ward_predictions])
    prediction_by_ward = {p.ward_id: p for p in request.ward_predictions}

    decisions = await asyncio.gather(
        *[
            agent.decide_bid_async(
                prediction_by_ward[agent.ward_id],
                request.market_context,
                request.timestamp,
            )
            for agent in agents
            if agent.ward_id in prediction_by_ward
        ]
    )

    bids = [d.bid for d in decisions if d.bid is not None]
    return WardBidsResponse(event_id=request.market_context.event_id, bids=bids)
