"""CUA Agent 的单次 JSON/JSONL 进程入口。"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path
from typing import TextIO

from .contracts import InvocationRequest, JsonValue
from .events import AgentEvent
from .openai_compatible import OpenAICompatibleConfig, OpenAICompatibleModelClient
from .runner import CuaAgent
from .runtime_client import JsonlRuntimeClient, RuntimeProcessConfig


def _required_env(name: str) -> str:
    value = os.environ.get(name)
    if value is None or not value.strip():
        raise RuntimeError(f"缺少运行配置 {name}")
    return value.strip()


def _positive_int_env(name: str, default: int) -> int:
    raw = os.environ.get(name, str(default))
    try:
        value = int(raw)
    except ValueError as error:
        raise RuntimeError(f"{name} 必须是整数：{raw}") from error
    if value <= 0:
        raise RuntimeError(f"{name} 必须大于 0")
    return value


def build_agent_from_env() -> CuaAgent:
    runtime_config = RuntimeProcessConfig.from_runtime(
        Path(
            os.environ.get("CUA_AGENT_JS_RUNTIME_EXECUTABLE")
            or _required_env("CUA_AGENT_NODE_EXECUTABLE")
        ),
        Path(_required_env("CUA_AGENT_RUNTIME_BRIDGE")),
        cwd=str(Path(_required_env("CUA_AGENT_RUNTIME_BRIDGE")).resolve().parent),
    )
    model_client = OpenAICompatibleModelClient(OpenAICompatibleConfig.from_env())
    return CuaAgent(
        model_client,
        lambda: JsonlRuntimeClient(runtime_config),
        data_root=os.environ.get("CUA_DATA_ROOT"),
        max_turns=_positive_int_env("CUA_AGENT_MAX_TURNS", 8),
    )


def _frame(kind: str, key: str, value: dict[str, JsonValue]) -> str:
    return json.dumps({"type": kind, key: value}, ensure_ascii=False)


async def invoke_from_stream(
    input_stream: TextIO,
    output_stream: TextIO,
    *,
    agent: CuaAgent | None = None,
) -> int:
    raw_request = input_stream.read()
    try:
        value: object = json.loads(raw_request)
        if not isinstance(value, dict):
            raise ValueError("invocation request 必须是 JSON object")
        task = value.get("task")
        invocation_id = value.get("invocationId")
        if not isinstance(task, str):
            raise ValueError("invocation task 必须是字符串")
        if invocation_id is not None and not isinstance(invocation_id, str):
            raise ValueError("invocationId 必须是字符串")
        request = InvocationRequest(
            task=task,
            invocation_id=invocation_id,
        )
        active_agent = agent or build_agent_from_env()

        def emit(event: AgentEvent) -> None:
            output_stream.write(_frame("event", "event", event.to_dict()) + "\n")
            output_stream.flush()

        result = await active_agent.invoke(request, event_sink=emit)
        output_stream.write(_frame("result", "result", result.to_dict()) + "\n")
        output_stream.flush()
        return 0
    except Exception as error:
        message = str(error) or error.__class__.__name__
        output_stream.write(
            _frame("error", "error", {"code": "AGENT_STARTUP_FAILED", "message": message})
            + "\n"
        )
        output_stream.flush()
        print(message, file=sys.stderr)
        return 1


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(prog="cua-agent")
    result.add_argument("command", choices=("invoke",))
    return result


def main(argv: list[str] | None = None) -> int:
    parser().parse_args(argv)
    return asyncio.run(invoke_from_stream(sys.stdin, sys.stdout))
