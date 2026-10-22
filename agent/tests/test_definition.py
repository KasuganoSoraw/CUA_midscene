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
    assert "不向调用方请求策略确认" in CUA_AGENT_DEFINITION.instructions
    assert "不属于信息不足" in CUA_AGENT_DEFINITION.instructions
    assert "cua_workbench" not in CUA_AGENT_DEFINITION.instructions
    assert "最终回复必须原样包含该执行报告路径" in CUA_AGENT_DEFINITION.instructions
    assert "不要用它探测、确认或重复验证结果" in CUA_AGENT_DEFINITION.instructions
    assert "工作台由产品设置入口打开" in CUA_AGENT_DEFINITION.instructions
    assert "使界面到达目标状态" in CUA_AGENT_DEFINITION.instructions
    assert "由调用方消费和分析" in CUA_AGENT_DEFINITION.instructions
    assert "电脑操作任务即已完成" in CUA_AGENT_DEFINITION.instructions
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
    assert "产品设置入口" in CUA_AGENT_DEFINITION.description


def test_loading_definition_does_not_share_mutable_invocation_state() -> None:
    first = load_agent_definition()
    second = load_agent_definition()

    assert first == second
    assert first is not second
    assert not hasattr(first, "messages")
    assert not hasattr(first, "session")


def test_compatibility_options_share_one_definition() -> None:
    definition = load_agent_definition(freeform_only=True)
    assert "自然语言" in definition.description
    assert "cua_record(goal)" in definition.instructions
    assert "最终回复必须原样包含该执行报告路径" in definition.instructions
    assert definition == CUA_AGENT_DEFINITION
    assert load_agent_definition(tool_mode="normal") == definition
    assert load_agent_definition(tool_mode="professional") == definition


def test_task_lookup_requires_an_explicit_task_name_or_identifier() -> None:
    instructions = load_agent_definition().instructions
    assert "只有明确要求执行一个任务名或提供 task 标识时" in instructions
    assert "两者都直接选择 `freeform`，不要检索任务" in instructions
    assert "不要从业务描述中自行发明任务名" in instructions
    assert "不把“销售报表”当作专业任务名" in instructions
    assert "若只提供任务名，则说明未找到任务并请求补充目标或流程" in instructions
    assert "任务可能已有 Recorded Skill 时" not in instructions


def test_recording_contract_is_part_of_the_shared_definition() -> None:
    instructions = load_agent_definition().instructions
    assert "cua_record(goal)" in instructions
    assert "一次调用等待用户完成或取消，不通过额外工具轮询" in instructions
    assert "不执行刚录下来的流程" in instructions
