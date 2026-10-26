"""CUA Agent 私有 Tool schema 与 Runtime method 映射。"""

from __future__ import annotations

import json
from collections.abc import Mapping
from copy import deepcopy
from dataclasses import dataclass
from typing import cast

from ..configuration import ToolMode, resolve_tool_mode
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


CATALOG_TOOL = ToolDefinition(
    name="cua_catalog",
    description=(
        "发现 Recorded Skill。调用方明确提供 task 标识但未提供 scene 时，优先使用 "
        "find-task；只有自然语言目标、尚不知道 task 时，使用 list-scenes 和 list-tasks "
        "浏览；已知 scene 和 task 时，使用 describe-task 获取详情。未发现匹配任务时，"
        "直接改用 cua_execute 的 freeform 策略继续完成原始目标，不向调用方请求策略确认。"
    ),
    input_schema={
        "type": "object",
        "oneOf": [
            {
                "properties": {
                    "action": {
                        "const": "list-scenes",
                        "description": "尚不知道明确 scene 或 task 时，从场景开始浏览。",
                    }
                },
                "required": ["action"],
                "additionalProperties": False,
            },
            {
                "properties": {
                    "action": {
                        "const": "list-tasks",
                        "description": "已知 scene、尚不知道明确 task 时，列出该场景的任务。",
                    },
                    "scene": {"type": "string", "minLength": 1},
                },
                "required": ["action", "scene"],
                "additionalProperties": False,
            },
            {
                "properties": {
                    "action": {
                        "const": "find-task",
                        "description": (
                            "调用方给出明确 task 标识但未知 scene 时，按 task ID 跨场景精确查找；"
                            "不用于自然语言语义搜索。"
                        ),
                    },
                    "task": {"type": "string", "minLength": 1},
                },
                "required": ["action", "task"],
                "additionalProperties": False,
            },
            {
                "properties": {
                    "action": {
                        "const": "describe-task",
                        "description": "scene 和 task 均已确定时，读取任务详情与输入要求。",
                    },
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
        tool_mode: ToolMode | None = None,
        expected_execution: Mapping[str, JsonValue] | None = None,
    ) -> None:
        self._client = client
        self._data_root = data_root
        self._freeform_only = freeform_only
        mode = resolve_tool_mode(tool_mode)
        self._expected_execution = (
            normalize_execution(expected_execution) if expected_execution is not None else None
        )
        self._tools: dict[str, tuple[ToolDefinition, RuntimeMethod]] = {
            EXECUTE_TOOL.name: (EXECUTE_TOOL, "execute"),
        }
        if mode == "discover" and expected_execution is None and not freeform_only:
            self._tools = {CATALOG_TOOL.name: (CATALOG_TOOL, "catalog"), **self._tools}
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
        payload = _normalize_tool_arguments(name, arguments)
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


def _normalize_tool_arguments(
    name: str,
    arguments: Mapping[str, JsonValue],
) -> dict[str, JsonValue]:
    payload = dict(arguments)
    if name == "cua_catalog":
        # 模型（如 GTSLLM-Pro-Moe）有时把 const 枚举值输出为数组
        # （["list-tasks"]）、带引号的字符串（"list-tasks"）或带噪声字符
        # （list-tasks>），导致 Node 侧 includes 严格匹配失败。
        # 从原始值中提取已知 action 关键字。
        raw_action = payload.get("action")
        text: str
        if isinstance(raw_action, list) and raw_action:
            text = str(raw_action[0])
        elif isinstance(raw_action, str):
            text = raw_action
        else:
            text = str(raw_action or "")
        catalog_action = _extract_catalog_action(text)
        if catalog_action is not None:
            payload["action"] = catalog_action
        return payload
    if name != "cua_execute" or "inputs" not in payload:
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


_CATALOG_ACTIONS: tuple[str, ...] = (
    "list-scenes",
    "list-tasks",
    "find-task",
    "describe-task",
)


def _extract_catalog_action(text: str) -> str | None:
    """从可能带噪声的文本中提取已知的 catalog action 关键字。

    模型（如 GTSLLM-Pro-Moe）可能把 const 枚举值输出为带引号、带空白、
    带噪声字符（如 `list-scenes>`）甚至数组形式。这里用子串匹配提取
    已知 action，避免严格 includes 误报"无法识别"。
    """
    lowered = text.lower()
    for action in _CATALOG_ACTIONS:
        if action in lowered:
            return action
    return None


def create_cua_tool_registry(
    client: RuntimeClientProtocol,
    *,
    data_root: str | None = None,
    freeform_only: bool = False,
    tool_mode: ToolMode | None = None,
    expected_execution: Mapping[str, JsonValue] | None = None,
) -> CuaToolRegistry:
    return CuaToolRegistry(
        client, data_root=data_root, freeform_only=freeform_only,
        tool_mode=tool_mode, expected_execution=expected_execution,
    )
