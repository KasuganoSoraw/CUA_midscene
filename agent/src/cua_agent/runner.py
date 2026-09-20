"""一次调用内无状态、可测试的 CUA Agent Tool Calling loop。"""

from __future__ import annotations

import asyncio
import inspect
import json
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping
from typing import TypeAlias
from uuid import uuid4

from .contracts import (
    InvocationRequest,
    InvocationResult,
    InvocationStatus,
    ToolTrace,
)
from .definition import CUA_AGENT_DEFINITION
from .events import AgentEvent, AgentEventType
from .model import (
    ModelClient,
    ModelContentDelta,
    ModelMessage,
    ModelResponse,
    ModelStreamComplete,
    ModelToolCall,
)
from .runtime_client import (
    CancellationCheck,
    ManagedRuntimeClientProtocol,
    RuntimeCancelledError,
    RuntimeEventSink,
    RuntimeProgressEvent,
)
from .tools import CuaToolRegistry, ToolDefinition, create_cua_tool_registry

EventSinkResult: TypeAlias = Awaitable[None] | None
EventSink: TypeAlias = Callable[[AgentEvent], EventSinkResult]
RuntimeClientFactory: TypeAlias = Callable[[], ManagedRuntimeClientProtocol]

FINAL_RESPONSE_PROTOCOL = """
## 最终响应协议

当你不再调用 Tool 时，只输出一个 JSON object，不要添加 Markdown code fence：
{"status":"completed","reply":"面向调用方的任务结果"}
或
{"status":"needs-input","reply":"缺少的信息及原因"}
""".strip()

FINALIZATION_PROTOCOL = """
## 成功终态回复

最近一次终态 Tool 已成功完成本次任务。不得再调用、建议调用或模拟调用任何 Tool。
不得通过新的 GUI 操作确认或验证结果。
只根据已有任务、Tool Result 和以下规则输出最终 JSON 响应：
- `cua_execute`：明确说明任务执行成功；Tool Result 包含 `reportPath` 时必须原样返回该路径。
- `cua_workbench`：必须原样返回 Tool Result 中的 `url`，
  并说明它用于录制、复核或已录制任务回放中的哪一种用途。
- `status` 必须为 `completed`。
""".strip()


