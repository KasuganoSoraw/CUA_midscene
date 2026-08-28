"""与具体模型供应商解耦的 Agent message 与 Tool Calling 契约。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Protocol, TypeAlias

from .contracts import JsonValue
from .tools import ToolDefinition

MessageRole: TypeAlias = Literal["system", "user", "assistant", "tool"]
FinalStatus: TypeAlias = Literal["completed", "needs-input"]


@dataclass(frozen=True, slots=True)
class ModelToolCall:
    call_id: str
    name: str
    arguments: dict[str, JsonValue]


@dataclass(frozen=True, slots=True)
class ModelMessage:
    role: MessageRole
    content: str | None = None
    tool_calls: tuple[ModelToolCall, ...] = ()
    tool_call_id: str | None = None


@dataclass(frozen=True, slots=True)
class ModelResponse:
    content: str | None = None
    tool_calls: tuple[ModelToolCall, ...] = ()
    final_status: FinalStatus | None = None

    def __post_init__(self) -> None:
        if not self.tool_calls and (self.content is None or not self.content.strip()):
            raise ValueError("模型响应必须包含最终内容或 Tool call")
        if self.tool_calls and self.final_status is not None:
            raise ValueError("包含 Tool call 的模型响应不能同时声明 final_status")


class ModelClient(Protocol):
    async def complete(
        self,
        messages: tuple[ModelMessage, ...],
        tools: tuple[ToolDefinition, ...],
    ) -> ModelResponse: ...
