from __future__ import annotations

import json

from cua_agent.model import ModelMessage
from cua_agent.openai_compatible import (
    OpenAICompatibleConfig,
    _message_payload,
    _model_response_from,
)


def test_model_config_builds_chat_completions_url_without_exposing_key() -> None:
    config = OpenAICompatibleConfig(
        base_url="https://example.test/v1/",
        model="test-model",
        api_key="secret-value",
    )

    assert config.chat_completions_url == "https://example.test/v1/chat/completions"
    assert "secret-value" not in repr(config)


def test_adapter_maps_assistant_tool_calls_and_tool_results() -> None:
    response = _model_response_from(
        {
            "tool_calls": [
                {
                    "id": "call-1",
                    "function": {
                        "name": "cua_catalog",
                        "arguments": json.dumps({"action": "list-scenes"}),
                    },
                }
            ]
        }
    )

    assert response.tool_calls[0].name == "cua_catalog"
    assert response.tool_calls[0].arguments == {"action": "list-scenes"}
    assert _message_payload(
        ModelMessage(role="tool", content='{"scenes":[]}', tool_call_id="call-1")
    ) == {
        "role": "tool",
        "content": '{"scenes":[]}',
        "tool_call_id": "call-1",
    }


def test_adapter_parses_structured_needs_input_and_accepts_plain_final_text() -> None:
    needs_input = _model_response_from(
        {"content": '{"status":"needs-input","reply":"请提供目标系统名称"}'}
    )
    plain = _model_response_from({"content": "任务完成"})

    assert needs_input.final_status == "needs-input"
    assert needs_input.content == "请提供目标系统名称"
    assert plain.final_status == "completed"
    assert plain.content == "任务完成"
