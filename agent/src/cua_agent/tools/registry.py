"""CUA Agent 私有 Tool schema 与 Runtime method 映射。"""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass

from ..capabilities import ToolMode, resolve_tool_mode
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
        "查找专业工作台生成的 CUA 任务（Recorded Skill）。"
        "仅当调用方明确要求执行一个任务名或提供 task 标识时使用。"
        "完整操作流程或纯业务目标直接 freeform，不主动检索，不自行发明任务名。"
        "调用方明确提供 task 标识但未提供 scene 时优先 find-task；"
        "只有任务名称时，使用 list-scenes/list-tasks 定位该具名任务，不将名称猜成 ID；"
        "已知 scene/task 时使用 describe-task。名称存在歧义时请求明确任务。"
        "未命中且只有任务名时请求补充目标或流程，不猜测操作，不向调用方请求策略确认。"
    ),
    input_schema={
        "type": "object",
        "oneOf": [
            {
                "properties": {
                    "action": {
                        "const": "list-scenes",
                        "description": "为定位请求中明确要求执行的具名任务，列出可用场景。",
                    }
                },
                "required": ["action"],
                "additionalProperties": False,
            },
            {
                "properties": {
                    "action": {
                        "const": "list-tasks",
                        "description": "在明确场景中定位调用方要求执行的具名任务。",
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
                            "完整自然语言操作流程或业务目标直接执行，无需先检索；"
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

RECORD_TOOL = ToolDefinition(
    name="cua_record",
    description=(
        "用户要求录制、示教或记录接下来的 GUI 操作以创建可复用流程时使用。"
        "默认主屏幕，启动桌面录制悬浮条并等待用户完成或放弃，不打开工作台。"
        "正常完成后自动整理日志、提取截图，返回供主 Agent 生成 Skill 的资产路径；"
        "取消时不预处理。不执行现有 Skill，不需要 scene、task 或 displayId。"
    ),
    input_schema={
        "type": "object",
        "properties": {"goal": {"type": "string", "minLength": 1}},
        "required": ["goal"],
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
        freeform_only: bool | None = None,
        tool_mode: ToolMode | None = None,
    ) -> None:
        self._client = client
        self._data_root = data_root
        resolve_tool_mode(tool_mode, freeform_only)
        self._tools: dict[str, tuple[ToolDefinition, RuntimeMethod]] = {
            CATALOG_TOOL.name: (CATALOG_TOOL, "catalog"),
            EXECUTE_TOOL.name: (EXECUTE_TOOL, "execute"),
            RECORD_TOOL.name: (RECORD_TOOL, "record"),
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
        if name == "cua_execute":
            if arguments.get("strategy") not in ("replay", "guided", "freeform"):
                raise ValueError("执行策略必须为 replay、guided 或 freeform")
            if arguments.get("strategy") == "freeform":
                _validate_freeform_arguments(arguments)
        if name == "cua_record":
            goal = arguments.get("goal")
            if set(arguments) != {"goal"} or not isinstance(goal, str) or not goal.strip():
                raise ValueError("cua_record 仅接受非空 goal")
        _definition, method = entry
        payload = _normalize_tool_arguments(name, arguments)
        if self._data_root is not None and "dataRoot" not in payload:
            payload["dataRoot"] = self._data_root
        if method in ("execute", "record") and on_event is not None:
            return await self._client.request(
                method, payload, cancelled=cancelled, on_event=on_event
            )
        return await self._client.request(method, payload, cancelled=cancelled)


def _validate_freeform_arguments(arguments: Mapping[str, JsonValue]) -> None:
    if set(arguments) - {"strategy", "goal", "displayId", "dataRoot"}:
        raise ValueError("freeform 仅接受 strategy、goal、displayId 和内部 dataRoot")
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
    freeform_only: bool | None = None,
    tool_mode: ToolMode | None = None,
) -> CuaToolRegistry:
    return CuaToolRegistry(
        client, data_root=data_root, freeform_only=freeform_only, tool_mode=tool_mode,
    )
