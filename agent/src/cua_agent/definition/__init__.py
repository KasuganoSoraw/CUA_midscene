"""从 Python 包内加载唯一 canonical CUA Agent definition。"""

from importlib.resources import files

from ..contracts import AgentDefinition


def _read_text(name: str) -> str:
    return files(__package__).joinpath(name).read_text(encoding="utf-8").strip()


def load_agent_definition() -> AgentDefinition:
    """创建一个不含可变运行状态的新 definition 值。"""

    return AgentDefinition(
        name="Computer-Use",
        invocation_mode="stateless-task",
        description=_read_text("description.md"),
        instructions=_read_text("instructions.md"),
    )


CUA_AGENT_DEFINITION = load_agent_definition()

__all__ = ["CUA_AGENT_DEFINITION", "load_agent_definition"]

