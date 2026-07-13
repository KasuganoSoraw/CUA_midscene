from __future__ import annotations

import json
import os
from pathlib import Path
from typing import TypeVar

from pydantic import BaseModel

ModelT = TypeVar("ModelT", bound=BaseModel)


def read_model(path: Path, model: type[ModelT], label: str) -> ModelT:
    try:
        return model.model_validate_json(path.read_text(encoding="utf-8"))
    except Exception as error:
        raise ValueError(f"读取并验证{label}失败：{path}\n{error}") from error


def write_model(path: Path, value: BaseModel) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    content = json.dumps(value.model_dump(mode="json", by_alias=True, exclude_none=True), ensure_ascii=False, indent=2)
    path.write_text(content + "\n", encoding="utf-8")


def atomic_write_model(path: Path, value: BaseModel) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    write_model(temporary_path, value)
    os.replace(temporary_path, path)
