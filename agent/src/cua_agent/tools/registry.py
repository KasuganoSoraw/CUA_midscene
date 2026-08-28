"""CUA Agent 私有 Tool schema 与 Runtime method 映射。"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

from ..contracts import JsonValue
from ..runtime_client import CancellationCheck, RuntimeClientProtocol, RuntimeMethod


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
    description="发现 Recorded Skill：列出场景、列出任务或描述明确任务。",
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
    description="以明确 replay、guided 或 freeform 策略执行一次 Computer-Use 任务。",
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
                    "strategy": {"const": "freeform"},
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
    description="启动或复用 CUA Workbench，并返回录制、复核或执行目标的深链接。",
    input_schema={
        "type": "object",
        "properties": {
            "mode": {"enum": ["recording", "review", "execution"]},
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
    ) -> dict[str, JsonValue]:
        entry = self._tools.get(name)
        if entry is None:
            raise ValueError(f"无法识别 CUA Agent Tool：{name}")
        _definition, method = entry
        payload = dict(arguments)
        if self._data_root is not None and "dataRoot" not in payload:
            payload["dataRoot"] = self._data_root
        return await self._client.request(method, payload, cancelled=cancelled)


def create_cua_tool_registry(
    client: RuntimeClientProtocol,
    *,
    data_root: str | None = None,
) -> CuaToolRegistry:
    return CuaToolRegistry(client, data_root=data_root)
