"""OpenClaw / NemoClaw client for GridFlex simulation ticks."""

from __future__ import annotations

import asyncio
import json
import logging
import shutil
import subprocess
import uuid
from typing import Any

import httpx

from backend.agents.nim_client import parse_json_object
from backend.config import (
    NEMOCLAW_AGENT_ID,
    NEMOCLAW_GATEWAY_TOKEN,
    NEMOCLAW_GATEWAY_URL,
    NEMOCLAW_OPENCLAW_BIN,
    NEMOCLAW_SESSION_ID,
    NEMOCLAW_TIMEOUT_SEC,
)

logger = logging.getLogger(__name__)

TICK_USER_PREFIX = (
    "Run one GridFlex simulation tick using the gridflex-controller skill. "
    "Return JSON only matching the skill schema. Input payload:\n"
)


class NemoClawClient:
    def __init__(
        self,
        *,
        openclaw_bin: str = NEMOCLAW_OPENCLAW_BIN,
        agent_id: str = NEMOCLAW_AGENT_ID,
        session_id: str = NEMOCLAW_SESSION_ID,
        timeout_sec: float = NEMOCLAW_TIMEOUT_SEC,
        gateway_url: str = NEMOCLAW_GATEWAY_URL,
        gateway_token: str = NEMOCLAW_GATEWAY_TOKEN,
    ) -> None:
        self.openclaw_bin = openclaw_bin
        self.agent_id = agent_id
        self.session_id = session_id
        self.timeout_sec = timeout_sec
        self.gateway_url = gateway_url.rstrip("/")
        self.gateway_token = gateway_token

    def is_available(self) -> bool:
        return shutil.which(self.openclaw_bin) is not None

    def _ensure_openclaw(self) -> None:
        if not self.is_available():
            raise RuntimeError(
                f"{self.openclaw_bin!r} not found on PATH — install NemoClaw "
                f"(curl -fsSL https://nvidia.com/nemoclaw.sh | bash) or set AGENT_MODE=deterministic"
            )

    async def run_tick_turn(self, payload: dict[str, Any]) -> dict[str, Any]:
        message = TICK_USER_PREFIX + json.dumps(payload)
        raw = await self._invoke_agent(message)
        return parse_json_object(raw)

    async def run_supply_note_turn(self, payload: dict[str, Any]) -> str:
        message = (
            "You are the GridFlex Supply Agent. Given zone demand/capacity and trade "
            "results, return JSON only: "
            '{"agent_note": "2-3 sentence operator summary", "priority_zones": ["ward_id"]}. '
            f"Input:\n{json.dumps(payload)}"
        )
        raw = await self._invoke_agent(message, max_tokens_hint=256)
        parsed = parse_json_object(raw)
        return str(parsed.get("agent_note", ""))

    def run_supply_note_turn_sync(self, payload: dict[str, Any]) -> str:
        message = (
            "You are the GridFlex Supply Agent. Given zone demand/capacity and trade "
            "results, return JSON only: "
            '{"agent_note": "2-3 sentence operator summary", "priority_zones": ["ward_id"]}. '
            f"Input:\n{json.dumps(payload)}"
        )
        raw = self._invoke_agent_sync(message)
        parsed = parse_json_object(raw)
        return str(parsed.get("agent_note", ""))

    async def _invoke_agent(self, message: str, *, max_tokens_hint: int = 4096) -> str:
        del max_tokens_hint
        return await asyncio.to_thread(self._invoke_agent_sync, message)

    def _invoke_agent_sync(self, message: str) -> str:
        self._ensure_openclaw()
        session = f"{self.session_id}-{uuid.uuid4().hex[:8]}"
        cmd = [
            self.openclaw_bin,
            "agent",
            "--agent",
            self.agent_id,
            "--local",
            "--json",
            "-m",
            message,
            "--session-id",
            session,
            "--timeout",
            str(int(self.timeout_sec)),
        ]
        logger.debug("NemoClaw invoke: %s", " ".join(cmd[:6]))
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=self.timeout_sec + 10,
            check=False,
        )
        if proc.returncode != 0:
            err = (proc.stderr or "").strip()
            raise RuntimeError(
                f"openclaw agent failed (exit {proc.returncode}): {err or 'no stderr'}"
            )
        return self._extract_reply_text(proc.stdout or "")

    def _extract_reply_text(self, stdout: str) -> str:
        stdout = stdout.strip()
        if not stdout:
            raise ValueError("openclaw agent returned empty stdout")

        try:
            data = json.loads(stdout)
        except json.JSONDecodeError:
            return stdout

        if isinstance(data, str):
            return data

        for key in ("reply", "text", "content", "message", "output"):
            val = data.get(key)
            if isinstance(val, str) and val.strip():
                return val

        choices = data.get("choices")
        if isinstance(choices, list) and choices:
            first = choices[0]
            if isinstance(first, dict):
                msg = first.get("message") or first.get("delta")
                if isinstance(msg, dict):
                    content = msg.get("content")
                    if isinstance(content, str):
                        return content

        result = data.get("result")
        if isinstance(result, dict):
            for key in ("reply", "text", "content"):
                val = result.get(key)
                if isinstance(val, str) and val.strip():
                    return val

        raise ValueError(f"Could not extract agent reply from JSON: {stdout[:500]}")

    async def health_check(self) -> dict[str, Any]:
        cli_path = shutil.which(self.openclaw_bin)
        result: dict[str, Any] = {
            "openclaw_bin": self.openclaw_bin,
            "openclaw_found": cli_path is not None,
            "agent_id": self.agent_id,
            "session_id": self.session_id,
            "gateway_url": self.gateway_url,
        }

        if not cli_path:
            result["status"] = "error"
            result["detail"] = f"{self.openclaw_bin} not found on PATH"
            return result

        headers: dict[str, str] = {}
        if self.gateway_token:
            headers["Authorization"] = f"Bearer {self.gateway_token}"

        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(f"{self.gateway_url}/health", headers=headers)
                if response.status_code < 500:
                    result["gateway"] = {
                        "status": "ok" if response.status_code < 400 else "degraded",
                        "http_status": response.status_code,
                    }
                else:
                    result["gateway"] = {"status": "error", "http_status": response.status_code}
        except Exception as exc:
            result["gateway"] = {"status": "unreachable", "detail": str(exc)}

        result["status"] = "ok" if cli_path else "error"
        return result


nemoclaw_client = NemoClawClient()
