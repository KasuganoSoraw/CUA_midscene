import asyncio
import inspect

import pytest
from test_runner import FakeModelClient, FakeRuntimeClient

from cua_agent import CuaAgent, InvocationRequest, InvocationStatus, ModelResponse, ModelToolCall
from cua_agent.capabilities import resolve_tool_mode
from cua_agent.contracts import JsonValue
from cua_agent.runtime_client import RuntimeCancelledError, RuntimeProgressEvent
from cua_agent.tools import create_cua_tool_registry


@pytest.mark.parametrize("status", ["completed", "cancelled", "failed"])
def test_recording_terminal_preserves_data_without_extra_model_or_tool_calls(status: str) -> None:
    result: dict[str, JsonValue] = {"status": status, "assets": None}
    if status == "completed":
        result["assets"] = {
            "processedLogPath": "C:/录制/log.json", "screenshotsDir": "C:/录制/screenshots",
        }
    if status == "failed":
        result["error"] = "截图提取失败"

    class RecordingRuntime(FakeRuntimeClient):
        async def request(self, method, payload, **_kwargs):
            self.calls.append((method, dict(payload)))
            return result

    async def scenario() -> None:
        runtime = RecordingRuntime()
        model = FakeModelClient([ModelResponse(tool_calls=(
            ModelToolCall("record-1", "cua_record", {"goal": "示教查询"}),
            ModelToolCall("execute-1", "cua_execute", {"strategy": "freeform", "goal": "不得执行"}),
        ))])
        agent = CuaAgent(model, lambda: runtime)
        invocation = await agent.invoke(InvocationRequest("录制查询流程"))
        expected = InvocationStatus.FAILED if status == "failed" else InvocationStatus.COMPLETED
        assert invocation.status is expected
        assert invocation.data == result
        assert len(model.calls) == 1
        assert runtime.calls == [("record", {"goal": "示教查询"})]
        assert len(invocation.tool_calls) == 1

    asyncio.run(scenario())


def test_host_cancellation_is_not_a_user_cancelled_result() -> None:
    class CancelledRuntime(FakeRuntimeClient):
        async def request(self, *_args, **_kwargs):
            raise RuntimeCancelledError("Host 已停止")

    model = FakeModelClient([ModelResponse(tool_calls=(
        ModelToolCall("record-1", "cua_record", {"goal": "录制"}),
    ))])
    agent = CuaAgent(model, lambda: CancelledRuntime(), tool_mode="normal")
    result = asyncio.run(agent.invoke(InvocationRequest("录制流程")))
    assert result.status is InvocationStatus.CANCELLED


def test_shared_environment_mode_and_explicit_api_override(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CUA_AGENT_TOOL_MODE", "normal")
    assert resolve_tool_mode() == "normal"
    tools = create_cua_tool_registry(None).definitions
    assert [tool.name for tool in tools] == ["cua_catalog", "cua_execute", "cua_record"]
    professional = create_cua_tool_registry(None, tool_mode="professional").definitions
    assert tools == professional
    monkeypatch.setenv("CUA_AGENT_TOOL_MODE", "invalid")
    with pytest.raises(ValueError):
        resolve_tool_mode()


def test_python_agent_api_reads_normal_mode_from_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("CUA_AGENT_TOOL_MODE", "normal")
    model = FakeModelClient([ModelResponse(content="请补充操作目标", final_status="needs-input")])
    agent = CuaAgent(model, lambda: FakeRuntimeClient())
    asyncio.run(agent.invoke(InvocationRequest("操作桌面")))
    assert [tool.name for tool in model.tool_sets[0]] == [
        "cua_catalog", "cua_execute", "cua_record",
    ]


def test_record_transport_failure_is_returned_in_structured_data() -> None:
    model = FakeModelClient([ModelResponse(tool_calls=(
        ModelToolCall("record-1", "cua_record", {"goal": "录制查询"}),
    ))])
    agent = CuaAgent(model, lambda: FakeRuntimeClient(fail=True), tool_mode="normal")
    result = asyncio.run(agent.invoke(InvocationRequest("录制查询")))
    assert result.status is InvocationStatus.FAILED
    assert result.data["status"] == "failed"
    assert result.data["assets"] is None
    assert "desktop unavailable" in result.data["error"]


def test_recording_progress_is_forwarded_before_terminal_result() -> None:
    class ProgressRuntime(FakeRuntimeClient):
        async def request(self, method, payload, on_event=None, **_kwargs):
            event = RuntimeProgressEvent("等待用户开始", {"source": "recorder", "phase": "armed"},
                                         "recording.progress")
            delivered = on_event(event)
            if inspect.isawaitable(delivered):
                await delivered
            return {"status": "cancelled", "assets": None}

    model = FakeModelClient([ModelResponse(tool_calls=(
        ModelToolCall("record-1", "cua_record", {"goal": "录制"}),
    ))])
    events = []
    agent = CuaAgent(model, lambda: ProgressRuntime(), tool_mode="normal")
    asyncio.run(agent.invoke(InvocationRequest("录制流程"), event_sink=events.append))
    progress = next(event for event in events if event.type == "recording.progress")
    assert progress.data["phase"] == "armed"
    assert progress.data["tool"] == "cua_record"
    types = [event.type for event in events]
    assert types.index("recording.progress") < types.index("tool.completed")
