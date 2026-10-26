"""从 Python 包内加载唯一 canonical CUA Agent definition。"""

__all__ = ["CUA_AGENT_DEFINITION", "load_agent_definition"]

from importlib.resources import files

from ..configuration import ToolMode, resolve_tool_mode
from ..contracts import AgentDefinition


def _read_text(name: str) -> str:
    return files(__package__).joinpath(name).read_text(encoding="utf-8").strip()


def load_agent_definition(
    *, freeform_only: bool = False, tool_mode: ToolMode | None = None,
) -> AgentDefinition:
    """创建一个不含可变运行状态的新 definition 值。"""

    mode = resolve_tool_mode(tool_mode)
    instructions = "instructions.md" if mode == "execute" else "discovery-instructions.md"
    if freeform_only:
        instructions = "freeform-instructions.md"
    description = _read_text("description.md")
    if mode == "discover":
        description = (
            "独立电脑操作 Agent，可发现项目任务并执行 replay、guided 或 freeform；"
            "不提供工作台工具。"
        )
    return AgentDefinition(
        name="Computer-Use",
        invocation_mode="stateless-task",
        description=(
            "接受包含目标、输入和约束的完整电脑操作任务，使用自然语言执行桌面操作。"
            if freeform_only else description
        ),
        instructions=_read_text(instructions),
    )


CUA_AGENT_DEFINITION = load_agent_definition(tool_mode="execute")
