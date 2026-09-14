from __future__ import annotations

import asyncio
import inspect
import io
import json
from collections.abc import AsyncIterator, Mapping

from cua_agent import (
    CuaAgent,
    InvocationStatus,
    ModelContentDelta,
    ModelResponse,
    ModelStreamComplete,
    ModelStreamItem,
    ModelToolCall,
)
from cua_agent.cli import invoke_from_stream
from cua_agent.contracts import JsonValue
from cua_agent.model import ModelMessage
from cua_agent.runtime_client import (
    CancellationCheck,
    RuntimeEventSink,
    RuntimeProgressEvent,
)


class FakeRuntimeClient:
    async def __aenter__(self) -> FakeRuntimeClient:
        return self

    async def __aexit__(self, *args: object) -> None:
        return None

    async def request(
        self,
        method: str,
        payload: Mapping[str, JsonValue],
        *,
        cancelled: CancellationCheck | None = None,
        on_event: RuntimeEventSink | None = None,
    ) -> dict[str, JsonValue]:
        if method == "execute" and on_event is not None:
            delivered = on_event(
                RuntimeProgressEvent(
                    "Tap - username field",
                    {
                        "source": "midscene", "taskIndex": 0, "taskId": "task-1",
                        "action": "Tap", "description": "username field", "status": "running",
                    },
                )
            )
            if inspect.isawaitable(delivered):
                await delivered
        return {"method": method}


class FinalModel:
    async def complete(self, messages: tuple[ModelMessage, ...], tools: object) -> ModelResponse:
        return ModelResponse(content="调试调用完成", final_status="completed")

    async def stream(
        self, messages: tuple[ModelMessage, ...], tools: object
    ) -> AsyncIterator[ModelStreamItem]:
        response = await self.complete(messages, tools)
        yield ModelContentDelta(response.content or "")
        yield ModelStreamComplete(response)


class ToolModel:
    def __init__(self) -> None:
        self.calls = 0

    async def complete(self, messages: tuple[ModelMessage, ...], tools: object) -> ModelResponse:
        self.calls += 1
        if self.calls == 1:
            return ModelResponse(
                tool_calls=(
                    ModelToolCall(
                        "call-1", "cua_execute", {"strategy": "freeform", "goal": "打开 Chrome"}
                    ),
                )
            )
        return ModelResponse(content="执行完成", final_status="completed")

    async def stream(
        self, messages: tuple[ModelMessage, ...], tools: object
    ) -> AsyncIterator[ModelStreamItem]:
        yield ModelStreamComplete(await self.complete(messages, tools))


def test_cli_streams_events_before_final_result() -> None:
    async def scenario() -> None:
        output = io.StringIO()
        agent = CuaAgent(FinalModel(), lambda: FakeRuntimeClient())  # type: ignore[arg-type]

        exit_code = await invoke_from_stream(
            io.StringIO('{"task":"打开 Chrome","invocationId":"inv-cli"}'),
            output,
            agent=agent,
        )

        frames = [json.loads(line) for line in output.getvalue().splitlines()]
        assert exit_code == 0
        assert frames[0]["type"] == "event"
        assert frames[-1]["type"] == "result"
        assert frames[-1]["result"]["status"] == InvocationStatus.COMPLETED.value
        assert frames[-1]["result"]["invocationId"] == "inv-cli"

    asyncio.run(scenario())


def test_cli_returns_protocol_error_frame_for_invalid_request() -> None:
    output = io.StringIO()

    exit_code = asyncio.run(invoke_from_stream(io.StringIO("{}"), output))

    frame = json.loads(output.getvalue())
    assert exit_code == 1
    assert frame["type"] == "error"
    assert frame["error"]["code"] == "AGENT_STARTUP_FAILED"


def test_cli_forwards_midscene_progress_before_tool_result() -> None:
    async def scenario() -> None:
        output = io.StringIO()
        agent = CuaAgent(ToolModel(), lambda: FakeRuntimeClient())  # type: ignore[arg-type]
        exit_code = await invoke_from_stream(
            io.StringIO('{"task":"打开 Chrome","invocationId":"inv-progress"}'),
            output,
            agent=agent,
        )
        frames = [json.loads(line) for line in output.getvalue().splitlines()]
        kinds = [frame["event"]["type"] for frame in frames if frame["type"] == "event"]
        assert exit_code == 0
        assert kinds.index("execution.progress") < kinds.index("tool.completed")
        assert frames[-1]["result"]["status"] == "completed"

    asyncio.run(scenario())


def test_cli_rejects_non_string_task() -> None:
    output = io.StringIO()

    exit_code = asyncio.run(invoke_from_stream(io.StringIO('{"task":{"goal":"x"}}'), output))

    frame = json.loads(output.getvalue())
    assert exit_code == 1
    assert "必须是字符串" in frame["error"]["message"]
