"""Review、Host Adapter 与 CUA Agent 之间的稳定调用契约。"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from enum import StrEnum
from typing import TypeAlias

JsonScalar: TypeAlias = str | int | float | bool | None
JsonValue: TypeAlias = JsonScalar | list["JsonValue"] | dict[str, "JsonValue"]


class InvocationStatus(StrEnum):
    """一次独立任务的最终状态。"""

    COMPLETED = "completed"
    NEEDS_INPUT = "needs-input"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass(frozen=True, slots=True)
class AgentDefinition:
    """供调用方路由任务和 Host Adapter 注册的 canonical Agent 定义。"""

    name: str
    invocation_mode: str
    description: str
    instructions: str


@dataclass(frozen=True, slots=True)
class InvocationRequest:
    """Host 提交给 CUA Agent 的单任务请求，不包含聊天历史。"""

    task: str
    invocation_id: str | None = None
    execution: dict[str, JsonValue] | None = None

    def __post_init__(self) -> None:
        normalized_task = self.task.strip() if isinstance(self.task, str) else ""
        if not normalized_task:
            raise ValueError("Subagent task 必须是非空字符串")
        object.__setattr__(self, "task", normalized_task)
        if self.execution is not None:
            object.__setattr__(self, "execution", normalize_execution(self.execution))

        if self.invocation_id is not None:
            normalized_id = self.invocation_id.strip()
            if not normalized_id:
                raise ValueError("invocation_id 不能为空字符串")
            object.__setattr__(self, "invocation_id", normalized_id)


def _execution_string(value: object, name: str, *, identifier: bool = False) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"execution.{name} 必须是非空字符串")
    text = value.strip()
    if identifier and (text in (".", "..") or any(char in text for char in ("/", "\\", ":"))):
        raise ValueError(f"execution.{name} 必须是单一目录标识，不接受文件路径")
    return text


def normalize_execution(value: Mapping[str, JsonValue]) -> dict[str, JsonValue]:
    """校验与 cua_execute 共用的参数形态，不接受宿主路径或 Skill 目录。"""
    if not isinstance(value, Mapping):
        raise ValueError("execution 必须是 JSON object")
    strategy = value.get("strategy", "guided" if "skillName" in value else None)
    if strategy not in ("replay", "guided", "freeform"):
        raise ValueError("execution.strategy 必须为 replay、guided 或 freeform")
    allowed = {"strategy", "goal", "displayId"} if strategy == "freeform" else {
        "strategy", "skillName", "inputs",
    }
    if set(value) - allowed:
        raise ValueError("execution 包含不支持的字段，不接受 scene/task 或任意路径")
    result: dict[str, JsonValue] = {"strategy": strategy}
    if strategy == "freeform":
        result["goal"] = _execution_string(value.get("goal"), "goal")
        if "displayId" in value:
            result["displayId"] = _execution_string(value["displayId"], "displayId")
        return result
    name = _execution_string(value.get("skillName"), "skillName", identifier=True)
    if len(name) > 64 or re.fullmatch(r"[a-z][a-z0-9]*(?:-[a-z0-9]+)*", name) is None:
        raise ValueError("execution.skillName 必须是小写英文、数字和连字符组成的 Skill 标识")
    if re.fullmatch(r"con|prn|aux|nul|com[0-9]|lpt[0-9]", name):
        raise ValueError("execution.skillName 不能使用系统保留名称")
    result["skillName"] = name
    if "inputs" in value:
        inputs = value["inputs"]
        if not isinstance(inputs, dict) or any(
            not isinstance(key, str) or not isinstance(item, str) for key, item in inputs.items()
        ):
            raise ValueError("execution.inputs 必须是字符串键和值的 JSON object")
        result["inputs"] = dict(inputs)
    return result


@dataclass(frozen=True, slots=True)
class ToolTrace:
    """允许调用方观察的诊断摘要；不表示 Host 可以注册或直接调用该 Tool。"""

    call_id: str
    tool: str
    input: dict[str, JsonValue]
    status: str
    output: dict[str, JsonValue] | None = None
    error: str | None = None

    def to_dict(self) -> dict[str, JsonValue]:
        value: dict[str, JsonValue] = {
            "callId": self.call_id,
            "tool": self.tool,
            "input": _copy_json_object(self.input),
            "status": self.status,
        }
        if self.output is not None:
            value["output"] = _copy_json_object(self.output)
        if self.error is not None:
            value["error"] = self.error
        return value


@dataclass(frozen=True, slots=True)
class InvocationResult:
    """一次 CUA Subagent invocation 的最终、JSON 友好结果。"""

    invocation_id: str
    status: InvocationStatus
    reply: str
    tool_calls: tuple[ToolTrace, ...] = ()
    data: dict[str, JsonValue] | None = None
    error: str | None = None
    schema_version: str = field(default="1.0", init=False)

    def __post_init__(self) -> None:
        if not self.invocation_id.strip():
            raise ValueError("invocation_id 不能为空")
        if not self.reply.strip():
            raise ValueError("reply 不能为空")

    def to_dict(self) -> dict[str, JsonValue]:
        value: dict[str, JsonValue] = {
            "schemaVersion": self.schema_version,
            "invocationId": self.invocation_id,
            "status": self.status.value,
            "reply": self.reply,
            "toolCalls": [trace.to_dict() for trace in self.tool_calls],
        }
        if self.data is not None:
            value["data"] = _copy_json_object(self.data)
        if self.error is not None:
            value["error"] = self.error
        return value


def _copy_json_value(value: JsonValue) -> JsonValue:
    if isinstance(value, dict):
        return {key: _copy_json_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_copy_json_value(item) for item in value]
    return value


def _copy_json_object(value: dict[str, JsonValue]) -> dict[str, JsonValue]:
    return {key: _copy_json_value(item) for key, item in value.items()}
