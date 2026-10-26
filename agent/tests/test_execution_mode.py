import asyncio
import io
import json

import pytest
from test_runner import FakeModelClient, FakeRuntimeClient

from cua_agent import CuaAgent, InvocationRequest, InvocationStatus, ModelResponse, ModelToolCall
from cua_agent.cli import invoke_from_stream
from cua_agent.configuration import resolve_tool_mode
from cua_agent.contracts import JsonValue
from cua_agent.tools import create_cua_tool_registry


def test_execution_schema_preserves_all_strategies_without_catalog_or_workbench() -> None:
    registry = create_cua_tool_registry(None, tool_mode="execute")
    assert [tool.name for tool in registry.definitions] == ["cua_execute"]
    branches = registry.definitions[0].input_schema["oneOf"]
    assert [branch["properties"]["strategy"]["const"] for branch in branches] == [
        "replay", "guided", "freeform",
    ]


@pytest.mark.parametrize("strategy", ["replay", "guided", "freeform"])
def test_bound_execution_runs_directly_without_catalog(strategy: str) -> None:
    parameters: dict[str, JsonValue] = {"strategy": strategy, "goal": "打开系统"}
    if strategy != "freeform":
        parameters = {"strategy": strategy, "skillName": "alarm-query",
                      "inputs": {"target": "device-1"}}
    model = FakeModelClient([
        ModelResponse(tool_calls=(ModelToolCall("run", "cua_execute", parameters),)),
        ModelResponse(content="已完成。C:/runs/execution-report.html"),
    ])
    runtime = FakeRuntimeClient()
    request = InvocationRequest("执行已经选定的任务", execution=parameters)
    result = asyncio.run(CuaAgent(model, lambda: runtime).invoke(request))
    assert result.status is InvocationStatus.COMPLETED
    assert runtime.calls == [("execute", parameters)]
    assert [tool.name for tool in model.tool_sets[0]] == ["cua_execute"]
    assert model.tool_sets[1] == ()
    assert "cua_workbench" not in (model.calls[1][0].content or "")


def test_plain_task_is_freeform_and_cannot_invent_recorded_binding() -> None:
    parameters = {"strategy": "freeform", "goal": "打开 Chrome"}
    model = FakeModelClient([
        ModelResponse(tool_calls=(ModelToolCall("run", "cua_execute", parameters),)),
        ModelResponse(content="已完成。C:/runs/execution-report.html"),
    ])
    runtime = FakeRuntimeClient()
    result = asyncio.run(CuaAgent(model, lambda: runtime).invoke(InvocationRequest("打开 Chrome")))
    assert result.status is InvocationStatus.COMPLETED
    assert runtime.calls == [("execute", parameters)]


def test_skill_binding_defaults_to_guided_and_terminal_execution_ignores_extra_tools() -> None:
    request = InvocationRequest(
        "执行告警查询", execution={"skillName": "alarm-query", "inputs": {}},
    )
    arguments = {"strategy": "guided", "skillName": "alarm-query", "inputs": {}}
    assert request.execution == arguments
    model = FakeModelClient([
        ModelResponse(tool_calls=(
            ModelToolCall("run", "cua_execute", arguments),
            ModelToolCall("extra", "cua_catalog", {"action": "list-scenes"}),
        )),
        ModelResponse(content="已完成。C:/runs/execution-report.html"),
    ])
    runtime = FakeRuntimeClient()
    result = asyncio.run(CuaAgent(model, lambda: runtime).invoke(request))
    assert result.status is InvocationStatus.COMPLETED
    assert runtime.calls == [("execute", arguments)]
    assert len(result.tool_calls) == 1
    assert model.tool_sets[1] == ()


@pytest.mark.parametrize("field,value", [
    ("skillName", "other-skill"), ("scene", "other"), ("strategy", "guided"),
    ("inputs", {"target": "other"}), ("skillRoot", "C:/skills"),
])
def test_model_cannot_change_bound_task_inputs_or_strategy(field: str, value: JsonValue) -> None:
    bound: dict[str, JsonValue] = {"strategy": "replay", "skillName": "bound-skill"}
    altered = {**bound, field: value}
    model = FakeModelClient([ModelResponse(tool_calls=(
        ModelToolCall("run", "cua_execute", altered),
    ))])
    runtime = FakeRuntimeClient()
    result = asyncio.run(CuaAgent(model, lambda: runtime).invoke(
        InvocationRequest("执行指定任务", execution=bound),
    ))
    assert result.status is InvocationStatus.FAILED
    assert runtime.calls == []
    assert len(model.calls) == 1


