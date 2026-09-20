from __future__ import annotations

import asyncio
import io
import json
import ssl
import threading
from urllib.request import Request

import pytest

from cua_agent.model import ModelContentDelta, ModelMessage, ModelStreamComplete
from cua_agent.openai_compatible import (
    ModelConfigurationError,
    ModelRequestError,
    OpenAICompatibleConfig,
    OpenAICompatibleModelClient,
    _message_payload,
    _model_response_from,
    _tls_context,
)


def test_model_config_builds_chat_completions_url_without_exposing_key() -> None:
    config = OpenAICompatibleConfig(
        base_url="https://example.test/v1/",
        model="test-model",
        api_key="secret-value",
    )

    assert config.chat_completions_url == "https://example.test/v1/chat/completions"
    assert "secret-value" not in repr(config)


def test_model_config_can_disable_tls_verification_explicitly(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("CUA_AGENT_MODEL_BASE_URL", "https://example.test/v1")
    monkeypatch.setenv("CUA_AGENT_MODEL_NAME", "test-model")
    monkeypatch.setenv("CUA_AGENT_MODEL_API_KEY", "secret-value")
    monkeypatch.setenv("CUA_AGENT_MODEL_TLS_VERIFY", "false")

    config = OpenAICompatibleConfig.from_env()
    context = _tls_context(config.verify_tls)

    assert config.verify_tls is False
    assert context is not None
    assert context.check_hostname is False
    assert context.verify_mode == ssl.CERT_NONE


def test_model_config_rejects_invalid_tls_verification_value(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("CUA_AGENT_MODEL_BASE_URL", "https://example.test/v1")
    monkeypatch.setenv("CUA_AGENT_MODEL_NAME", "test-model")
    monkeypatch.setenv("CUA_AGENT_MODEL_API_KEY", "secret-value")
    monkeypatch.setenv("CUA_AGENT_MODEL_TLS_VERIFY", "sometimes")

    with pytest.raises(ModelConfigurationError, match="CUA_AGENT_MODEL_TLS_VERIFY"):
        OpenAICompatibleConfig.from_env()


def test_model_config_verifies_tls_by_default() -> None:
    assert (
        OpenAICompatibleConfig(
            base_url="https://example.test/v1",
            model="test-model",
            api_key="secret-value",
        ).verify_tls
        is True
    )
    assert _tls_context(True) is None


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


def _sse(data: object) -> bytes:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n".encode()


def test_stream_assembles_tool_call_fragments_and_visible_content(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    body = b"".join(
        [
            _sse({"choices": [{"delta": {"content": "准备执行"}}]}),
            _sse(
                {
                    "choices": [
                        {
                            "delta": {
                                "tool_calls": [
                                    {
                                        "index": 0,
                                        "id": "call-",
                                        "function": {"name": "cua_", "arguments": '{"action":'},
                                    }
                                ]
                            }
                        }
                    ]
                }
            ),
            _sse(
                {
                    "choices": [
                        {
                            "delta": {
                                "tool_calls": [
                                    {
                                        "index": 0,
                                        "id": "1",
                                        "function": {
                                            "name": "catalog",
                                            "arguments": '"list-scenes"}',
                                        },
                                    }
                                ]
                            }
                        }
                    ]
                }
            ),
            b"data: [DONE]\n\n",
        ]
    )
    monkeypatch.setattr("urllib.request.urlopen", lambda *args, **kwargs: io.BytesIO(body))
    client = OpenAICompatibleModelClient(
        OpenAICompatibleConfig("https://example.test/v1", "model", "secret")
    )

    async def scenario() -> None:
        items = [item async for item in client.stream((ModelMessage("user", "任务"),), ())]
        assert items[0] == ModelContentDelta("准备执行")
        assert isinstance(items[-1], ModelStreamComplete)
        assert items[-1].response.content == "准备执行"
        assert items[-1].response.tool_calls[0].call_id == "call-1"
        assert items[-1].response.tool_calls[0].name == "cua_catalog"
        assert items[-1].response.tool_calls[0].arguments == {"action": "list-scenes"}

    asyncio.run(scenario())


def test_stream_keeps_final_json_as_model_content(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    body = _sse({"choices": [{"delta": {"content": '{"status":"completed",'}}]})
    body += _sse({"choices": [{"delta": {"content": '"reply":"完成"}'}}]})
    body += b"data: [DONE]\n\n"
    monkeypatch.setattr("urllib.request.urlopen", lambda *args, **kwargs: io.BytesIO(body))
    client = OpenAICompatibleModelClient(
        OpenAICompatibleConfig("https://example.test/v1", "model", "secret")
    )

    async def scenario() -> None:
        result = await client.complete((ModelMessage("user", "任务"),), ())
        assert result.content == "完成"

    asyncio.run(scenario())


def test_stream_omits_tool_fields_when_no_tools_are_available(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    body = _sse({"choices": [{"delta": {"content": "任务完成"}}]})
    body += b"data: [DONE]\n\n"
    captured: dict[str, object] = {}

    def urlopen(request: Request, *args: object, **kwargs: object) -> io.BytesIO:
        request_body = request.data
        assert request_body is not None
        captured.update(json.loads(request_body.decode("utf-8")))
        return io.BytesIO(body)

    monkeypatch.setattr("urllib.request.urlopen", urlopen)
    client = OpenAICompatibleModelClient(
        OpenAICompatibleConfig("https://example.test/v1", "model", "secret")
    )

    async def scenario() -> None:
        result = await client.complete((ModelMessage("user", "任务"),), ())
        assert result.content == "任务完成"

    asyncio.run(scenario())
    assert "tools" not in captured
    assert "tool_choice" not in captured


def test_stream_rejects_incomplete_tool_arguments(monkeypatch: pytest.MonkeyPatch) -> None:
    body = (
        _sse(
            {
                "choices": [
                    {
                        "delta": {
                            "tool_calls": [
                                {
                                    "index": 0,
                                    "id": "call-1",
                                    "function": {"name": "cua_catalog", "arguments": "{"},
                                }
                            ]
                        }
                    }
                ]
            }
        )
        + b"data: [DONE]\n\n"
    )
    monkeypatch.setattr("urllib.request.urlopen", lambda *args, **kwargs: io.BytesIO(body))
    client = OpenAICompatibleModelClient(
        OpenAICompatibleConfig("https://example.test/v1", "model", "secret")
    )

    async def scenario() -> None:
        with pytest.raises(ModelRequestError, match="无效响应"):
            await client.complete((ModelMessage("user", "任务"),), ())

    asyncio.run(scenario())


def test_adapter_emits_delta_before_sse_stream_finishes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    release = threading.Event()

    class PausedResponse:
        def __init__(self) -> None:
            self.lines = iter(
                [
                    _sse({"choices": [{"delta": {"content": "正在执行"}}]}).splitlines(
                        keepends=True
                    )[0],
                    b"\n",
                    b"data: [DONE]\n",
                    b"\n",
                ]
            )
            self.index = 0

        def readline(self) -> bytes:
            if self.index == 2:
                release.wait(timeout=2)
            self.index += 1
            return next(self.lines, b"")

        def close(self) -> None:
            release.set()

    monkeypatch.setattr("urllib.request.urlopen", lambda *args, **kwargs: PausedResponse())
    client = OpenAICompatibleModelClient(
        OpenAICompatibleConfig("https://example.test/v1", "model", "secret")
    )

    async def scenario() -> None:
        stream = client.stream((ModelMessage("user", "任务"),), ())
        first = await asyncio.wait_for(anext(stream), timeout=1)
        assert first == ModelContentDelta("正在执行")
        release.set()
        final = await asyncio.wait_for(anext(stream), timeout=1)
        assert isinstance(final, ModelStreamComplete)
        assert final.response.content == "正在执行"

    asyncio.run(scenario())
