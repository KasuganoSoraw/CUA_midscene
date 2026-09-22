from cua_agent import CUA_AGENT_DEFINITION, load_agent_definition


def test_definition_is_loaded_from_packaged_markdown() -> None:
    assert CUA_AGENT_DEFINITION.name == "Computer-Use"
    assert CUA_AGENT_DEFINITION.invocation_mode == "stateless-task"
    assert "完整任务" in CUA_AGENT_DEFINITION.description
    assert "Recorded Skill" in CUA_AGENT_DEFINITION.instructions
    assert "不输出隐藏推理、思维链或长篇分析" in CUA_AGENT_DEFINITION.instructions
    assert "发起单个或一组 Tool call 前，必须先" in CUA_AGENT_DEFINITION.instructions
    assert "可以在同一响应中调用" in CUA_AGENT_DEFINITION.instructions
    assert "不要仅为了插入说明而拆散合理的一组 Tool call" in CUA_AGENT_DEFINITION.instructions
    assert "同一模型响应最多调用一个 Tool" not in CUA_AGENT_DEFINITION.instructions
    assert "catalog 未命中后不得询问" in CUA_AGENT_DEFINITION.instructions
    assert "不属于信息不足" in CUA_AGENT_DEFINITION.instructions
    assert "最终回复必须包含 Tool 返回的 `url`" in CUA_AGENT_DEFINITION.instructions
    assert "最终回复必须原样包含该执行报告路径" in CUA_AGENT_DEFINITION.instructions
    assert "不要用它探测、确认或重复验证结果" in CUA_AGENT_DEFINITION.instructions
    assert "Workbench 不是执行结果页面" in CUA_AGENT_DEFINITION.instructions
    assert "调用方任务所使用的语言" in CUA_AGENT_DEFINITION.instructions
    assert "简短中文" not in CUA_AGENT_DEFINITION.instructions
    assert "中文回复" not in CUA_AGENT_DEFINITION.instructions
    for irrelevant_concept in (
        "GDEClaw",
        "Main Agent",
        "Host Adapter",
        "Midscene",
        "Runtime",
        "Session",
        "scheduler",
        "npm install",
    ):
        assert irrelevant_concept not in CUA_AGENT_DEFINITION.instructions
    assert "仅用于录制新流程、复核或校准已录制任务" in CUA_AGENT_DEFINITION.description


def test_loading_definition_does_not_share_mutable_invocation_state() -> None:
    first = load_agent_definition()
    second = load_agent_definition()

    assert first == second
    assert first is not second
    assert not hasattr(first, "messages")
    assert not hasattr(first, "session")
