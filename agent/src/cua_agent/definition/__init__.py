"""从 Python 包内加载唯一 canonical CUA Agent definition。"""

__all__ = ["CUA_AGENT_DEFINITION", "load_agent_definition"]

from importlib.resources import files

from ..capabilities import ToolMode, resolve_tool_mode
from ..contracts import AgentDefinition


def _read_text(name: str) -> str:
    return files(__package__).joinpath(name).read_text(encoding="utf-8").strip()


def load_agent_definition(
    *, freeform_only: bool | None = None, tool_mode: ToolMode | None = None,
) -> AgentDefinition:
    """创建一个不含可变运行状态的新 definition 值。"""

    mode = resolve_tool_mode(tool_mode, freeform_only)
    return AgentDefinition(
        name="Computer-Use",
        invocation_mode="stateless-task",
        description=(
            "接受完整电脑操作任务并直接执行自然语言流程，或录制操作并返回日志和截图资产。"
            if mode == "normal" else _read_text("description.md")
        ),
        instructions=_read_text(
            "normal-instructions.md" if mode == "normal" else "instructions.md"
        ),
    )


CUA_AGENT_DEFINITION = load_agent_definition(tool_mode="professional")
