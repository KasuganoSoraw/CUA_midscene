from __future__ import annotations

import asyncio
from collections.abc import Mapping

from cua_agent import (
    AgentEvent,
    CuaAgent,
    InvocationRequest,
    InvocationStatus,
    ModelMessage,
    ModelResponse,
    ModelToolCall,
)
from cua_agent.contracts import JsonValue
from cua_agent.runtime_client import CancellationCheck, RuntimeMethodError


class FakeModelClient:
    def __init__(self, responses: list[ModelResponse]) -> None:
        self.responses = iter(responses)
        self.calls: list[tuple[ModelMessage, ...]] = []

    async def complete(self, messages: tuple[ModelMessage, ...], tools: object) -> ModelResponse:
        self.calls.append(messages)
        return next(self.responses)


class FakeRuntimeClient:
    def __init__(self, *, fail: bool = False) -> None:
        self.fail = fail
        self.calls: list[tuple[str, dict[str, JsonValue]]] = []
        self.closed = False

    async def __aenter__(self) -> FakeRuntimeClient:
        return self

    async def __aexit__(self, *args: object) -> None:
        self.closed = True

    async def request(
        self,
        method: str,
        payload: Mapping[str, JsonValue],
        *,
        cancelled: CancellationCheck | None = None,
    ) -> dict[str, JsonValue]:
        self.calls.append((method, dict(payload)))
        if self.fail:
            raise RuntimeMethodError("RUNTIME_METHOD_FAILED", "desktop unavailable")
        return {"method": method, "ok": True}


def test_runner_handles_multiple_tool_rounds_and_emits_domain_events() -> None:
    async def scenario() -> None:
        model = FakeModelClient(
            [
                ModelResponse(
                    tool_calls=(ModelToolCall("call-1", "cua_catalog", {"action": "list-scenes"}),)
                ),
                ModelResponse(
                    tool_calls=(
                        ModelToolCall(
                            "call-2",
                            "cua_execute",
                            {"strategy": "freeform", "goal": "打开 Chrome"},
                        ),
                    )
                ),
                ModelResponse(content="任务完成", final_status="completed"),
            ]
        )
        runtime = FakeRuntimeClient()
        events: list[AgentEvent] = []
        agent = CuaAgent(
            model,
            lambda: runtime,  # type: ignore[arg-type]
            create_invocation_id=lambda: "inv-1",
        )

        result = await agent.invoke(InvocationRequest("打开 Chrome"), event_sink=events.append)

        assert result.status is InvocationStatus.COMPLETED
        assert [trace.tool for trace in result.tool_calls] == ["cua_catalog", "cua_execute"]
        assert runtime.calls == [
            ("catalog", {"action": "list-scenes"}),
            ("execute", {"strategy": "freeform", "goal": "打开 Chrome"}),
        ]
        assert runtime.closed
        assert [event.type for event in events] == [
            "agent.started",
            "progress",
            "tool.started",
            "tool.completed",
            "progress",
            "tool.started",
            "execution.started",
            "tool.completed",
            "progress",
            "agent.completed",
        ]
        assert model.calls[0][1] == ModelMessage(role="user", content="打开 Chrome")
        assert model.calls[1][-1].role == "tool"

    asyncio.run(scenario())


def test_runner_does_not_share_messages_between_invocations() -> None:
    async def scenario() -> None:
        model = FakeModelClient(
            [
                ModelResponse(content="第一个完成", final_status="completed"),
                ModelResponse(content="第二个完成", final_status="completed"),
            ]
        )
        runtimes: list[FakeRuntimeClient] = []

        def runtime_factory() -> FakeRuntimeClient:
            runtime = FakeRuntimeClient()
            runtimes.append(runtime)
            return runtime

        agent = CuaAgent(model, runtime_factory)  # type: ignore[arg-type]
        await agent.invoke(InvocationRequest("任务一", invocation_id="inv-1"))
        await agent.invoke(InvocationRequest("任务二", invocation_id="inv-2"))

        assert len(model.calls[0]) == 2
        assert len(model.calls[1]) == 2
        assert model.calls[0][1].content == "任务一"
        assert model.calls[1][1].content == "任务二"
        assert len(runtimes) == 2
        assert all(runtime.closed for runtime in runtimes)

    asyncio.run(scenario())


def test_runner_stops_on_tool_failure_without_retrying_or_switching() -> None:
    async def scenario() -> None:
        model = FakeModelClient(
            [
                ModelResponse(
                    tool_calls=(
                        ModelToolCall(
                            "call-1",
                            "cua_execute",
                            {"strategy": "replay", "scene": "ems", "task": "query"},
                        ),
                    )
                ),
                ModelResponse(content="不应调用", final_status="completed"),
            ]
        )
        runtime = FakeRuntimeClient(fail=True)
        agent = CuaAgent(model, lambda: runtime)  # type: ignore[arg-type]

        result = await agent.invoke(InvocationRequest("查询告警", invocation_id="inv-failed"))

        assert result.status is InvocationStatus.FAILED
        assert result.error == "desktop unavailable"
        assert len(model.calls) == 1
        assert runtime.calls == [
            ("execute", {"strategy": "replay", "scene": "ems", "task": "query"})
        ]

    asyncio.run(scenario())


def test_runner_reports_needs_input_cancellation_and_turn_limit() -> None:
    async def scenario() -> None:
        needs_input_agent = CuaAgent(
            FakeModelClient([ModelResponse(content="请提供目标系统", final_status="needs-input")]),
            lambda: FakeRuntimeClient(),  # type: ignore[arg-type]
        )
        needs_input = await needs_input_agent.invoke(
            InvocationRequest("查询", invocation_id="needs-input")
        )
        assert needs_input.status is InvocationStatus.NEEDS_INPUT

        cancelled_agent = CuaAgent(
            FakeModelClient([ModelResponse(content="不应调用", final_status="completed")]),
            lambda: FakeRuntimeClient(),  # type: ignore[arg-type]
        )
        cancelled = await cancelled_agent.invoke(
            InvocationRequest("查询", invocation_id="cancelled"), cancelled=lambda: True
        )
        assert cancelled.status is InvocationStatus.CANCELLED

        repeated_call = ModelResponse(
            tool_calls=(ModelToolCall("call", "cua_catalog", {"action": "list-scenes"}),)
        )
        limited_agent = CuaAgent(
            FakeModelClient([repeated_call, repeated_call]),
            lambda: FakeRuntimeClient(),  # type: ignore[arg-type]
            max_turns=2,
        )
        limited = await limited_agent.invoke(InvocationRequest("查询", invocation_id="limited"))
        assert limited.status is InvocationStatus.FAILED
        assert "2 轮" in limited.reply

    asyncio.run(scenario())