class CuaAgent:
    """供 Host Adapter 或 Review 调试入口调用的高层无状态 Agent。"""

    def __init__(
        self,
        model_client: ModelClient,
        runtime_client_factory: RuntimeClientFactory,
        *,
        data_root: str | None = None,
        max_turns: int = 8,
        create_invocation_id: Callable[[], str] | None = None,
    ) -> None:
        if max_turns <= 0:
            raise ValueError("max_turns 必须大于 0")
        self._model_client = model_client
        self._runtime_client_factory = runtime_client_factory
        self._data_root = data_root
        self._max_turns = max_turns
        self._create_invocation_id = create_invocation_id or (lambda: str(uuid4()))

    async def invoke(
        self,
        request: InvocationRequest,
        *,
        event_sink: EventSink | None = None,
        cancelled: CancellationCheck | None = None,
    ) -> InvocationResult:
        invocation_id = request.invocation_id or self._create_invocation_id()
        await _emit(event_sink, AgentEvent(invocation_id, "agent.started", "CUA Agent 已启动"))
        try:
            _check_cancelled(cancelled)
            async with self._runtime_client_factory() as runtime_client:
                tools = create_cua_tool_registry(runtime_client, data_root=self._data_root)
                return await self._run_loop(
                    invocation_id,
                    request.task,
                    tools,
                    event_sink=event_sink,
                    cancelled=cancelled,
                )
        except RuntimeCancelledError as error:
            await _emit(event_sink, AgentEvent(invocation_id, "cancelled", str(error)))
            return InvocationResult(
                invocation_id=invocation_id,
                status=InvocationStatus.CANCELLED,
                reply=str(error),
                error=str(error),
            )
        except Exception as error:
            message = str(error) or error.__class__.__name__
            await _emit(event_sink, AgentEvent(invocation_id, "failed", message))
            return InvocationResult(
                invocation_id=invocation_id,
                status=InvocationStatus.FAILED,
                reply=message,
                error=message,
            )

    async def _run_loop(
        self,
        invocation_id: str,
        task: str,
        tools: CuaToolRegistry,
        *,
        event_sink: EventSink | None,
        cancelled: CancellationCheck | None,
    ) -> InvocationResult:
        messages = [
            ModelMessage(
                role="system",
                content=f"{CUA_AGENT_DEFINITION.instructions}\n\n{FINAL_RESPONSE_PROTOCOL}",
            ),
            ModelMessage(role="user", content=task),
        ]
        traces: list[ToolTrace] = []

        for turn in range(1, self._max_turns + 1):
            _check_cancelled(cancelled)
            await _emit(
                event_sink,
                AgentEvent(
                    invocation_id,
                    "progress",
                    f"正在进行第 {turn} 轮任务判断",
                    {"turn": turn},
                ),
            )
            response = await _stream_model_turn(
                self._model_client,
                tuple(messages),
                tools.definitions,
                invocation_id,
                turn,
                event_sink,
                cancelled,
            )
            if not response.tool_calls:
                assert response.content is not None
                status = (
                    InvocationStatus.NEEDS_INPUT
                    if response.final_status == "needs-input"
                    else InvocationStatus.COMPLETED
                )
                event_type: AgentEventType = (
                    "needs-input" if status is InvocationStatus.NEEDS_INPUT else "agent.completed"
                )
                await _emit(
                    event_sink,
                    AgentEvent(
                        invocation_id,
                        event_type,
                        response.content,
                        {"turn": turn, "reply": response.content.strip()},
                    ),
                )
                return InvocationResult(
                    invocation_id=invocation_id,
                    status=status,
                    reply=response.content.strip(),
                    tool_calls=tuple(traces),
                )

            messages.append(
                ModelMessage(
                    role="assistant",
                    content=response.content,
                    tool_calls=response.tool_calls,
                )
            )
            for call in response.tool_calls:
                _check_cancelled(cancelled)
                await _emit_tool_started(event_sink, invocation_id, turn, call)
                if call.name == "cua_execute":
                    await _emit(
                        event_sink,
                        AgentEvent(
                            invocation_id,
                            "execution.started",
                            "Computer-Use 执行已开始",
                            {"callId": call.call_id, "turn": turn},
                        ),
                    )
                try:
                    result = await tools.call(
                        call.name,
                        call.arguments,
                        cancelled=cancelled,
                        on_event=(
                            _runtime_progress_sink(event_sink, invocation_id, turn, call)
                            if call.name == "cua_execute" and event_sink is not None
                            else None
                        ),
                    )
                except RuntimeCancelledError:
                    raise
                except Exception as error:
                    message = str(error) or error.__class__.__name__
                    traces.append(
                        ToolTrace(
                            call_id=call.call_id,
                            tool=call.name,
                            input=dict(call.arguments),
                            status="failed",
                            error=message,
                        )
                    )
                    await _emit(
                        event_sink,
                        AgentEvent(
                            invocation_id,
                            "tool.completed",
                            f"{call.name} 执行失败",
                            {
                                "callId": call.call_id,
                                "tool": call.name,
                                "turn": turn,
                                "status": "failed",
                                "error": message,
                            },
                        ),
                    )
                    await _emit(event_sink, AgentEvent(invocation_id, "failed", message))
                    return InvocationResult(
                        invocation_id=invocation_id,
                        status=InvocationStatus.FAILED,
                        reply=f"{call.name} 执行失败：{message}",
                        tool_calls=tuple(traces),
                        error=message,
                    )

                traces.append(
                    ToolTrace(
                        call_id=call.call_id,
                        tool=call.name,
                        input=dict(call.arguments),
                        status="succeeded",
                        output=result,
                    )
                )
                await _emit(
                    event_sink,
                    AgentEvent(
                        invocation_id,
                        "tool.completed",
                        f"{call.name} 执行完成",
                        {
                            "callId": call.call_id,
                            "tool": call.name,
                            "turn": turn,
                            "status": "succeeded",
                            "output": result,
                        },
                    ),
                )
                messages.append(
                    ModelMessage(
                        role="tool",
                        content=json.dumps(result, ensure_ascii=False),
                        tool_call_id=call.call_id,
                    )
                )
                if _is_terminal_tool_success(call, result):
                    return await self._finalize(
                        invocation_id,
                        messages,
                        traces,
                        turn=turn + 1,
                        event_sink=event_sink,
                        cancelled=cancelled,
                    )

        message = f"Agent 在 {self._max_turns} 轮内未生成最终结果"
        await _emit(event_sink, AgentEvent(invocation_id, "failed", message))
        return InvocationResult(
            invocation_id=invocation_id,
            status=InvocationStatus.FAILED,
            reply=message,
            tool_calls=tuple(traces),
            error=message,
        )

    async def _finalize(
        self,
        invocation_id: str,
        messages: list[ModelMessage],
        traces: list[ToolTrace],
        *,
        turn: int,
        event_sink: EventSink | None,
        cancelled: CancellationCheck | None,
    ) -> InvocationResult:
        _check_cancelled(cancelled)
        finalization_messages = (
            *messages,
            ModelMessage(role="system", content=FINALIZATION_PROTOCOL),
        )
        response = await _stream_model_turn(
            self._model_client,
            finalization_messages,
            (),
            invocation_id,
            turn,
            event_sink,
            cancelled,
        )
        if response.tool_calls:
            raise ValueError("成功终态回复不得包含 Tool call")
        if response.final_status != "completed" or response.content is None:
            raise ValueError("成功终态回复必须返回 completed")
        reply = response.content.strip()
        await _emit(
            event_sink,
            AgentEvent(
                invocation_id,
                "agent.completed",
                reply,
                {"turn": turn, "reply": reply},
            ),
        )
        return InvocationResult(
            invocation_id=invocation_id,
            status=InvocationStatus.COMPLETED,
            reply=reply,
            tool_calls=tuple(traces),
        )


