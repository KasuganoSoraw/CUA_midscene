from __future__ import annotations

import asyncio
import sys
import tempfile
from pathlib import Path

import pytest

from cua_agent.runtime_client import (
    JsonlRuntimeClient,
    RuntimeCancelledError,
    RuntimeMethodError,
    RuntimeProcessConfig,
    RuntimeProcessError,
    RuntimeProgressEvent,
    RuntimeProtocolError,
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


def test_runtime_config_accepts_host_javascript_executable_environment_and_cwd() -> None:
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        runtime = root / "GDEClaw.exe"
        bridge = root / "computer-use" / "dist" / "runtime-bridge" / "worker.js"
        bridge.parent.mkdir(parents=True)
        runtime.write_bytes(b"runtime")
        bridge.write_text("", encoding="utf-8")

        configured = RuntimeProcessConfig.from_runtime(
            runtime,
            bridge,
            cwd=str(bridge.parents[2]),
            env={"ELECTRON_RUN_AS_NODE": "1"},
        )

        assert configured.command == (str(runtime), str(bridge))
        assert configured.cwd == str(bridge.parents[2])
        assert configured.env == {"ELECTRON_RUN_AS_NODE": "1"}


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


def test_client_delivers_correlated_progress_before_terminal_response() -> None:
    async def scenario() -> None:
        events: list[RuntimeProgressEvent] = []
        async with JsonlRuntimeClient(config()) as client:
            result = await client.request("execute", {"action": "progress"}, on_event=events.append)
            assert result["method"] == "execute"
            assert len(events) == 1
            assert events[0].data == {
                "source": "midscene",
                "taskIndex": 0,
                "action": "Tap",
                "status": "running",
            }
            with pytest.raises(RuntimeMethodError, match="fake runtime failure"):
                await client.request(
                    "execute", {"action": "progress-error"}, on_event=events.append
                )
            assert len(events) == 2
            later = await client.request("catalog", {"action": "list-scenes"})
            assert later["method"] == "catalog"

    asyncio.run(scenario())


def test_client_rejects_mismatched_and_uncontrolled_progress() -> None:
    async def scenario(action: str) -> None:
        events: list[RuntimeProgressEvent] = []
        async with JsonlRuntimeClient(config()) as client:
            with pytest.raises(RuntimeProtocolError):
                await client.request("execute", {"action": action}, on_event=events.append)
            assert not events
            assert not client.running

    asyncio.run(scenario("progress-invalid"))
    asyncio.run(scenario("progress-leak"))


def test_client_preserves_total_timeout_and_cancellation_after_progress() -> None:
    async def timeout_scenario() -> None:
        events: list[RuntimeProgressEvent] = []
        async with JsonlRuntimeClient(
            config(request_timeout_seconds=1.0, shutdown_timeout_seconds=0.05)
        ) as client:
            with pytest.raises(RuntimeTimeoutError):
                await client.request(
                    "execute", {"action": "progress-delay"}, on_event=events.append
                )
            assert len(events) == 1
            assert not client.running

    async def cancelled_scenario() -> None:
        cancelled = False

        def on_event(_event: RuntimeProgressEvent) -> None:
            nonlocal cancelled
            cancelled = True

        async with JsonlRuntimeClient(config(shutdown_timeout_seconds=0.05)) as client:
            with pytest.raises(RuntimeCancelledError):
                await client.request(
                    "execute",
                    {"action": "progress-cancel"},
                    on_event=on_event,
                    cancelled=lambda: cancelled,
                )
            assert not client.running

    asyncio.run(timeout_scenario())
    asyncio.run(cancelled_scenario())


def test_client_closes_worker_when_progress_consumer_fails() -> None:
    async def scenario() -> None:
        def on_event(_event: RuntimeProgressEvent) -> None:
            raise ValueError("event consumer failed")

        async with JsonlRuntimeClient(config()) as client:
            with pytest.raises(ValueError, match="event consumer failed"):
                await client.request("execute", {"action": "progress"}, on_event=on_event)
            assert not client.running

    asyncio.run(scenario())
