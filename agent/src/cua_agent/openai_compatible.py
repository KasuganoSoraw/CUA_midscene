"""使用 OpenAI-compatible Chat Completions 的实际模型 adapter。"""

from __future__ import annotations

import asyncio
import json
import os
import ssl
import urllib.error
import urllib.request
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import cast

from .contracts import JsonValue
from .model import (
    ModelClient,
    ModelContentDelta,
    ModelMessage,
    ModelResponse,
    ModelStreamComplete,
    ModelStreamItem,
    ModelToolCall,
)
from .tools import ToolDefinition


class ModelConfigurationError(RuntimeError):
    pass


class ModelRequestError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class OpenAICompatibleConfig:
    base_url: str
    model: str
    api_key: str = field(repr=False)
    timeout_seconds: float = 120.0
    verify_tls: bool = True

    def __post_init__(self) -> None:
        if not self.base_url.strip():
            raise ModelConfigurationError("Agent model base URL 不能为空")
        if not self.model.strip():
            raise ModelConfigurationError("Agent model name 不能为空")
        if not self.api_key.strip():
            raise ModelConfigurationError("Agent model API key 不能为空")
        if self.timeout_seconds <= 0:
            raise ModelConfigurationError("Agent model timeout 必须大于 0")

    @classmethod
    def from_env(cls) -> OpenAICompatibleConfig:
        def required(primary: str, fallback: str) -> str:
            value = os.environ.get(primary) or os.environ.get(fallback)
            if value is None or not value.strip():
                raise ModelConfigurationError(f"缺少 {primary}（备用环境变量 {fallback} 也未设置）")
            return value.strip()

        raw_timeout = os.environ.get("CUA_AGENT_MODEL_TIMEOUT_SECONDS", "120")
        try:
            timeout = float(raw_timeout)
        except ValueError as error:
            raise ModelConfigurationError(
                f"CUA_AGENT_MODEL_TIMEOUT_SECONDS 必须是数字：{raw_timeout}"
            ) from error
        return cls(
            base_url=required("CUA_AGENT_MODEL_BASE_URL", "MIDSCENE_MODEL_BASE_URL"),
            model=required("CUA_AGENT_MODEL_NAME", "MIDSCENE_MODEL_NAME"),
            api_key=required("CUA_AGENT_MODEL_API_KEY", "MIDSCENE_MODEL_API_KEY"),
            timeout_seconds=timeout,
            verify_tls=_boolean_env("CUA_AGENT_MODEL_TLS_VERIFY", default=True),
        )

    @property
    def chat_completions_url(self) -> str:
        base = self.base_url.rstrip("/")
        return base if base.endswith("/chat/completions") else f"{base}/chat/completions"


class OpenAICompatibleModelClient(ModelClient):
    def __init__(self, config: OpenAICompatibleConfig) -> None:
        self._config = config

    async def complete(
        self,
        messages: tuple[ModelMessage, ...],
        tools: tuple[ToolDefinition, ...],
    ) -> ModelResponse:
        result: ModelResponse | None = None
        async for item in self.stream(messages, tools):
            if isinstance(item, ModelStreamComplete):
                result = item.response
        if result is None:
            raise ModelRequestError("Agent model 流缺少完整响应")
        return result

    async def stream(
        self,
        messages: tuple[ModelMessage, ...],
        tools: tuple[ToolDefinition, ...],
    ) -> AsyncIterator[ModelStreamItem]:
        payload: dict[str, JsonValue] = {
            "model": self._config.model,
            "messages": [_message_payload(message) for message in messages],
            "stream": True,
        }
        if tools:
            payload["tools"] = [_tool_payload(tool) for tool in tools]
            payload["tool_choice"] = "auto"
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(
            self._config.chat_completions_url,
            data=body,
            headers={
                "Authorization": f"Bearer {self._config.api_key}",
                "Content-Type": "application/json",
                "Accept": "text/event-stream",
            },
            method="POST",
        )
        response: object | None = None
        assembler = _StreamAssembler()
        try:
            async with asyncio.timeout(self._config.timeout_seconds):
                response = await asyncio.to_thread(
                    urllib.request.urlopen,
                    request,
                    timeout=self._config.timeout_seconds,
                    context=_tls_context(self._config.verify_tls),
                )
                data_lines: list[str] = []
                while True:
                    raw_line = await asyncio.to_thread(response.readline)  # type: ignore[attr-defined]
                    if not raw_line:
                        break
                    line = raw_line.decode("utf-8").rstrip("\r\n")
                    if line.startswith("data:"):
                        data_lines.append(line[5:].lstrip())
                        continue
                    if line:
                        continue
                    if not data_lines:
                        continue
                    data = "\n".join(data_lines)
                    data_lines.clear()
                    if data == "[DONE]":
                        yield ModelStreamComplete(assembler.complete())
                        return
                    for delta in assembler.accept(data):
                        yield delta
                if data_lines:
                    data = "\n".join(data_lines)
                    if data == "[DONE]":
                        yield ModelStreamComplete(assembler.complete())
                        return
                    for delta in assembler.accept(data):
                        yield delta
                raise ValueError("流缺少 [DONE] 终止帧")
        except urllib.error.HTTPError as error:
            response_body = error.read().decode("utf-8", errors="replace")
            raise ModelRequestError(
                f"Agent model HTTP {error.code}：{response_body[:2000]}"
            ) from error
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            raise ModelRequestError(f"Agent model 请求失败：{error}") from error
        except (ValueError, KeyError, TypeError, json.JSONDecodeError) as error:
            raise ModelRequestError(f"Agent model 返回了无效响应：{error}") from error
        finally:
            if response is not None:
                response.close()  # type: ignore[attr-defined]


