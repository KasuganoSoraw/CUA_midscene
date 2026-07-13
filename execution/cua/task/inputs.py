from __future__ import annotations

import json
from pathlib import Path


def parse_input_assignment(assignment: str) -> tuple[str, str]:
    separator = assignment.find("=")
    if separator <= 0:
        raise ValueError(f"输入参数必须使用 key=value 格式：{assignment}")
    return assignment[:separator], assignment[separator + 1 :]


def add_input(target: dict[str, str], key: str, value: object, source: str) -> None:
    if not isinstance(value, str):
        raise ValueError(f"输入 {key} 在 {source} 中必须是字符串")
    if key in target:
        raise ValueError(f"输入 {key} 被重复提供")
    target[key] = value


def load_runtime_inputs(inputs_file: Path | None, assignments: list[str] | None) -> dict[str, str]:
    inputs: dict[str, str] = {}
    if inputs_file is not None:
        path = inputs_file.resolve()
        try:
            parsed = json.loads(path.read_text(encoding="utf-8"))
        except Exception as error:
            raise ValueError(f"读取输入文件失败：{path}\n{error}") from error
        if not isinstance(parsed, dict):
            raise ValueError(f"输入文件必须是 JSON 对象：{path}")
        for key, value in parsed.items():
            add_input(inputs, key, value, str(path))

    for assignment in assignments or []:
        key, value = parse_input_assignment(assignment)
        add_input(inputs, key, value, "--input")
    return inputs
