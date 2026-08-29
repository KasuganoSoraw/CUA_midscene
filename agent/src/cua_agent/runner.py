"""一次调用内无状态、可测试的 CUA Agent Tool Calling loop。"""

from __future__ import annotations

import inspect
import json
from collections.abc import Awaitable, Callable
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
from .model import ModelClient, ModelMessage, ModelToolCall
from .runtime_client import (
    CancellationCheck,
    ManagedRuntimeClientProtocol,
    RuntimeCancelledError,
)
from .tools import CuaToolRegistry, create_cua_tool_registry

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


class CuaAgent:
    """可被未来 GDEClaw Adapter 或 Review 调试入口调用的高层无状态 Agent。"""

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
            response = await self._model_client.complete(tuple(messages), tools.definitions)
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
                await _emit(event_sink, AgentEvent(invocation_id, event_type, response.content))
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
                await _emit_tool_started(event_sink, invocation_id, call)
                if call.name == "cua_execute":
                    await _emit(
                        event_sink,
                        AgentEvent(
                            invocation_id,
                            "execution.started",
                            "Computer-Use 执行已开始",
                            {"callId": call.call_id},
                        ),
                    )
                try:
                    result = await tools.call(call.name, call.arguments, cancelled=cancelled)
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
                            {"callId": call.call_id, "tool": call.name, "status": "failed"},
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
                        {"callId": call.call_id, "tool": call.name, "status": "succeeded"},
                    ),
                )
                messages.append(
                    ModelMessage(
                        role="tool",
                        content=json.dumps(result, ensure_ascii=False),
                        tool_call_id=call.call_id,
                    )
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


async def _emit_tool_started(
    event_sink: EventSink | None,
    invocation_id: str,
    call: ModelToolCall,
) -> None:
    await _emit(
        event_sink,
        AgentEvent(
            invocation_id,
            "tool.started",
            f"正在调用 {call.name}",
            {"callId": call.call_id, "tool": call.name},
        ),
    )


async def _emit(event_sink: EventSink | None, event: AgentEvent) -> None:
    if event_sink is None:
        return
    result = event_sink(event)
    if inspect.isawaitable(result):
        await result


def _check_cancelled(cancelled: CancellationCheck | None) -> None:
    if cancelled is not None and cancelled():
        raise RuntimeCancelledError("CUA Agent invocation 已取消")
