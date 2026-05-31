"""Query ward_labeled_training.csv for spike patterns at runtime."""

from __future__ import annotations

import csv
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from backend.config import WARD_LABELED_TRAINING_CSV

REPO_ROOT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class WardSpikeScore:
    is_spike: bool
    spike_probability: float
    historical_spike_rate: float
    typical_duration_minutes: int
    sample_count: int
    match_type: str


def _ontario_bin(mw: float) -> int:
    return int(mw // 500) * 500


class WardSpikeLookup:
    def __init__(self, path: Path = WARD_LABELED_TRAINING_CSV) -> None:
        self.path = path
        self._exact: dict[tuple[str, str], dict] = {}
        self._hour_stats: dict[tuple[str, int], dict] = {}
        self._demand_stats: dict[tuple[str, int, int], dict] = {}
        self._loaded = False

    def _ensure_loaded(self) -> None:
        if self._loaded:
            return
        if not self.path.exists():
            self._loaded = True
            return

        hour_buckets: dict[tuple[str, int], list[int]] = {}
        demand_buckets: dict[tuple[str, int, int], list[int]] = {}

        with self.path.open(encoding="utf-8") as handle:
            reader = csv.DictReader(handle)
            for row in reader:
                zone_id = row["zone_id"]
                timestamp = row["timestamp"]
                hour = int(row["hour"])
                is_spike = int(row["is_spike"])
                ontario_bin = _ontario_bin(float(row["ontario_demand_mw"]))

                self._exact[(zone_id, timestamp)] = row
                hour_buckets.setdefault((zone_id, hour), []).append(is_spike)
                demand_buckets.setdefault((zone_id, hour, ontario_bin), []).append(
                    is_spike
                )

        for key, values in hour_buckets.items():
            self._hour_stats[key] = {
                "rate": sum(values) / len(values),
                "count": len(values),
            }

        for key, values in demand_buckets.items():
            self._demand_stats[key] = {
                "rate": sum(values) / len(values),
                "count": len(values),
            }

        self._loaded = True

    def score(
        self,
        ward_id: str,
        *,
        timestamp: str | None = None,
        hour: int,
        ontario_demand_mw: float,
        spike_multiplier: float,
    ) -> WardSpikeScore:
        self._ensure_loaded()

        if timestamp:
            exact = self._exact.get((ward_id, timestamp))
            if exact is not None:
                is_spike = int(exact["is_spike"]) == 1
                mult = float(exact["spike_multiplier"])
                prob = 0.92 if is_spike else max(0.05, 0.15 - mult * 0.05)
                return WardSpikeScore(
                    is_spike=is_spike,
                    spike_probability=prob,
                    historical_spike_rate=1.0 if is_spike else 0.0,
                    typical_duration_minutes=90 if is_spike else 60,
                    sample_count=1,
                    match_type="exact_timestamp",
                )

        ontario_bin = _ontario_bin(ontario_demand_mw)
        demand_key = (ward_id, hour, ontario_bin)
        hour_key = (ward_id, hour)

        if demand_key in self._demand_stats and self._demand_stats[demand_key]["count"] >= 5:
            stats = self._demand_stats[demand_key]
            match_type = "hour_demand_bin"
        elif hour_key in self._hour_stats:
            stats = self._hour_stats[hour_key]
            match_type = "hour_profile"
        else:
            stats = {"rate": 0.12, "count": 0}
            match_type = "default"

        rate = stats["rate"]
        live_signal = max(0.0, spike_multiplier - 1.0) * 2.0
        prob = min(0.98, max(0.05, rate * 0.65 + live_signal * 0.35))
        is_spike = prob >= 0.5 or spike_multiplier >= 1.035

        duration = 90 if rate >= 0.35 or spike_multiplier >= 1.05 else 60
        if spike_multiplier >= 1.08:
            duration = 120

        return WardSpikeScore(
            is_spike=is_spike,
            spike_probability=round(prob, 3),
            historical_spike_rate=round(rate, 3),
            typical_duration_minutes=duration,
            sample_count=stats["count"],
            match_type=match_type,
        )


@lru_cache(maxsize=1)
def get_ward_spike_lookup() -> WardSpikeLookup:
    return WardSpikeLookup()


ward_spike_lookup = get_ward_spike_lookup()
