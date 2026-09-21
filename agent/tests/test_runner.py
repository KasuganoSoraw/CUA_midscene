from __future__ import annotations

import asyncio
import inspect
from collections.abc import AsyncIterator, Mapping

from cua_agent import (
    AgentEvent,
    CuaAgent,
    InvocationRequest,
    InvocationStatus,
    ModelContentDelta,
    ModelMessage,
    ModelResponse,
    ModelStreamComplete,
    ModelStreamItem,
    ModelToolCall,
)
from cua_agent.contracts import JsonValue
from cua_agent.runtime_client import (
    CancellationCheck,
    RuntimeEventSink,
    RuntimeMethodError,
    RuntimeProgressEvent,
)


class FakeModelClient:
    def __init__(self, responses: list[ModelResponse]) -> None:
        self.responses = iter(responses)
        self.calls: list[tuple[ModelMessage, ...]] = []
        self.tool_sets: list[object] = []

    async def complete(self, messages: tuple[ModelMessage, ...], tools: object) -> ModelResponse:
        self.calls.append(messages)
        self.tool_sets.append(tools)
        return next(self.responses)

    async def stream(
        self, messages: tuple[ModelMessage, ...], tools: object
    ) -> AsyncIterator[ModelStreamItem]:
        response = await self.complete(messages, tools)
        if response.content and not response.tool_calls:
            yield ModelContentDelta(response.content)
        yield ModelStreamComplete(response)


class FakeRuntimeClient:
    def __init__(self, *, fail: bool = False, progress: bool = False) -> None:
        self.fail = fail
        self.progress = progress
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
        on_event: RuntimeEventSink | None = None,
    ) -> dict[str, JsonValue]:
        self.calls.append((method, dict(payload)))
        if method == "execute" and self.progress and on_event is not None:
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
        if self.fail:
            raise RuntimeMethodError("RUNTIME_METHOD_FAILED", "desktop unavailable")
        if method == "execute":
            return {
                "status": "succeeded",
                "reportPath": "C:/runs/execution-report.html",
            }
        if method == "workbench":
            return {
                "url": "http://127.0.0.1:47831/?mode=recording",
                "mode": payload.get("mode", "recording"),
            }
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
            "agent.completed",
        ]
        started = [event for event in events if event.type == "tool.started"]
        completed = [event for event in events if event.type == "tool.completed"]
        assert started[0].data == {
            "callId": "call-1",
            "tool": "cua_catalog",
            "turn": 1,
            "arguments": {"action": "list-scenes"},
        }
        assert completed[0].data == {
            "callId": "call-1",
            "tool": "cua_catalog",
            "turn": 1,
            "status": "succeeded",
            "output": {"method": "catalog", "ok": True},
        }
        assert model.calls[0][1] == ModelMessage(role="user", content="打开 Chrome")
        assert model.calls[1][-1].role == "tool"
        assert model.tool_sets[2] == ()

    asyncio.run(scenario())


def test_terminal_execute_stops_remaining_calls_and_finalizes_without_tools() -> None:
    async def scenario() -> None:
        report_path = "C:/runs/execution-report.html"
        model = FakeModelClient(
            [
                ModelResponse(
                    tool_calls=(
                        ModelToolCall(
                            "execute-1",
                            "cua_execute",
                            {"strategy": "freeform", "goal": "发送消息"},
                        ),
                        ModelToolCall(
                            "workbench-1",
                            "cua_workbench",
                            {"mode": "execution"},
                        ),
                    )
                ),
                ModelResponse(
                    content=f"任务执行成功。执行报告：{report_path}",
                    final_status="completed",
                ),
            ]
        )
        runtime = FakeRuntimeClient()
        agent = CuaAgent(model, lambda: runtime)  # type: ignore[arg-type]

        result = await agent.invoke(InvocationRequest("发送消息", invocation_id="terminal"))

        assert result.status is InvocationStatus.COMPLETED
        assert result.reply == f"任务执行成功。执行报告：{report_path}"
        assert runtime.calls == [
            ("execute", {"strategy": "freeform", "goal": "发送消息"})
        ]
        assert [trace.tool for trace in result.tool_calls] == ["cua_execute"]
        assert len(model.calls) == 2
        assert model.tool_sets[1] == ()
        final_messages = model.calls[1]
        assert final_messages[0].role == "system"
        assert "不得再调用" in (final_messages[0].content or "")
        assert "只输出一个 JSON object" not in (final_messages[0].content or "")
        assert "不要输出 JSON" in (final_messages[0].content or "")
        assert sum(message.role == "system" for message in final_messages) == 1
        assert final_messages[-1].role == "tool"
        assert report_path in (final_messages[-1].content or "")

    asyncio.run(scenario())


