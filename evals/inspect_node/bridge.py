"""Async client for The Node's evaluation bridge (src/eval/bridge.ts).

One bridge process per episode. The bridge runs the real TypeScript kernel and participant
pipeline; this client only sends text and reads JSON lines back. It holds no model and makes
no network request.
"""

from __future__ import annotations

import asyncio
import json
import subprocess
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
TSX_CLI = REPO_ROOT / "node_modules" / "tsx" / "dist" / "cli.mjs"
BRIDGE = REPO_ROOT / "src" / "eval" / "bridge.ts"


class BridgeError(RuntimeError):
    """The bridge or kernel failed. A simulation failure, never evidence about the agent."""


def source_revision() -> str:
    """The exact source the kernel ran from: commit SHA, marked '-dirty' if uncommitted."""
    try:
        sha = subprocess.run(["git", "rev-parse", "HEAD"], cwd=REPO_ROOT, capture_output=True, text=True, check=True).stdout.strip()
        dirty = subprocess.run(["git", "status", "--porcelain", "--", "src"], cwd=REPO_ROOT, capture_output=True, text=True, check=True).stdout.strip()
        return f"{sha}-dirty" if dirty else sha
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


class NodeBridge:
    def __init__(self) -> None:
        self._proc: asyncio.subprocess.Process | None = None

    async def __aenter__(self) -> "NodeBridge":
        if not TSX_CLI.exists():
            raise BridgeError(f"tsx not installed at {TSX_CLI}; run npm install")
        self._proc = await asyncio.create_subprocess_exec(
            "node", str(TSX_CLI), str(BRIDGE),
            cwd=str(REPO_ROOT),
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            limit=64 * 1024 * 1024,
        )
        return self

    async def __aexit__(self, *exc: object) -> None:
        proc = self._proc
        if proc is None:
            return
        if proc.stdin and not proc.stdin.is_closing():
            proc.stdin.close()
        try:
            await asyncio.wait_for(proc.wait(), timeout=10)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()

    async def request(self, payload: dict[str, Any]) -> dict[str, Any]:
        proc = self._proc
        if proc is None or proc.stdin is None or proc.stdout is None:
            raise BridgeError("bridge not started")
        proc.stdin.write((json.dumps(payload) + "\n").encode("utf-8"))
        await proc.stdin.drain()
        line = await asyncio.wait_for(proc.stdout.readline(), timeout=120)
        if not line:
            stderr = (await proc.stderr.read()).decode("utf-8", "replace") if proc.stderr else ""
            raise BridgeError(f"bridge exited: {stderr[-2000:]}")
        response = json.loads(line)
        if not response.get("ok"):
            raise BridgeError(str(response.get("error")))
        return response

    async def start(self, scenario: str, revision: str) -> dict[str, Any]:
        return (await self.request({"cmd": "start", "scenario": scenario, "sourceRevision": revision}))["prompt"]

    async def act(self, output: str) -> dict[str, Any]:
        return await self.request({"cmd": "act", "output": output})

    async def finish(self) -> dict[str, Any]:
        return (await self.request({"cmd": "finish"}))["record"]

    async def scenarios(self) -> list[dict[str, Any]]:
        return (await self.request({"cmd": "scenarios"}))["scenarios"]
