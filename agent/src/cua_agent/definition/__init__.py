"""从 Python 包内加载唯一 canonical CUA Agent definition。"""

__all__ = ["CUA_AGENT_DEFINITION", "load_agent_definition"]

from importlib.resources import files

from ..contracts import AgentDefinition


def _read_text(name: str) -> str:
    return files(__package__).joinpath(name).read_text(encoding="utf-8").strip()


def load_agent_definition(*, freeform_only: bool = False) -> AgentDefinition:
    """创建一个不含可变运行状态的新 definition 值。"""

    return AgentDefinition(
        name="Computer-Use",
        invocation_mode="stateless-task",
        description=(
            "接受包含目标、输入和约束的完整电脑操作任务，使用自然语言执行桌面操作。"
            if freeform_only else _read_text("description.md")
        ),
        instructions=_read_text(
            "freeform-instructions.md" if freeform_only else "instructions.md"
        ),
    )


CUA_AGENT_DEFINITION = load_agent_definition()