class _StreamAssembler:
    def __init__(self) -> None:
        self.content: list[str] = []
        self.calls: dict[int, dict[str, str]] = {}

    def accept(self, data: str) -> list[ModelContentDelta]:
        payload: object = json.loads(data)
        if not isinstance(payload, dict):
            raise ValueError("SSE data 必须是 JSON object")
        if "error" in payload:
            error = payload["error"]
            message = error.get("message") if isinstance(error, dict) else error
            raise ModelRequestError(f"Agent model 流错误：{str(message)[:500]}")
        choices = payload.get("choices")
        if not isinstance(choices, list):
            raise ValueError("SSE data 缺少 choice")
        if not choices:
            return []
        if not isinstance(choices[0], dict):
            raise ValueError("SSE choice 必须是 object")
        delta = choices[0].get("delta")
        if not isinstance(delta, dict):
            raise ValueError("SSE choice 缺少 delta")
        emitted: list[ModelContentDelta] = []
        content = delta.get("content")
        if isinstance(content, str) and content:
            self.content.append(content)
            emitted.append(ModelContentDelta(content))
        raw_calls = delta.get("tool_calls")
        if raw_calls is not None:
            if not isinstance(raw_calls, list):
                raise ValueError("SSE tool_calls 必须是数组")
            for raw_call in raw_calls:
                if not isinstance(raw_call, dict) or not isinstance(raw_call.get("index"), int):
                    raise ValueError("SSE tool_call 缺少 index")
                call = self.calls.setdefault(
                    raw_call["index"], {"id": "", "name": "", "arguments": ""}
                )
                if isinstance(raw_call.get("id"), str):
                    call["id"] += raw_call["id"]
                function = raw_call.get("function")
                if isinstance(function, dict):
                    for key in ("name", "arguments"):
                        part = function.get(key)
                        if isinstance(part, str):
                            call[key] += part
        return emitted

    def complete(self) -> ModelResponse:
        message: dict[str, object] = {"content": "".join(self.content)}
        if self.calls:
            message["tool_calls"] = [
                {
                    "id": call["id"],
                    "function": {"name": call["name"], "arguments": call["arguments"] or "{}"},
                }
                for _, call in sorted(self.calls.items())
            ]
        return _model_response_from(message)


def _boolean_env(name: str, *, default: bool) -> bool:
    raw_value = os.environ.get(name)
    if raw_value is None or not raw_value.strip():
        return default
    normalized = raw_value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise ModelConfigurationError(f"{name} 必须是 true 或 false：{raw_value}")


def _tls_context(verify_tls: bool) -> ssl.SSLContext | None:
    if verify_tls:
        return None
    context = ssl.create_default_context()
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE
    return context


def _message_payload(message: ModelMessage) -> dict[str, JsonValue]:
    payload: dict[str, JsonValue] = {"role": message.role}
    if message.content is not None:
        payload["content"] = message.content
    if message.tool_call_id is not None:
        payload["tool_call_id"] = message.tool_call_id
    if message.tool_calls:
        payload["tool_calls"] = [
            {
                "id": call.call_id,
                "type": "function",
                "function": {
                    "name": call.name,
                    "arguments": json.dumps(call.arguments, ensure_ascii=False),
                },
            }
            for call in message.tool_calls
        ]
    return payload


def _tool_payload(tool: ToolDefinition) -> dict[str, JsonValue]:
    return {
        "type": "function",
        "function": {
            "name": tool.name,
            "description": tool.description,
            "parameters": tool.input_schema,
        },
    }


def _model_response_from(message: dict[str, object]) -> ModelResponse:
    raw_calls = message.get("tool_calls")
    if isinstance(raw_calls, list) and raw_calls:
        calls: list[ModelToolCall] = []
        for raw_call in raw_calls:
            if not isinstance(raw_call, dict):
                raise ValueError("tool_call 必须是 object")
            function = raw_call.get("function")
            if not isinstance(function, dict):
                raise ValueError("tool_call 缺少 function")
            arguments = json.loads(str(function.get("arguments", "{}")))
            if not isinstance(arguments, dict):
                raise ValueError("tool_call arguments 必须是 JSON object")
            calls.append(
                ModelToolCall(
                    call_id=str(raw_call.get("id", "")).strip(),
                    name=str(function.get("name", "")).strip(),
                    arguments=cast(dict[str, JsonValue], arguments),
                )
            )
        if any(not call.call_id or not call.name for call in calls):
            raise ValueError("tool_call id 和 name 不能为空")
        content = message.get("content")
        return ModelResponse(
            content=content if isinstance(content, str) and content.strip() else None,
            tool_calls=tuple(calls),
        )

    content = message.get("content")
    if not isinstance(content, str) or not content.strip():
        raise ValueError("最终模型响应缺少 content")
    return ModelResponse(content=content.strip())
