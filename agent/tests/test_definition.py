from cua_agent import CUA_AGENT_DEFINITION, load_agent_definition


def test_definition_is_loaded_from_packaged_markdown() -> None:
    assert CUA_AGENT_DEFINITION.name == "Computer-Use"
    assert CUA_AGENT_DEFINITION.invocation_mode == "stateless-task"
    assert "完整任务" in CUA_AGENT_DEFINITION.description
    assert "Recorded Skill" in CUA_AGENT_DEFINITION.instructions
    assert "薄模型 Tool Calling loop" in CUA_AGENT_DEFINITION.instructions


def test_loading_definition_does_not_share_mutable_invocation_state() -> None:
    first = load_agent_definition()
    second = load_agent_definition()

    assert first == second
    assert first is not second
    assert not hasattr(first, "messages")
    assert not hasattr(first, "session")
