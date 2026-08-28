from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest

from cua_agent.runtime_client import (
    JsonlRuntimeClient,
    RuntimeCancelledError,
    RuntimeMethodError,
    RuntimeProcessConfig,
    RuntimeProcessError,
    RuntimeTimeoutError,
)

FAKE_WORKER = Path(__file__).with_name("fake_runtime_worker.py")


def config(**overrides: object) -> RuntimeProcessConfig:
    values = {
        "command": (sys.executable, str(FAKE_WORKER)),
        "request_timeout_seconds": 1.0,
        "shutdown_timeout_seconds": 1.0,
        **overrides,
    }
    return RuntimeProcessConfig(**values)  # type: ignore[arg-type]


def test_client_reuses_worker_for_multiple_correlated_requests_and_closes() -> None:
    async def scenario() -> None:
        ids = iter(("request-1", "request-2"))
        client = JsonlRuntimeClient(config(), create_request_id=lambda: next(ids))
        async with client:
            first = await client.request("catalog", {"action": "list-scenes"})
            second = await client.request("workbench", {"mode": "recording"})
            assert client.running
        assert not client.running
        assert first == {
            "method": "catalog",
            "payload": {"action": "list-scenes"},
        }
        assert second == {
            "method": "workbench",
            "payload": {"mode": "recording"},
        }

    asyncio.run(scenario())


def test_client_preserves_runtime_error() -> None:
    async def scenario() -> None:
        async with JsonlRuntimeClient(config()) as client:
            with pytest.raises(RuntimeMethodError, match="fake runtime failure") as caught:
                await client.request("catalog", {"action": "error"})
            assert caught.value.code == "RUNTIME_METHOD_FAILED"
            assert caught.value.details == {"source": "fake"}

    asyncio.run(scenario())


def test_client_reports_worker_exit_with_stderr() -> None:
    async def scenario() -> None:
        async with JsonlRuntimeClient(config()) as client:
            with pytest.raises(RuntimeProcessError, match="exit code=7") as caught:
                await client.request("catalog", {"action": "crash"})
            assert "fake worker crashed" in str(caught.value)

    asyncio.run(scenario())


def test_client_times_out_and_honors_cancellation() -> None:
    async def timeout_scenario() -> None:
        async with JsonlRuntimeClient(
            config(request_timeout_seconds=0.05, shutdown_timeout_seconds=0.05)
        ) as client:
            with pytest.raises(RuntimeTimeoutError):
                await client.request("catalog", {"action": "delay"})

    async def cancelled_scenario() -> None:
        async with JsonlRuntimeClient(config()) as client:
            with pytest.raises(RuntimeCancelledError):
                await client.request("catalog", {"action": "list-scenes"}, cancelled=lambda: True)

    asyncio.run(timeout_scenario())
    asyncio.run(cancelled_scenario())
