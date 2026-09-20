from cua_agent import CUA_AGENT_DEFINITION, load_agent_definition


def test_definition_is_loaded_from_packaged_markdown() -> None:
    assert CUA_AGENT_DEFINITION.name == "Computer-Use"
    assert CUA_AGENT_DEFINITION.invocation_mode == "stateless-task"
    assert "完整任务" in CUA_AGENT_DEFINITION.description
    assert "Recorded Skill" in CUA_AGENT_DEFINITION.instructions
    assert "薄模型 Tool Calling loop" in CUA_AGENT_DEFINITION.instructions
    assert "不输出隐藏推理、思维链或长篇分析" in CUA_AGENT_DEFINITION.instructions
    assert "不要机械说明每一次 Tool 调用" in CUA_AGENT_DEFINITION.instructions
    assert "最终回复必须包含 Tool 返回的 `url`" in CUA_AGENT_DEFINITION.instructions
    assert "最终回复必须包含该 Midscene HTML 报告路径" in CUA_AGENT_DEFINITION.instructions
    assert "不得通过再次执行相同或相似 GUI 操作" in CUA_AGENT_DEFINITION.instructions
    assert "Workbench 不是 `cua_execute` 的执行结果页面" in CUA_AGENT_DEFINITION.instructions
    assert "仅用于录制新流程、复核或校准已录制任务" in CUA_AGENT_DEFINITION.description


def test_loading_definition_does_not_share_mutable_invocation_state() -> None:
    first = load_agent_definition()
    second = load_agent_definition()

    assert first == second
    assert first is not second
    assert not hasattr(first, "messages")
    assert not hasattr(first, "session")
