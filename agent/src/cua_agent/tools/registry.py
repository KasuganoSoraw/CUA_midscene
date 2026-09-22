"""CUA Agent 私有 Tool schema 与 Runtime method 映射。"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

from ..contracts import JsonValue
from ..runtime_client import (
    CancellationCheck,
    RuntimeClientProtocol,
    RuntimeEventSink,
    RuntimeMethod,
)


@dataclass(frozen=True, slots=True)
class ToolDefinition:
    name: str
    description: str
    input_schema: dict[str, JsonValue]

    def to_dict(self) -> dict[str, JsonValue]:
        return {
            "name": self.name,
            "description": self.description,
            "inputSchema": self.input_schema,
        }


CATALOG_TOOL = ToolDefinition(
    name="cua_catalog",
    description=(
        "发现 Recorded Skill：列出场景、列出任务或描述明确任务。未发现匹配任务时，"
        "直接改用 cua_execute 的 freeform 策略继续完成原始目标，不向调用方请求策略确认。"
    ),
    input_schema={
        "type": "object",
        "oneOf": [
            {
                "properties": {"action": {"const": "list-scenes"}},
                "required": ["action"],
                "additionalProperties": False,
            },
            {
                "properties": {
                    "action": {"const": "list-tasks"},
                    "scene": {"type": "string", "minLength": 1},
                },
                "required": ["action", "scene"],
                "additionalProperties": False,
            },
            {
                "properties": {
                    "action": {"const": "describe-task"},
                    "scene": {"type": "string", "minLength": 1},
                    "task": {"type": "string", "minLength": 1},
                },
                "required": ["action", "scene", "task"],
                "additionalProperties": False,
            },
        ],
    },
)

EXECUTE_TOOL = ToolDefinition(
    name="cua_execute",
    description=(
        "执行一次具有真实桌面副作用的完整 Computer-Use 任务。调用时传入完整目标，"
        "不得用于探测或确认。返回 status=succeeded 表示目标已经完成；成功后不得再次"
        "执行相同或相似 GUI 操作来验证结果，应直接生成最终回复。"
    ),
    input_schema={
        "type": "object",
        "oneOf": [
            {
                "properties": {
                    "strategy": {"const": "replay"},
                    "scene": {"type": "string", "minLength": 1},
                    "task": {"type": "string", "minLength": 1},
                    "inputs": {"type": "object", "additionalProperties": {"type": "string"}},
                    "dryRun": {"type": "boolean"},
                },
                "required": ["strategy", "scene", "task"],
                "additionalProperties": False,
            },
            {
                "properties": {
                    "strategy": {"const": "guided"},
                    "scene": {"type": "string", "minLength": 1},
                    "task": {"type": "string", "minLength": 1},
                    "inputs": {"type": "object", "additionalProperties": {"type": "string"}},
                    "dryRun": {"type": "boolean"},
                },
                "required": ["strategy", "scene", "task"],
                "additionalProperties": False,
            },
            {
                "properties": {
                    "strategy": {
                        "const": "freeform",
                        "description": (
                            "没有合适 Recorded Skill 时直接执行完整目标；"
                            "不需要调用方再次确认此策略。"
                        ),
                    },
                    "goal": {"type": "string", "minLength": 1},
                    "displayId": {"type": "string", "minLength": 1},
                    "dryRun": {"type": "boolean"},
                },
                "required": ["strategy", "goal"],
                "additionalProperties": False,
            },
        ],
    },
)

WORKBENCH_TOOL = ToolDefinition(
    name="cua_workbench",
    description=(
        "启动或复用 Recorded Skill Workbench。仅用于录制新操作流程、复核或校准已录制任务，"
        "或用户明确要求在 Workbench 中回放、调试已录制任务。它不是 cua_execute 的结果"
        "查看页面；freeform 执行成功后不得为了确认或展示结果调用此 Tool。"
    ),
    input_schema={
        "type": "object",
        "properties": {
            "mode": {
                "enum": ["recording", "review", "execution"],
                "description": (
                    "recording 用于录制新流程，review 用于复核或校准已录制任务；"
                    "execution 仅表示在 Workbench 中打开已录制任务的执行、回放或调试界面，"
                    "不表示查看 freeform cua_execute 的执行结果。"
                ),
            },
            "scene": {"type": "string", "minLength": 1},
            "task": {"type": "string", "minLength": 1},
        },
        "required": ["mode"],
        "additionalProperties": False,
    },
)


class CuaToolRegistry:
    """把模型可见的私有 Tool 名称映射到 Runtime bridge method。"""

    def __init__(
        self,
        client: RuntimeClientProtocol,
        *,
        data_root: str | None = None,
    ) -> None:
        self._client = client
        self._data_root = data_root
        self._tools: dict[str, tuple[ToolDefinition, RuntimeMethod]] = {
            CATALOG_TOOL.name: (CATALOG_TOOL, "catalog"),
            EXECUTE_TOOL.name: (EXECUTE_TOOL, "execute"),
            WORKBENCH_TOOL.name: (WORKBENCH_TOOL, "workbench"),
        }

    @property
    def definitions(self) -> tuple[ToolDefinition, ...]:
        return tuple(definition for definition, _method in self._tools.values())

    async def call(
        self,
        name: str,
        arguments: Mapping[str, JsonValue],
        *,
        cancelled: CancellationCheck | None = None,
        on_event: RuntimeEventSink | None = None,
    ) -> dict[str, JsonValue]:
        entry = self._tools.get(name)
        if entry is None:
            raise ValueError(f"无法识别 CUA Agent Tool：{name}")
        _definition, method = entry
        payload = dict(arguments)
        if self._data_root is not None and "dataRoot" not in payload:
            payload["dataRoot"] = self._data_root
        if method == "execute" and on_event is not None:
            return await self._client.request(
                method, payload, cancelled=cancelled, on_event=on_event
            )
        return await self._client.request(method, payload, cancelled=cancelled)


def create_cua_tool_registry(
    client: RuntimeClientProtocol,
    *,
    data_root: str | None = None,
) -> CuaToolRegistry:
    return CuaToolRegistry(client, data_root=data_root)
