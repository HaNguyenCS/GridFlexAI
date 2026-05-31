"""OpenAI-compatible client for NVIDIA NIM on local DGX Spark / ASUS."""

from __future__ import annotations

import json
import logging
from typing import Any

import httpx

from backend.config import NIM_API_KEY, NIM_BASE_URL, NIM_MODEL, NIM_TIMEOUT_SEC

logger = logging.getLogger(__name__)


class NIMClient:
    def __init__(
        self,
        *,
        base_url: str = NIM_BASE_URL,
        api_key: str = NIM_API_KEY,
        model: str = NIM_MODEL,
        timeout_sec: float = NIM_TIMEOUT_SEC,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.timeout_sec = timeout_sec

    async def chat_completion(
        self,
        messages: list[dict[str, str]],
        *,
        max_tokens: int = 512,
        temperature: float = 0.2,
    ) -> str:
        url = f"{self.base_url}/chat/completions"
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
        }
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
        }
        async with httpx.AsyncClient(timeout=self.timeout_sec) as client:
            response = await client.post(url, json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()
        return data["choices"][0]["message"]["content"]

    async def health_check(self) -> dict[str, Any]:
        """Best-effort NIM reachability check."""
        url = f"{self.base_url}/models"
        headers = {"Authorization": f"Bearer {self.api_key}"}
        try:
            async with httpx.AsyncClient(timeout=min(self.timeout_sec, 5.0)) as client:
                response = await client.get(url, headers=headers)
                response.raise_for_status()
                data = response.json()
            models = [m.get("id") for m in data.get("data", []) if isinstance(m, dict)]
            return {"status": "ok", "base_url": self.base_url, "models": models[:5]}
        except Exception as exc:
            return {"status": "error", "base_url": self.base_url, "detail": str(exc)}


def parse_json_object(text: str) -> dict[str, Any]:
    text = text.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        text = "\n".join(lines[1:-1] if lines[-1].startswith("```") else lines[1:])
    return json.loads(text)


nim_client = NIMClient()
