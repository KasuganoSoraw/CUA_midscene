from __future__ import annotations

import asyncio
import io
import json
from collections.abc import Mapping

from cua_agent import CuaAgent, InvocationStatus, ModelResponse
from cua_agent.cli import invoke_from_stream
from cua_agent.contracts import JsonValue
from cua_agent.model import ModelMessage
from cua_agent.runtime_client import CancellationCheck


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
    ) -> dict[str, JsonValue]:
        return {"method": method}


class FinalModel:
    async def complete(self, messages: tuple[ModelMessage, ...], tools: object) -> ModelResponse:
        return ModelResponse(content="调试调用完成", final_status="completed")


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


def test_cli_rejects_non_string_task() -> None:
    output = io.StringIO()

    exit_code = asyncio.run(invoke_from_stream(io.StringIO('{"task":{"goal":"x"}}'), output))

    frame = json.loads(output.getvalue())
    assert exit_code == 1
    assert "必须是字符串" in frame["error"]["message"]
