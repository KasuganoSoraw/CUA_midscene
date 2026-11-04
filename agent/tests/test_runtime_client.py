from __future__ import annotations

import asyncio
import sys
import tempfile
import time
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
        assert configured.request_timeout_seconds == 1800.0


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
                "taskId": "task-1",
                "action": "Tap",
                "description": "username field",
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
    asyncio.run(scenario("progress-bad-task-id"))
    asyncio.run(scenario("progress-long-description"))


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


@pytest.mark.parametrize("cancel_when", ["event", "read-completed"])
def test_client_cancels_and_exits_worker_during_continuous_progress(
    cancel_when: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def scenario() -> None:
        cancel_requested = False
        events: list[RuntimeProgressEvent] = []

        def on_event(event: RuntimeProgressEvent) -> None:
            nonlocal cancel_requested
            events.append(event)
            if cancel_when == "event" and len(events) == 10:
                cancel_requested = True

        async with JsonlRuntimeClient(
            config(request_timeout_seconds=30.0, shutdown_timeout_seconds=0.05)
        ) as client:
            process = client._process
            assert process is not None and process.stdout is not None
            if cancel_when == "read-completed":
                reader = process.stdout
                original_readline = reader.readline
                reads = 0

                async def readline() -> bytes:
                    nonlocal cancel_requested, reads
                    line = await original_readline()
                    reads += 1
                    if reads == 10:
                        cancel_requested = True
                    return line

                monkeypatch.setattr(reader, "readline", readline)

            with pytest.raises(RuntimeCancelledError):
                await asyncio.wait_for(
                    client.request(
                        "execute",
                        {"action": "progress-continuous"},
                        on_event=on_event,
                        cancelled=lambda: cancel_requested,
                    ),
                    timeout=2.0,
                )
            assert len(events) == (10 if cancel_when == "event" else 9)
            assert not client.running
            assert process.returncode is not None
            assert await process.wait() == process.returncode

    asyncio.run(scenario())


@pytest.mark.parametrize("strategy", ["freeform", "guided"])
def test_client_sends_native_cancel_and_exits_worker(
    strategy: str, tmp_path: Path
) -> None:
    async def scenario() -> None:
        marker = tmp_path / "stopped.txt"
        cancelled = False
        async with JsonlRuntimeClient(
            config(shutdown_timeout_seconds=5.0, cancel_grace_seconds=0.5)
        ) as client:
            process = client._process
            assert process is not None
            loop = asyncio.get_running_loop()
            loop.call_later(0.05, lambda: request_cancel())

            def request_cancel() -> None:
                nonlocal cancelled
                cancelled = True

            started = time.time()
            with pytest.raises(RuntimeCancelledError):
                await asyncio.wait_for(
                    client.request(
                        "execute",
                        {"action": "cancel-aware", "strategy": strategy, "stopMarker": str(marker)},
                        cancelled=lambda: cancelled,
                    ),
                    timeout=2.0,
                )
            assert marker.exists()
            assert started <= float(marker.read_text(encoding="utf-8")) <= time.time()
            assert process.returncode is not None
            assert await process.wait() == process.returncode
        async with JsonlRuntimeClient(config()) as later:
            response = await later.request("catalog", {"action": "list-scenes"})
            assert response["method"] == "catalog"

    asyncio.run(scenario())


@pytest.mark.parametrize("strategy", ["freeform", "guided", "replay"])
def test_client_cancel_fallback_exits_unresponsive_worker_quickly(strategy: str) -> None:
    async def scenario() -> None:
        requested_at: float | None = None

        def on_event(_event: RuntimeProgressEvent) -> None:
            nonlocal requested_at
            if requested_at is None:
                requested_at = time.perf_counter()

        async with JsonlRuntimeClient(
            config(request_timeout_seconds=30.0, shutdown_timeout_seconds=5.0,
                   cancel_grace_seconds=0.1)
        ) as client:
            process = client._process
            assert process is not None
            with pytest.raises(RuntimeCancelledError):
                await asyncio.wait_for(
                    client.request(
                        "execute", {"action": "progress-continuous", "strategy": strategy},
                        on_event=on_event, cancelled=lambda: requested_at is not None,
                    ),
                    timeout=2.0,
                )
            assert requested_at is not None
            assert time.perf_counter() - requested_at < 1.5
            assert process.returncode is not None

    asyncio.run(scenario())


def test_client_task_cancellation_uses_fast_worker_cleanup() -> None:
    async def scenario() -> None:
        async with JsonlRuntimeClient(
            config(request_timeout_seconds=30.0, shutdown_timeout_seconds=5.0,
                   cancel_grace_seconds=0.1)
        ) as client:
            process = client._process
            assert process is not None
            task = asyncio.create_task(client.request(
                "execute", {"action": "progress-continuous", "strategy": "replay"},
            ))
            await asyncio.sleep(0.1)
            started = time.perf_counter()
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await asyncio.wait_for(task, timeout=2.0)
            assert time.perf_counter() - started < 1.5
            assert process.returncode is not None

    asyncio.run(scenario())


def test_client_closes_worker_when_progress_consumer_fails() -> None:
    async def scenario() -> None:
        def on_event(_event: RuntimeProgressEvent) -> None:
            raise ValueError("event consumer failed")

        async with JsonlRuntimeClient(config()) as client:
            with pytest.raises(ValueError, match="event consumer failed"):
                await client.request("execute", {"action": "progress"}, on_event=on_event)
            assert not client.running

    asyncio.run(scenario())