@pytest.mark.parametrize("tool", ["cua_catalog", "cua_workbench"])
def test_execution_mode_rejects_unavailable_model_tools(tool: str) -> None:
    model = FakeModelClient([ModelResponse(tool_calls=(ModelToolCall("bad", tool, {}),))])
    runtime = FakeRuntimeClient()
    result = asyncio.run(CuaAgent(model, lambda: runtime).invoke(InvocationRequest("执行任务")))
    assert result.status is InvocationStatus.FAILED
    assert "无法识别" in result.error
    assert runtime.calls == []


def test_execution_registry_checks_fields_without_relying_on_model_schema() -> None:
    registry = create_cua_tool_registry(None, tool_mode="execute")
    with pytest.raises(ValueError, match="不支持的字段"):
        asyncio.run(registry.call("cua_execute", {
            "strategy": "freeform", "goal": "打开系统", "skillRoot": "C:/skills",
        }))


@pytest.mark.parametrize("execution", [
    {"strategy": "replay"},
    {"strategy": "replay", "skillName": "../t"},
    {"strategy": "replay", "scene": "s", "task": "C:\\tasks\\t"},
    {"strategy": "freeform", "goal": "打开系统", "skillRoot": "C:/skills"},
    {"strategy": "freeform", "goal": "打开系统", "dataRoot": "C:/data"},
    {"strategy": "replay", "skillName": "bound-skill", "inputs": {"x": 1}},
])
def test_invocation_binding_rejects_incomplete_or_path_based_requests(execution) -> None:
    with pytest.raises(ValueError):
        InvocationRequest("执行任务", execution=execution)


def test_binding_is_copied_and_cli_forwards_it_without_task_discovery() -> None:
    bound: dict[str, JsonValue] = {"strategy": "replay", "skillName": "bound-skill",
                                  "inputs": {"x": "original"}}
    request = InvocationRequest("执行任务", execution=bound)
    bound["inputs"]["x"] = "changed"
    assert request.execution["inputs"] == {"x": "original"}
    model = FakeModelClient([
        ModelResponse(tool_calls=(ModelToolCall("run", "cua_execute", request.execution),)),
        ModelResponse(content="已完成。C:/runs/execution-report.html"),
    ])
    runtime = FakeRuntimeClient()
    output = io.StringIO()
    code = asyncio.run(invoke_from_stream(io.StringIO(json.dumps({
        "task": request.task, "execution": request.execution,
    })), output, agent=CuaAgent(model, lambda: runtime)))
    assert code == 0
    assert runtime.calls == [("execute", request.execution)]


def test_tool_mode_environment_and_explicit_override(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CUA_AGENT_TOOL_MODE", raising=False)
    assert resolve_tool_mode() == "execute"
    monkeypatch.setenv("CUA_AGENT_TOOL_MODE", "discover")
    assert resolve_tool_mode() == "discover"
    assert resolve_tool_mode("execute") == "execute"
    monkeypatch.setenv("CUA_AGENT_TOOL_MODE", "unknown")
    with pytest.raises(ValueError):
        resolve_tool_mode()


def test_explicit_binding_disables_discovery_even_in_discovery_profile() -> None:
    registry = create_cua_tool_registry(None, tool_mode="discover", expected_execution={
        "strategy": "replay", "skillName": "bound-skill",
    })
    assert [tool.name for tool in registry.definitions] == ["cua_execute"]


def test_execution_can_request_required_business_inputs_without_running_tools() -> None:
    model = FakeModelClient([ModelResponse(
        content="请补充需要查询的设备名称", final_status="needs-input",
    )])
    runtime = FakeRuntimeClient()
    result = asyncio.run(CuaAgent(model, lambda: runtime).invoke(InvocationRequest("查询设备")))
    assert result.status is InvocationStatus.NEEDS_INPUT
    assert runtime.calls == []


@pytest.mark.parametrize("mode", ["execute", "discover"])
def test_freeform_only_remains_restricted_for_each_tool_mode(mode) -> None:
    registry = create_cua_tool_registry(None, tool_mode=mode, freeform_only=True)
    assert [tool.name for tool in registry.definitions] == ["cua_execute"]
    assert registry.definitions[0].input_schema["properties"]["strategy"] == {"const": "freeform"}
    model = FakeModelClient([])
    result = asyncio.run(CuaAgent(model, lambda: FakeRuntimeClient(), freeform_only=True).invoke(
        InvocationRequest("执行任务", execution={"strategy": "replay", "skillName": "bound-skill"}),
    ))
    assert result.status is InvocationStatus.FAILED
    assert "freeform_only" in result.error
    assert model.calls == []
