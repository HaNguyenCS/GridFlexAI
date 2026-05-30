"""
Inter-ward capacity trading.

Wards with spare capacity (owned > demand) can export MW to wards in deficit.
Trades raise the buyer's effective capacity and lower the seller's exportable headroom.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class ZoneCapacityLedger:
    zone_id: str
    owned_capacity_mw: float
    demand_mw: float

    @property
    def exportable_mw(self) -> float:
        return max(0.0, self.owned_capacity_mw - self.demand_mw)

    @property
    def import_need_mw(self) -> float:
        return max(0.0, self.demand_mw - self.owned_capacity_mw)


@dataclass(frozen=True)
class CapacityTrade:
    from_zone_id: str
    to_zone_id: str
    mw: float
    price_per_mw: float

    @property
    def total_cost(self) -> float:
        return round(self.mw * self.price_per_mw, 2)


@dataclass
class CapacityMarketResult:
    trades: list[CapacityTrade] = field(default_factory=list)
    effective_capacity_mw: dict[str, float] = field(default_factory=dict)
    imported_mw: dict[str, float] = field(default_factory=dict)
    exported_mw: dict[str, float] = field(default_factory=dict)
    total_traded_mw: float = 0.0
    total_trade_cost: float = 0.0


def match_capacity_trades(
    ledgers: list[ZoneCapacityLedger],
    *,
    transfer_price_per_mw: float = 120.0,
) -> CapacityMarketResult:
    """
    Greedy bilateral matching: largest deficits meet largest surpluses.
    """
    zone_ids = [ledger.zone_id for ledger in ledgers]
    effective = {ledger.zone_id: ledger.owned_capacity_mw for ledger in ledgers}
    imported = {zone_id: 0.0 for zone_id in zone_ids}
    exported = {zone_id: 0.0 for zone_id in zone_ids}

    sellers = sorted(
        [(ledger.zone_id, ledger.exportable_mw) for ledger in ledgers if ledger.exportable_mw > 0],
        key=lambda item: item[1],
        reverse=True,
    )
    buyers = sorted(
        [(ledger.zone_id, ledger.import_need_mw) for ledger in ledgers if ledger.import_need_mw > 0],
        key=lambda item: item[1],
        reverse=True,
    )

    seller_pool = {zone_id: spare for zone_id, spare in sellers}
    trades: list[CapacityTrade] = []

    for buyer_id, need in buyers:
        remaining = need
        for seller_id in list(seller_pool.keys()):
            spare = seller_pool[seller_id]
            if spare <= 0 or remaining <= 0:
                continue
            if seller_id == buyer_id:
                continue

            mw = min(remaining, spare)
            if mw <= 0:
                continue

            trades.append(
                CapacityTrade(
                    from_zone_id=seller_id,
                    to_zone_id=buyer_id,
                    mw=round(mw, 3),
                    price_per_mw=transfer_price_per_mw,
                )
            )
            seller_pool[seller_id] -= mw
            remaining -= mw
            effective[buyer_id] += mw
            effective[seller_id] -= mw
            imported[buyer_id] += mw
            exported[seller_id] += mw

    total_traded = sum(trade.mw for trade in trades)
    total_cost = sum(trade.total_cost for trade in trades)

    return CapacityMarketResult(
        trades=trades,
        effective_capacity_mw={zone_id: round(effective[zone_id], 3) for zone_id in zone_ids},
        imported_mw={zone_id: round(imported[zone_id], 3) for zone_id in zone_ids},
        exported_mw={zone_id: round(exported[zone_id], 3) for zone_id in zone_ids},
        total_traded_mw=round(total_traded, 3),
        total_trade_cost=round(total_cost, 2),
    )