def test_finalization_tool_call_never_reaches_runtime() -> None:
    async def scenario() -> None:
        model = FakeModelClient(
            [
                ModelResponse(
                    tool_calls=(
                        ModelToolCall(
                            "execute-1",
                            "cua_execute",
                            {"strategy": "freeform", "goal": "发送消息"},
                        ),
                    )
                ),
                ModelResponse(
                    tool_calls=(
                        ModelToolCall(
                            "execute-2",
                            "cua_execute",
                            {"strategy": "freeform", "goal": "确认消息已发送"},
                        ),
                    )
                ),
            ]
        )
        runtime = FakeRuntimeClient()
        agent = CuaAgent(model, lambda: runtime)  # type: ignore[arg-type]

        result = await agent.invoke(InvocationRequest("发送消息", invocation_id="no-repeat"))

        assert result.status is InvocationStatus.FAILED
        assert "不得包含 Tool call" in (result.error or "")
        assert runtime.calls == [
            ("execute", {"strategy": "freeform", "goal": "发送消息"})
        ]
        assert model.tool_sets[1] == ()

    asyncio.run(scenario())


def test_terminal_finalization_rejects_json_envelope_without_exposing_it() -> None:
    async def scenario() -> None:
        raw = 'Task completed {"status":"completed","reply":"Done"}'
        model = FakeModelClient(
            [
                ModelResponse(
                    tool_calls=(
                        ModelToolCall(
                            "execute-1",
                            "cua_execute",
                            {"strategy": "freeform", "goal": "Open Chrome"},
                        ),
                    )
                ),
                ModelResponse(content=raw),
            ]
        )
        events: list[AgentEvent] = []
        agent = CuaAgent(model, lambda: FakeRuntimeClient())  # type: ignore[arg-type]

        result = await agent.invoke(
            InvocationRequest("Open Chrome", invocation_id="plain-json"),
            event_sink=events.append,
        )

        assert result.status is InvocationStatus.FAILED
        assert "JSON envelope" in (result.error or "")
        assert not any(event.type == "agent.completed" for event in events)
        assert all(raw not in (event.message or "") for event in events)

    asyncio.run(scenario())


def test_workbench_success_is_terminal_and_final_reply_keeps_url() -> None:
    async def scenario() -> None:
        url = "http://127.0.0.1:47831/?mode=recording"
        model = FakeModelClient(
            [
                ModelResponse(
                    tool_calls=(
                        ModelToolCall(
                            "workbench-1",
                            "cua_workbench",
                            {"mode": "recording"},
                        ),
                        ModelToolCall(
                            "execute-1",
                            "cua_execute",
                            {"strategy": "freeform", "goal": "打开页面"},
                        ),
                    )
                ),
                ModelResponse(
                    content=f"录制 Workbench 已启动：{url}",
                    final_status="completed",
                ),
            ]
        )
        runtime = FakeRuntimeClient()
        agent = CuaAgent(model, lambda: runtime)  # type: ignore[arg-type]

        result = await agent.invoke(InvocationRequest("打开录制入口", invocation_id="workbench"))

        assert result.status is InvocationStatus.COMPLETED
        assert url in result.reply
        assert runtime.calls == [("workbench", {"mode": "recording"})]
        assert model.tool_sets[1] == ()

    asyncio.run(scenario())


def test_runner_correlates_midscene_progress_before_tool_completion() -> None:
    async def scenario() -> None:
        model = FakeModelClient(
            [
                ModelResponse(
                    tool_calls=(
                        ModelToolCall(
                            "execute-1",
                            "cua_execute",
                            {"strategy": "freeform", "goal": "打开 Chrome"},
                        ),
                    )
                ),
                ModelResponse(content="完成", final_status="completed"),
            ]
        )
        events: list[AgentEvent] = []
        agent = CuaAgent(model, lambda: FakeRuntimeClient(progress=True))  # type: ignore[arg-type]
        result = await agent.invoke(
            InvocationRequest("打开 Chrome", invocation_id="inv-progress"), event_sink=events.append
        )
        kinds = [event.type for event in events]
        assert result.status is InvocationStatus.COMPLETED
        assert kinds.index("execution.started") < kinds.index("execution.progress")
        assert kinds.index("execution.progress") < kinds.index("tool.completed")
        progress = next(event for event in events if event.type == "execution.progress")
        assert progress.invocation_id == "inv-progress"
        assert progress.data == {
            "callId": "execute-1",
            "tool": "cua_execute",
            "turn": 1,
            "source": "midscene",
            "taskIndex": 0,
            "taskId": "task-1",
            "action": "Tap",
            "description": "username field",
            "status": "running",
        }

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
        events: list[AgentEvent] = []
        agent = CuaAgent(model, lambda: runtime)  # type: ignore[arg-type]

        result = await agent.invoke(
            InvocationRequest("查询告警", invocation_id="inv-failed"), event_sink=events.append
        )

        assert result.status is InvocationStatus.FAILED
        assert result.error == "desktop unavailable"
        assert len(model.calls) == 1
        assert runtime.calls == [
            ("execute", {"strategy": "replay", "scene": "ems", "task": "query"})
        ]
        assert next(event for event in events if event.type == "tool.completed").data == {
            "callId": "call-1",
            "tool": "cua_execute",
            "turn": 1,
            "status": "failed",
            "error": "desktop unavailable",
        }

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


