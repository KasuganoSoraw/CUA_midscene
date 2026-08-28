"""CUA Agent 对 Host 暴露的调用级事件。"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Literal, TypeAlias

from .contracts import JsonValue, _copy_json_object

AgentEventType: TypeAlias = Literal[
    "agent.started",
    "progress",
    "tool.started",
    "tool.completed",
    "execution.started",
    "agent.completed",
    "failed",
    "needs-input",
    "cancelled",
]


def utc_now_iso() -> str:
    return datetime.now(UTC).isoformat()


@dataclass(frozen=True, slots=True)
class AgentEvent:
    """可被 GDEClaw、SSE Adapter 或 Review 开发页消费的事件帧。"""

    invocation_id: str
    type: AgentEventType
    message: str | None = None
    data: dict[str, JsonValue] | None = None
    timestamp: str = field(default_factory=utc_now_iso)
    schema_version: str = field(default="1.0", init=False)

    def __post_init__(self) -> None:
        if not self.invocation_id.strip():
            raise ValueError("event invocation_id 不能为空")

    def to_dict(self) -> dict[str, JsonValue]:
        value: dict[str, JsonValue] = {
            "schemaVersion": self.schema_version,
            "invocationId": self.invocation_id,
            "type": self.type,
            "timestamp": self.timestamp,
        }
        if self.message is not None:
            value["message"] = self.message
        if self.data is not None:
            value["data"] = _copy_json_object(self.data)
        return value

