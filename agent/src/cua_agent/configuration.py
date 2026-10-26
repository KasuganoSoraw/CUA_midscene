"""模型工具配置，不控制宿主 Runtime 的可用方法。"""

import os
from typing import Literal, TypeAlias, cast

ToolMode: TypeAlias = Literal["execute", "discover"]


def resolve_tool_mode(value: ToolMode | None = None) -> ToolMode:
    configured = value if value is not None else os.environ.get("CUA_AGENT_TOOL_MODE", "execute")
    normalized = configured.strip()
    if normalized not in ("execute", "discover"):
        raise ValueError("CUA_AGENT_TOOL_MODE/tool_mode 必须为 execute 或 discover")
    return cast(ToolMode, normalized)
