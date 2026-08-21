from __future__ import annotations

import json
import sys
from dataclasses import asdict, is_dataclass
from typing import Any, TextIO


class RecorderError(RuntimeError):
    """可向调用方安全展示的录制错误。"""


def _json_default(value: Any) -> Any:
    if is_dataclass(value):
        return asdict(value)
    raise TypeError(f"无法序列化 {type(value).__name__}")


def write_event(event: str, *, stream: TextIO = sys.stdout, **payload: Any) -> None:
    document = {"event": event, **payload}
    stream.write(json.dumps(document, ensure_ascii=False, default=_json_default) + "\n")
    stream.flush()


def write_diagnostic(message: str, *, stream: TextIO = sys.stderr) -> None:
    stream.write(message.rstrip() + "\n")
    stream.flush()

