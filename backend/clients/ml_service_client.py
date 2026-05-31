"""HTTP client for the GridFlex ML service (ML/src/api.py)."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from backend.config import ML_SERVICE_TIMEOUT_SEC, ML_SERVICE_URL

logger = logging.getLogger(__name__)


class MLServiceClient:
    def __init__(
        self,
        *,
        base_url: str = ML_SERVICE_URL,
        timeout_sec: float = ML_SERVICE_TIMEOUT_SEC,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout_sec = timeout_sec

    async def health_check(self) -> dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=self.timeout_sec) as client:
                response = await client.get(f"{self.base_url}/health")
                response.raise_for_status()
                return {"status": "ok", "url": self.base_url, **response.json()}
        except Exception as exc:
            logger.warning("ML service health check failed: %s", exc)
            return {"status": "error", "url": self.base_url, "error": str(exc)}

    async def predict_grid(self, feature_row: dict[str, Any]) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=self.timeout_sec) as client:
            response = await client.post(
                f"{self.base_url}/grid/predict",
                json=feature_row,
            )
            response.raise_for_status()
            return response.json()

    async def predict_ward_stress(self, feature_row: dict[str, Any]) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=self.timeout_sec) as client:
            response = await client.post(
                f"{self.base_url}/grid/ward/predict",
                json=feature_row,
            )
            response.raise_for_status()
            return response.json()

    async def ward_market_payload(self, feature_row: dict[str, Any]) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=self.timeout_sec) as client:
            response = await client.post(
                f"{self.base_url}/agent/ward-market",
                json=feature_row,
            )
            response.raise_for_status()
            return response.json()

    async def rebalance_payload(self, feature_row: dict[str, Any]) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=self.timeout_sec) as client:
            response = await client.post(
                f"{self.base_url}/agent/rebalance",
                json=feature_row,
            )
            response.raise_for_status()
            return response.json()

    async def plan_intervention(
        self,
        *,
        target_reduction_mw: int,
        stress_score_before: int,
    ) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=self.timeout_sec) as client:
            response = await client.post(
                f"{self.base_url}/flex/intervention",
                json={
                    "target_reduction_mw": target_reduction_mw,
                    "stress_score_before": stress_score_before,
                },
            )
            response.raise_for_status()
            return response.json()


ml_service_client = MLServiceClient()
