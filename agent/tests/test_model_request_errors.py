from __future__ import annotations

import asyncio
import io
import urllib.error
from collections.abc import Mapping
from typing import Any

import pytest

from cua_agent import AgentEvent, CuaAgent, InvocationRequest, InvocationStatus
from cua_agent.contracts import JsonValue
from cua_agent.openai_compatible import OpenAICompatibleConfig, OpenAICompatibleModelClient


class IdleRuntime:
    async def __aenter__(self) -> IdleRuntime:
        return self

    async def __aexit__(self, *_args: object) -> None:
        return None

    async def request(
        self, _method: str, _payload: Mapping[str, JsonValue], **_kwargs: Any,
    ) -> None:
        raise AssertionError("模型请求失败时不应调用 Runtime")


def _http_error(status: int) -> urllib.error.HTTPError:
    return urllib.error.HTTPError(
        "https://example.test/v1/chat/completions", status, "failure", None,
        io.BytesIO(b'{"error":{"message":"private response detail"}}'),
    )


@pytest.mark.parametrize(
    ("fault", "expected"),
    [
        (
            urllib.error.URLError(ConnectionRefusedError(10061, "connection refused")),
            "模型请求失败，请检查模型服务地址、网络连接及服务运行状态。",
        ),
        (
            TimeoutError("connection timed out"),
            "模型请求失败，请检查模型服务地址、网络连接及服务运行状态。",
        ),
        (
            _http_error(404),
            "模型请求失败，模型不存在或无法访问，请检查模型名称及模型服务地址。",
        ),
        (
            _http_error(413),
            "模型请求失败，请求内容超过服务端限制，请检查请求内容大小或模型服务限制。",
        ),
        (
            _http_error(429),
            "模型请求受限，当前请求频率或可用额度已达到服务限制，请稍后重试。",
        ),
        (
            _http_error(500),
            "模型请求失败，暂时无法确定失败原因，请检查模型服务状态。",
        ),
    ],
)
def test_model_request_failure_hides_diagnostics_from_public_result(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    fault: Exception,
    expected: str,
) -> None:
    def reject(*_args: object, **_kwargs: object) -> None:
        raise fault

    monkeypatch.setattr("urllib.request.urlopen", reject)
    model = OpenAICompatibleModelClient(
        OpenAICompatibleConfig("https://example.test/v1", "model", "secret")
    )
    events: list[AgentEvent] = []
    agent = CuaAgent(model, lambda: IdleRuntime())  # type: ignore[arg-type]

    result = asyncio.run(agent.invoke(InvocationRequest("执行电脑操作"), event_sink=events.append))

    assert result.status is InvocationStatus.FAILED
    assert result.reply == expected
    assert result.error == expected
    failed_events = [event for event in events if event.type == "failed"]
    assert [event.message for event in failed_events] == [expected]
    assert failed_events[0].data is None
    assert "Agent model" not in str(result.to_dict())
    assert "private response detail" not in str(result.to_dict())
    assert str(fault) in caplog.text
    if isinstance(fault, urllib.error.HTTPError):
        assert "private response detail" in caplog.text


def test_non_model_failure_keeps_existing_error_handling() -> None:
    class BrokenRuntime(IdleRuntime):
        async def __aenter__(self) -> IdleRuntime:
            raise RuntimeError("runtime setup failed")

    model = OpenAICompatibleModelClient(
        OpenAICompatibleConfig("https://example.test/v1", "model", "secret")
    )
    agent = CuaAgent(model, lambda: BrokenRuntime())  # type: ignore[arg-type]

    result = asyncio.run(agent.invoke(InvocationRequest("执行电脑操作")))

    assert result.status is InvocationStatus.FAILED
    assert result.reply == "runtime setup failed"


@pytest.mark.parametrize(
    ("fault", "expected"),
    [
        (
            urllib.error.URLError("connection refused"),
            "Model request failed. Check the model service address, network connection, "
            "and service status.",
        ),
        (
            _http_error(404),
            "Model request failed. The model was not found or is inaccessible. "
            "Check its name and service address.",
        ),
        (
            _http_error(413),
            "Model request failed. The request exceeds the server limit. "
            "Check its size or the model service limit.",
        ),
        (_http_error(429), "Model request is limited by rate or quota. Please try again later."),
        (
            _http_error(500),
            "Model request failed. The cause is unknown. Check the model service status.",
        ),
    ],
)
def test_english_model_error_reaches_reply_and_failed_event(
    monkeypatch: pytest.MonkeyPatch, fault: Exception, expected: str,
) -> None:
    def reject(*_args: object, **_kwargs: object) -> None:
        raise fault

    monkeypatch.setattr("urllib.request.urlopen", reject)
    model = OpenAICompatibleModelClient(
        OpenAICompatibleConfig("https://example.test/v1", "model", "secret", language="en-US")
    )
    events: list[AgentEvent] = []
    result = asyncio.run(CuaAgent(model, lambda: IdleRuntime()).invoke(  # type: ignore[arg-type]
        InvocationRequest("Use the computer"), event_sink=events.append,
    ))

    assert result.status is InvocationStatus.FAILED
    assert result.reply == expected
    assert result.error == expected
    assert [event.message for event in events if event.type == "failed"] == [expected]
    assert "Agent model" not in str(result.to_dict())
