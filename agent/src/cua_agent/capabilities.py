"""Python API 与进程入口的兼容配置标签校验，工具能力保持统一。"""

import os
from typing import Literal, TypeAlias

ToolMode: TypeAlias = Literal["normal", "professional"]


def resolve_tool_mode(
    tool_mode: ToolMode | None = None, freeform_only: bool | None = None,
) -> ToolMode:
    if tool_mode is not None:
        if tool_mode not in ("normal", "professional"):
            raise ValueError("tool_mode 必须为 normal 或 professional")
        return tool_mode
    if freeform_only is not None:
        return "normal" if freeform_only else "professional"
    configured = os.environ.get("CUA_AGENT_TOOL_MODE")
    if configured is not None:
        if configured.strip() not in ("normal", "professional"):
            raise ValueError("CUA_AGENT_TOOL_MODE 必须为 normal 或 professional")
        return "normal" if configured.strip() == "normal" else "professional"
    legacy = os.environ.get("CUA_AGENT_FREEFORM_ONLY", "false").strip().lower()
    if legacy not in ("true", "false"):
        raise ValueError("CUA_AGENT_FREEFORM_ONLY 必须为 true 或 false")
    return "normal" if legacy == "true" else "professional"
