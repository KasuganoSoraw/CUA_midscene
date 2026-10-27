from importlib.resources import files

from cua_agent import CUA_AGENT_DEFINITION, load_agent_definition


def test_execution_definition_is_loaded_from_packaged_markdown() -> None:
    definition = CUA_AGENT_DEFINITION
    assert definition.name == "Computer-Use"
    assert definition.invocation_mode == "stateless-task"
    assert "完整任务" in definition.description
    instructions = definition.instructions
    for rule in (
        "不负责选择、发现或管理 Skill", "每次调用都是独立任务", "仅提供 `cua_execute`",
        "必须原样使用调用方确认的参数", "不得更换 Skill", "使用 `strategy=freeform`",
        "不通过 Tool 打开、录制、复核、校准或调试 Workbench", "不调用 Catalog",
        "最终回复必须原样包含该执行报告路径", "不得编造路径", "不得用于探测或确认",
        "调用方任务所使用的语言", "由调用方消费和分析", "不自动重试",
    ):
        assert rule in instructions
    assert "cua_workbench" not in instructions
    assert "先用 `cua_catalog`" not in instructions
    assert "合法 CUA 标记" in definition.description


def test_loading_definition_does_not_share_mutable_invocation_state() -> None:
    first = load_agent_definition()
    second = load_agent_definition()
    assert first == second == CUA_AGENT_DEFINITION
    assert first is not second
    assert not hasattr(first, "messages")
    assert not hasattr(first, "session")


def test_freeform_only_definition_describes_available_capabilities() -> None:
    definition = load_agent_definition(freeform_only=True)
    assert "自然语言" in definition.description
    assert "仅提供 `cua_execute`" in definition.instructions
    assert "不提供录制" in definition.instructions
    assert "最终回复必须原样包含该执行报告路径" in definition.instructions


def test_packaged_definitions_only_include_execution_instructions() -> None:
    resources = files("cua_agent.definition")
    assert {item.name for item in resources.iterdir() if item.name.endswith(".md")} == {
        "description.md", "instructions.md", "freeform-instructions.md",
    }