def _is_terminal_tool_success(
    call: ModelToolCall,
    result: Mapping[str, object],
) -> bool:
    if call.name == "cua_workbench":
        return True
    return call.name == "cua_execute" and result.get("status") == "succeeded"


async def _emit_tool_started(
    event_sink: EventSink | None,
    invocation_id: str,
    turn: int,
    call: ModelToolCall,
) -> None:
    await _emit(
        event_sink,
        AgentEvent(
            invocation_id,
            "tool.started",
            f"正在调用 {call.name}",
            {
                "callId": call.call_id,
                "tool": call.name,
                "turn": turn,
                "arguments": call.arguments,
            },
        ),
    )


def _runtime_progress_sink(
    event_sink: EventSink | None,
    invocation_id: str,
    turn: int,
    call: ModelToolCall,
) -> RuntimeEventSink:
    async def forward(event: RuntimeProgressEvent) -> None:
        await _emit(
            event_sink,
            AgentEvent(
                invocation_id,
                "execution.progress",
                event.message,
                {
                    "callId": call.call_id,
                    "tool": call.name,
                    "turn": turn,
                    **event.data,
                },
            ),
        )

    return forward


async def _stream_model_turn(
    model_client: ModelClient,
    messages: tuple[ModelMessage, ...],
    definitions: tuple[ToolDefinition, ...],
    invocation_id: str,
    turn: int,
    event_sink: EventSink | None,
    cancelled: CancellationCheck | None,
) -> ModelResponse:
    # 最终协议以 JSON object 开头；其内容只通过终态事件公开。
    prefix = ""
    classification: str | None = None
    visible = False
    response: ModelResponse | None = None
    stream = model_client.stream(messages, definitions)
    while True:
        try:
            item = await _next_model_item(stream, cancelled)
        except StopAsyncIteration:
            break
        _check_cancelled(cancelled)
        if isinstance(item, ModelStreamComplete):
            response = item.response
            continue
        if not isinstance(item, ModelContentDelta) or not item.text:
            continue
        if classification is None:
            prefix += item.text
            stripped = prefix.lstrip()
            if not stripped:
                continue
            classification = "protocol" if stripped.startswith("{") else "visible"
            if classification == "protocol":
                continue
            delta = prefix
            prefix = ""
        elif classification == "protocol":
            continue
        else:
            delta = item.text
        if not visible:
            await _emit(
                event_sink,
                AgentEvent(invocation_id, "assistant.started", data={"turn": turn}),
            )
            visible = True
        await _emit(
            event_sink,
            AgentEvent(invocation_id, "assistant.delta", data={"turn": turn, "text": delta}),
        )
    if visible:
        await _emit(
            event_sink,
            AgentEvent(invocation_id, "assistant.completed", data={"turn": turn}),
        )
    if response is None:
        raise ValueError("模型流缺少完整响应")
    return response


async def _next_model_item(
    stream: AsyncIterator[ModelContentDelta | ModelStreamComplete],
    cancelled: CancellationCheck | None,
) -> ModelContentDelta | ModelStreamComplete:
    async def read_next() -> ModelContentDelta | ModelStreamComplete:
        return await anext(stream)

    pending = asyncio.create_task(read_next())
    try:
        while not pending.done():
            _check_cancelled(cancelled)
            await asyncio.wait({pending}, timeout=0.1)
        _check_cancelled(cancelled)
        return pending.result()
    finally:
        if not pending.done():
            pending.cancel()
            await asyncio.gather(pending, return_exceptions=True)


async def _emit(event_sink: EventSink | None, event: AgentEvent) -> None:
    if event_sink is None:
        return
    result = event_sink(event)
    if inspect.isawaitable(result):
        await result


def _check_cancelled(cancelled: CancellationCheck | None) -> None:
    if cancelled is not None and cancelled():
        raise RuntimeCancelledError("CUA Agent invocation 已取消")
