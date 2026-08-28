from __future__ import annotations

import pytest

from cua_agent import InvocationRequest, InvocationResult, InvocationStatus, ToolTrace


def test_invocation_request_normalizes_task_without_history_surface() -> None:
    first = InvocationRequest(task="  打开 Chrome  ", invocation_id=" first ")
    second = InvocationRequest(task="打开记事本", invocation_id="second")

    assert first.task == "打开 Chrome"
    assert first.invocation_id == "first"
    assert second.task == "打开记事本"
    assert not hasattr(first, "messages")
    assert first is not second


@pytest.mark.parametrize("task", ["", "   "])
def test_invocation_request_rejects_empty_task(task: str) -> None:
    with pytest.raises(ValueError, match="非空字符串"):
        InvocationRequest(task=task)


def test_invocation_result_serializes_to_host_contract() -> None:
    result = InvocationResult(
        invocation_id="inv-1",
        status=InvocationStatus.COMPLETED,
        reply="任务完成",
        tool_calls=(
            ToolTrace(
                call_id="call-1",
                tool="cua_execute",
                input={"strategy": "freeform", "goal": "打开 Chrome"},
                status="succeeded",
                output={"runDir": "C:/runs/1"},
            ),
        ),
    )

    assert result.to_dict() == {
        "schemaVersion": "1.0",
        "invocationId": "inv-1",
        "status": "completed",
        "reply": "任务完成",
        "toolCalls": [
            {
                "callId": "call-1",
                "tool": "cua_execute",
                "input": {"strategy": "freeform", "goal": "打开 Chrome"},
                "status": "succeeded",
                "output": {"runDir": "C:/runs/1"},
            }
        ],
    }

