"""
Replay IESO historical Ontario demand as Toronto ward-level load.

Foundation: ML/data/processed/historical_demand.csv
"""

from __future__ import annotations

import csv
import math
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

from backend.config import (
    HISTORICAL_DEMAND_CSV,
    HISTORICAL_SPIKE_THRESHOLD,
    ROLLING_BASELINE_HOURS,
    SIM_MINUTES_PER_TICK,
    TORONTO_BASE_DEMAND_MW,
)


@dataclass(frozen=True)
class HistoricalRow:
    timestamp: datetime
    ontario_mw: float


def ward_diurnal_shape(zone_id: str, hour: int) -> float:
    ward_index = int(zone_id.split("_")[1])
    phase = (ward_index % 25) * 0.28
    return 1.0 + 0.055 * math.sin(2 * math.pi * (hour - phase) / 24)


def load_historical_rows(path: Path = HISTORICAL_DEMAND_CSV) -> list[HistoricalRow]:
    if not path.exists():
        raise FileNotFoundError(
            f"Missing historical demand: {path}. "
            "Run ML/src/ingestion/fetch_historical_demand.py"
        )

    rows: list[HistoricalRow] = []
    with path.open(encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            ts = datetime.strptime(row["timestamp"], "%Y-%m-%d %H:%M:%S").replace(
                tzinfo=timezone.utc
            )
            rows.append(
                HistoricalRow(
                    timestamp=ts,
                    ontario_mw=float(row["ontario_demand_mw"]),
                )
            )
    rows.sort(key=lambda item: item.timestamp)
    return rows


def _rolling_median(values: list[float], window: int) -> list[float]:
    n = len(values)
    out: list[float] = []
    half = window // 2
    for index in range(n):
        start = max(0, index - half)
        end = min(n, index + half + 1)
        chunk = sorted(values[start:end])
        mid = len(chunk) // 2
        out.append(chunk[mid] if chunk else values[index])
    return out


@dataclass
class WardHistoricalSeries:
    zone_id: str
    hourly_demand: list[float]
    hourly_baseline: list[float]


class HistoricalDemandPlayer:
    """Walk through historical hourly data with sub-hour linear interpolation."""

    def __init__(
        self,
        profiles: list,
        *,
        historical_path: Path = HISTORICAL_DEMAND_CSV,
        start_hour_index: int = 0,
    ) -> None:
        self._rows = load_historical_rows(historical_path)
        self._timestamps = [row.timestamp for row in self._rows]
        ontario = [row.ontario_mw for row in self._rows]
        median_ontario = sorted(ontario)[len(ontario) // 2]
        self._toronto_scale = TORONTO_BASE_DEMAND_MW / max(median_ontario, 1.0)
        self._toronto_hourly = [value * self._toronto_scale for value in ontario]
        self._city_baseline = _rolling_median(self._toronto_hourly, ROLLING_BASELINE_HOURS)

        self._ward_series: dict[str, WardHistoricalSeries] = {}
        for profile in profiles:
            zone_id = profile.zone_id
            share = profile.load_share_pct / 100.0
            hourly = [
                self._toronto_hourly[index]
                * share
                * ward_diurnal_shape(zone_id, self._timestamps[index].hour)
                for index in range(len(self._rows))
            ]
            self._ward_series[zone_id] = WardHistoricalSeries(
                zone_id=zone_id,
                hourly_demand=hourly,
                hourly_baseline=_rolling_median(hourly, ROLLING_BASELINE_HOURS),
            )

        self.ticks_per_hour = max(1, 60 // SIM_MINUTES_PER_TICK)
        self._hour_index = start_hour_index % len(self._rows)
        self._sub_tick = 0
        self._sim_tick = 0
        self.historical_path = str(historical_path)
        self.historical_start = self._timestamps[0].isoformat()
        self.historical_end = self._timestamps[-1].isoformat()

    def _blend(self, current: float, nxt: float) -> float:
        fraction = self._sub_tick / self.ticks_per_hour
        return current + (nxt - current) * fraction

    def current_timestamp(self) -> datetime:
        base = self._timestamps[self._hour_index]
        return base + timedelta(minutes=self._sub_tick * SIM_MINUTES_PER_TICK)

    def ward_reading(self, zone_id: str) -> tuple[float, float, float]:
        """Return (demand_mw, baseline_mw, spike_multiplier)."""
        series = self._ward_series[zone_id]
        index = self._hour_index
        next_index = min(index + 1, len(series.hourly_demand) - 1)

        demand = self._blend(
            series.hourly_demand[index],
            series.hourly_demand[next_index],
        )
        baseline = self._blend(
            series.hourly_baseline[index],
            series.hourly_baseline[next_index],
        )
        multiplier = demand / baseline if baseline > 0 else 1.0
        return round(demand, 3), round(baseline, 3), round(multiplier, 4)

    def city_reading(self) -> tuple[float, float, float]:
        index = self._hour_index
        next_index = min(index + 1, len(self._toronto_hourly) - 1)
        demand = self._blend(self._toronto_hourly[index], self._toronto_hourly[next_index])
        baseline = self._blend(
            self._city_baseline[index],
            self._city_baseline[next_index],
        )
        multiplier = demand / baseline if baseline > 0 else 1.0
        return round(demand, 3), round(baseline, 3), round(multiplier, 4)

    def advance(self) -> None:
        self._sim_tick += 1
        self._sub_tick += 1
        if self._sub_tick >= self.ticks_per_hour:
            self._sub_tick = 0
            self._hour_index += 1
            if self._hour_index >= len(self._rows) - 1:
                self._hour_index = 0

    def sim_clock(self, *, tick_sec: float) -> dict:
        ts = self.current_timestamp()
        compression = (SIM_MINUTES_PER_TICK * 60.0) / max(tick_sec, 0.001)
        return {
            "sim_tick": self._sim_tick,
            "sim_day": ts.day,
            "sim_hour": ts.hour,
            "sim_minute": ts.minute,
            "sim_time": ts.strftime("%H:%M"),
            "historical_date": ts.strftime("%Y-%m-%d"),
            "historical_timestamp": ts.isoformat(),
            "sim_minutes_per_tick": SIM_MINUTES_PER_TICK,
            "tick_sec": tick_sec,
            "time_compression": round(compression),
            "demand_source": "historical_demand.csv",
            "playback_hour_index": self._hour_index,
        }

    def active_spike_events(self, zone_ids: list[str]) -> list[dict]:
        """Wards (and city) currently above the historical spike threshold."""
        events: list[dict] = []

        city_demand, _, city_mult = self.city_reading()
        if city_mult >= HISTORICAL_SPIKE_THRESHOLD:
            events.append(
                {
                    "scope": "city",
                    "zone_id": None,
                    "multiplier": city_mult,
                    "peak_multiplier": city_mult,
                    "phase": "hold",
                    "ticks_remaining": self.ticks_per_hour - self._sub_tick,
                    "spike_type": "historical",
                    "demand_mw": city_demand,
                }
            )

        for zone_id in zone_ids:
            demand, _, mult = self.ward_reading(zone_id)
            if mult >= HISTORICAL_SPIKE_THRESHOLD:
                events.append(
                    {
                        "scope": zone_id,
                        "zone_id": zone_id,
                        "multiplier": mult,
                        "peak_multiplier": mult,
                        "phase": "hold",
                        "ticks_remaining": self.ticks_per_hour - self._sub_tick,
                        "spike_type": "historical",
                        "demand_mw": demand,
                    }
                )

        return events
