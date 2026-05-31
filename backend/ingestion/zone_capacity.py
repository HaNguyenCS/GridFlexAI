"""
Track per-zone over-capacity duration and escalate to warnings/issues.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ZoneCapacityState:
    zone_id: str
    demand_mw: float
    capacity_mw: float
    over_capacity_mw: float
    over_capacity_sec: float
    status: str  # ok | over_capacity | warning | issue
    message: str


def _status_message(status: str, zone_id: str, over_sec: float, over_mw: float) -> str:
    if status == "issue":
        return (
            f"{zone_id} exceeded capacity for {over_sec:.0f}s "
            f"({over_mw:.1f} MW over limit) — grid intervention required"
        )
    if status == "warning":
        return f"{zone_id} approaching sustained overload ({over_sec:.0f}s over capacity)"
    if status == "over_capacity":
        return f"{zone_id} is {over_mw:.1f} MW over capacity"
    return f"{zone_id} operating within capacity"


class ZoneCapacityTracker:
    def __init__(
        self,
        *,
        tick_sec: float,
        warning_sec: float,
        issue_sec: float,
    ) -> None:
        self.tick_sec = tick_sec
        self.warning_sec = warning_sec
        self.issue_sec = issue_sec
        self._over_sec: dict[str, float] = {}

    def update(self, zone_id: str, demand_mw: float, capacity_mw: float) -> ZoneCapacityState:
        over_mw = max(0.0, demand_mw - capacity_mw)

        if over_mw > 0:
            elapsed = self._over_sec.get(zone_id, 0.0) + self.tick_sec
        else:
            elapsed = 0.0

        self._over_sec[zone_id] = elapsed

        if elapsed >= self.issue_sec:
            status = "issue"
        elif elapsed >= self.warning_sec:
            status = "warning"
        elif over_mw > 0:
            status = "over_capacity"
        else:
            status = "ok"

        return ZoneCapacityState(
            zone_id=zone_id,
            demand_mw=round(demand_mw, 3),
            capacity_mw=round(capacity_mw, 3),
            over_capacity_mw=round(over_mw, 3),
            over_capacity_sec=round(elapsed, 1),
            status=status,
            message=_status_message(status, zone_id, elapsed, over_mw),
        )

    def active_issues(self, states: list[ZoneCapacityState]) -> list[ZoneCapacityState]:
        return [state for state in states if state.status in {"warning", "issue"}]