def test_runner_buffers_structured_final_response_and_hides_protocol_json() -> None:
    class StreamingModel:
        def __init__(self) -> None:
            self.release = asyncio.Event()

        async def stream(
            self, messages: tuple[ModelMessage, ...], tools: object
        ) -> AsyncIterator[ModelStreamItem]:
            yield ModelContentDelta('{"status":"completed",')
            await self.release.wait()
            yield ModelContentDelta('"reply":"查询完成"}')
            yield ModelStreamComplete(
                ModelResponse(content='{"status":"completed","reply":"查询完成"}')
            )

    async def scenario() -> None:
        model = StreamingModel()
        events: list[AgentEvent] = []
        agent = CuaAgent(model, lambda: FakeRuntimeClient())  # type: ignore[arg-type]
        invocation = asyncio.create_task(
            agent.invoke(
                InvocationRequest("查询", invocation_id="stream"), event_sink=events.append
            )
        )
        await asyncio.sleep(0.01)
        assert not invocation.done()
        assert not any(event.type.startswith("assistant.") for event in events)
        model.release.set()
        assert (await invocation).reply == "查询完成"
        assert not any(event.type.startswith("assistant.") for event in events)
        assert events[-1].type == "agent.completed"

        class ProtocolModel:
            async def stream(
                self, messages: tuple[ModelMessage, ...], tools: object
            ) -> AsyncIterator[ModelStreamItem]:
                yield ModelContentDelta("  ")
                yield ModelContentDelta('{"status":"needs-input",')
                yield ModelContentDelta('"reply":"需要目标"}')
                yield ModelStreamComplete(
                    ModelResponse(content="需要目标", final_status="needs-input")
                )

        protocol_events: list[AgentEvent] = []
        protocol = CuaAgent(ProtocolModel(), lambda: FakeRuntimeClient())  # type: ignore[arg-type]
        result = await protocol.invoke(
            InvocationRequest("查询", invocation_id="protocol"), event_sink=protocol_events.append
        )
        assert result.status is InvocationStatus.NEEDS_INPUT
        assert not any(event.type.startswith("assistant.") for event in protocol_events)
        assert protocol_events[-1].data == {"turn": 1, "reply": "需要目标"}

    asyncio.run(scenario())


def test_runner_rejects_mixed_text_and_structured_json_without_leaking_it() -> None:
    async def scenario() -> None:
        raw = '任务完成 {"status":"completed","reply":"完成"}'
        events: list[AgentEvent] = []
        agent = CuaAgent(
            FakeModelClient([ModelResponse(content=raw)]),
            lambda: FakeRuntimeClient(),  # type: ignore[arg-type]
        )

        result = await agent.invoke(
            InvocationRequest("查询", invocation_id="invalid-protocol"),
            event_sink=events.append,
        )

        assert result.status is InvocationStatus.FAILED
        assert "单个 JSON object" in (result.error or "")
        assert not any(event.type.startswith("assistant.") for event in events)
        assert all(raw not in (event.message or "") for event in events)

    asyncio.run(scenario())


def test_runner_emits_tool_call_explanation_after_response_is_complete() -> None:
    async def scenario() -> None:
        events: list[AgentEvent] = []
        model = FakeModelClient(
            [
                ModelResponse(
                    content="I will inspect the available recorded tasks.",
                    tool_calls=(
                        ModelToolCall("catalog-1", "cua_catalog", {"action": "list-scenes"}),
                    ),
                ),
                ModelResponse(content="Done", final_status="completed"),
            ]
        )
        agent = CuaAgent(model, lambda: FakeRuntimeClient())  # type: ignore[arg-type]

        result = await agent.invoke(
            InvocationRequest("List available tasks", invocation_id="tool-explanation"),
            event_sink=events.append,
        )

        assert result.status is InvocationStatus.COMPLETED
        assert [event.type for event in events if event.type.startswith("assistant.")] == [
            "assistant.started",
            "assistant.delta",
            "assistant.completed",
        ]
        delta = next(event for event in events if event.type == "assistant.delta")
        assert delta.data == {
            "turn": 1,
            "text": "I will inspect the available recorded tasks.",
        }

    asyncio.run(scenario())


def test_runner_cancels_while_model_stream_is_idle() -> None:
    class IdleModel:
        async def stream(
            self, messages: tuple[ModelMessage, ...], tools: object
        ) -> AsyncIterator[ModelStreamItem]:
            await asyncio.Event().wait()
            yield ModelContentDelta("不应发送")

    async def scenario() -> None:
        cancel = False
        events: list[AgentEvent] = []
        agent = CuaAgent(IdleModel(), lambda: FakeRuntimeClient())  # type: ignore[arg-type]
        invocation = asyncio.create_task(
            agent.invoke(
                InvocationRequest("查询", invocation_id="idle"),
                event_sink=events.append,
                cancelled=lambda: cancel,
            )
        )
        await asyncio.sleep(0.01)
        cancel = True
        result = await asyncio.wait_for(invocation, timeout=1)
        assert result.status is InvocationStatus.CANCELLED
        assert events[-1].type == "cancelled"

    asyncio.run(scenario())
