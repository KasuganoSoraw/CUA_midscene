"""使用 OpenAI-compatible Chat Completions 的实际模型 adapter。"""

from __future__ import annotations

import asyncio
import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import cast

from .contracts import JsonValue
from .model import FinalStatus, ModelClient, ModelMessage, ModelResponse, ModelToolCall
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
                raise ModelConfigurationError(f"缺少 {primary}（也未提供兼容回退 {fallback}）")
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
        return await asyncio.to_thread(self._complete_sync, messages, tools)

    def _complete_sync(
        self,
        messages: tuple[ModelMessage, ...],
        tools: tuple[ToolDefinition, ...],
    ) -> ModelResponse:
        body = json.dumps(
            {
                "model": self._config.model,
                "messages": [_message_payload(message) for message in messages],
                "tools": [_tool_payload(tool) for tool in tools],
                "tool_choice": "auto",
            },
            ensure_ascii=False,
        ).encode("utf-8")
        request = urllib.request.Request(
            self._config.chat_completions_url,
            data=body,
            headers={
                "Authorization": f"Bearer {self._config.api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self._config.timeout_seconds) as response:
                raw_response = response.read().decode("utf-8")
        except urllib.error.HTTPError as error:
            response_body = error.read().decode("utf-8", errors="replace")
            raise ModelRequestError(
                f"Agent model HTTP {error.code}：{response_body[:2000]}"
            ) from error
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            raise ModelRequestError(f"Agent model 请求失败：{error}") from error

        try:
            payload: object = json.loads(raw_response)
            message = _first_message(payload)
            return _model_response_from(message)
        except (ValueError, KeyError, TypeError, json.JSONDecodeError) as error:
            raise ModelRequestError(f"Agent model 返回了无效响应：{error}") from error


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


def _first_message(payload: object) -> dict[str, object]:
    if not isinstance(payload, dict):
        raise ValueError("response 必须是 JSON object")
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        raise ValueError("response 缺少 choices")
    first = choices[0]
    if not isinstance(first, dict) or not isinstance(first.get("message"), dict):
        raise ValueError("response 缺少 choice.message")
    return cast(dict[str, object], first["message"])


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
        return ModelResponse(tool_calls=tuple(calls))

    content = message.get("content")
    if not isinstance(content, str) or not content.strip():
        raise ValueError("最终模型响应缺少 content")
    status, reply = _parse_final_content(content)
    return ModelResponse(content=reply, final_status=status)


def _parse_final_content(content: str) -> tuple[FinalStatus, str]:
    try:
        value: object = json.loads(content)
    except json.JSONDecodeError:
        return "completed", content.strip()
    if not isinstance(value, dict):
        return "completed", content.strip()
    status = value.get("status")
    reply = value.get("reply")
    if (
        status not in ("completed", "needs-input")
        or not isinstance(reply, str)
        or not reply.strip()
    ):
        return "completed", content.strip()
    return cast(FinalStatus, status), reply.strip()
