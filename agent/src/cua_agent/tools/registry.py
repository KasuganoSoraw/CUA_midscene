"""CUA Agent 私有 Tool schema 与 Runtime method 映射。"""

from __future__ import annotations

import json
from collections.abc import Mapping
from copy import deepcopy
from dataclasses import dataclass
from typing import cast

from ..contracts import JsonValue, normalize_execution
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


EXECUTE_TOOL = ToolDefinition(
    name="cua_execute",
    description=(
        "执行调用方绑定的完整电脑操作任务。结构化任务使用 skillName 和 inputs，"
        "默认 guided；明确严格回放时使用 replay。无 Skill 绑定时使用 freeform 和完整 goal。"
        "不得自行发现或更换 Skill，成功后停止。"
    ),
    input_schema={
        "type": "object",
        "oneOf": [
            {
                "properties": {
                    "strategy": {"const": "replay"},
                    "skillName": {
                        "type": "string", "pattern": "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$",
                        "maxLength": 64,
                        "description": "调用方已经选定的 CUA Skill 名称，不是文件路径。",
                    },
                    "inputs": {"type": "object", "additionalProperties": {"type": "string"}},
                },
                "required": ["strategy", "skillName"],
                "additionalProperties": False,
            },
            {
                "properties": {
                    "strategy": {"const": "guided"},
                    "skillName": {
                        "type": "string", "pattern": "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$",
                        "maxLength": 64,
                        "description": "调用方已经选定的 CUA Skill 名称，不是文件路径。",
                    },
                    "inputs": {"type": "object", "additionalProperties": {"type": "string"}},
                },
                "required": ["strategy", "skillName"],
                "additionalProperties": False,
            },
            {
                "properties": {
                    "strategy": {
                        "const": "freeform",
                        "description": (
                            "调用方未绑定结构化 Skill 时直接执行完整目标，不要求选择执行策略。"
                        ),
                    },
                    "goal": {"type": "string", "minLength": 1},
                    "displayId": {"type": "string", "minLength": 1},
                },
                "required": ["strategy", "goal"],
                "additionalProperties": False,
            },
        ],
    },
)

class CuaToolRegistry:
    """把模型可见的私有 Tool 名称映射到 Runtime bridge method。"""

    def __init__(
        self,
        client: RuntimeClientProtocol,
        *,
        data_root: str | None = None,
        freeform_only: bool = False,
        expected_execution: Mapping[str, JsonValue] | None = None,
    ) -> None:
        self._client = client
        self._data_root = data_root
        self._freeform_only = freeform_only
        self._expected_execution = (
            normalize_execution(expected_execution) if expected_execution is not None else None
        )
        self._tools: dict[str, tuple[ToolDefinition, RuntimeMethod]] = {
            EXECUTE_TOOL.name: (EXECUTE_TOOL, "execute"),
        }
        if freeform_only:
            branches = cast(list[dict[str, JsonValue]], EXECUTE_TOOL.input_schema["oneOf"])
            execute = ToolDefinition(
                name=EXECUTE_TOOL.name,
                description=EXECUTE_TOOL.description,
                input_schema=deepcopy(branches[2]),
            )
            execute.input_schema["type"] = "object"
            properties = cast(dict[str, JsonValue], execute.input_schema["properties"])
            properties["strategy"] = {"const": "freeform"}
            self._tools = {execute.name: (execute, "execute")}

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
        if self._freeform_only:
            _validate_freeform_arguments(arguments)
        _definition, method = entry
        payload = normalize_execution(_normalize_execution_arguments(arguments))
        if self._expected_execution is not None:
            _require_bound_execution(payload, self._expected_execution)
        if self._data_root is not None and "dataRoot" not in payload:
            payload["dataRoot"] = self._data_root
        if method == "execute" and on_event is not None:
            return await self._client.request(
                method, payload, cancelled=cancelled, on_event=on_event
            )
        return await self._client.request(method, payload, cancelled=cancelled)


def _require_bound_execution(
    arguments: Mapping[str, JsonValue], expected: Mapping[str, JsonValue],
) -> None:
    actual = normalize_execution(arguments)
    bound = dict(expected)
    if actual.get("strategy") != "freeform":
        actual.setdefault("inputs", {})
        bound.setdefault("inputs", {})
    if actual != bound:
        raise ValueError("模型调用必须与调用方 execution 绑定一致，不得更换任务、参数或策略")


def _validate_freeform_arguments(arguments: Mapping[str, JsonValue]) -> None:
    if arguments.get("strategy") != "freeform":
        raise ValueError("当前 CUA Agent 仅支持 freeform 自然语言执行")
    if set(arguments) - {"strategy", "goal", "displayId"}:
        raise ValueError("freeform 仅接受 strategy、goal 和可选 displayId")
    for name in ("goal", "displayId"):
        if name == "displayId" and name not in arguments:
            continue
        value = arguments.get(name)
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"{name} 必须是非空字符串")


def _normalize_execution_arguments(
    arguments: Mapping[str, JsonValue],
) -> dict[str, JsonValue]:
    payload = dict(arguments)
    if "inputs" not in payload:
        return payload

    raw_inputs = payload["inputs"]
    parsed: object = raw_inputs
    if isinstance(raw_inputs, str):
        try:
            parsed = json.loads(raw_inputs)
        except json.JSONDecodeError as error:
            raise ValueError(
                "cua_execute.inputs 必须是 JSON object；收到的字符串不是合法 JSON"
            ) from error
    if not isinstance(parsed, dict):
        raise ValueError("cua_execute.inputs 必须是 JSON object")

    normalized: dict[str, JsonValue] = {}
    for key, value in parsed.items():
        if not isinstance(key, str) or not isinstance(value, str):
            raise ValueError("cua_execute.inputs 的键和值必须都是字符串")
        normalized[key] = value
    payload["inputs"] = normalized
    return payload


def create_cua_tool_registry(
    client: RuntimeClientProtocol,
    *,
    data_root: str | None = None,
    freeform_only: bool = False,
    expected_execution: Mapping[str, JsonValue] | None = None,
) -> CuaToolRegistry:
    return CuaToolRegistry(
        client, data_root=data_root, freeform_only=freeform_only,
        expected_execution=expected_execution,
    )
