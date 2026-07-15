from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import yaml

from cua.models.task import TaskManifest

PLACEHOLDER_PATTERN = re.compile(r"\{\{([a-z][a-z0-9-]*)\}\}")


def read_yaml_document(path: Path) -> dict[str, Any]:
    try:
        value = yaml.safe_load(path.read_text(encoding="utf-8"))
    except Exception as error:
        raise ValueError(f"读取并解析 Midscene YAML 失败：{path}\n{error}") from error
    if not isinstance(value, dict):
        raise ValueError(f"Midscene YAML 根节点必须是对象：{path}")
    validate_yaml_document(value, path)
    return value


def validate_yaml_document(document: dict[str, Any], source: Path | str) -> None:
    tasks = document.get("tasks")
    if not isinstance(tasks, list) or not tasks:
        raise ValueError(f"Midscene YAML tasks 必须是非空数组：{source}")
    for index, task in enumerate(tasks, start=1):
        if not isinstance(task, dict):
            raise ValueError(f"Midscene YAML tasks[{index}] 必须是对象：{source}")
        name = task.get("name")
        flow = task.get("flow")
        if not isinstance(name, str) or not name.strip():
            raise ValueError(f"Midscene YAML tasks[{index}].name 不能为空：{source}")
        if not isinstance(flow, list) or not flow:
            raise ValueError(f"Midscene YAML tasks[{index}].flow 必须是非空数组：{source}")
        for action_index, action in enumerate(flow, start=1):
            if not isinstance(action, dict) or not action:
                raise ValueError(
                    f"Midscene YAML tasks[{index}].flow[{action_index}] 必须是非空对象：{source}"
                )


def dump_yaml_document(document: dict[str, Any]) -> str:
    return yaml.safe_dump(
        document,
        allow_unicode=True,
        sort_keys=False,
        default_flow_style=False,
        width=120,
    )


def write_yaml_document(path: Path, document: dict[str, Any]) -> None:
    validate_yaml_document(document, path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(dump_yaml_document(document), encoding="utf-8")


def collect_placeholders(value: object) -> set[str]:
    if isinstance(value, str):
        matches = set(PLACEHOLDER_PATTERN.findall(value))
        residue = PLACEHOLDER_PATTERN.sub("", value)
        if "{{" in residue or "}}" in residue:
            raise ValueError(f"非法输入占位符：{value}")
        return matches
    if isinstance(value, list):
        return set().union(*(collect_placeholders(item) for item in value)) if value else set()
    if isinstance(value, dict):
        placeholders: set[str] = set()
        for key, item in value.items():
            placeholders.update(collect_placeholders(key))
            placeholders.update(collect_placeholders(item))
        return placeholders
    return set()


def resolve_yaml_inputs(
    document: dict[str, Any],
    manifest: TaskManifest,
    provided_inputs: dict[str, str] | None = None,
) -> tuple[dict[str, Any], dict[str, str]]:
    provided = provided_inputs or {}
    unknown_inputs = sorted(set(provided) - set(manifest.inputs))
    if unknown_inputs:
        raise ValueError(f"未知输入参数：{', '.join(unknown_inputs)}")

    placeholders = collect_placeholders(document)
    undeclared = sorted(placeholders - set(manifest.inputs))
    if undeclared:
        raise ValueError(f"YAML 包含未声明输入占位符：{', '.join(undeclared)}")
    unused = sorted(set(manifest.inputs) - placeholders)
    if unused:
        raise ValueError(f"任务清单输入未在 YAML 中使用：{', '.join(unused)}")

    values = {input_id: definition.default for input_id, definition in manifest.inputs.items()}
    values.update(provided)

    def resolve(value: object) -> object:
        if isinstance(value, str):
            return PLACEHOLDER_PATTERN.sub(lambda match: values[match.group(1)], value)
        if isinstance(value, list):
            return [resolve(item) for item in value]
        if isinstance(value, dict):
            return {resolve(key): resolve(item) for key, item in value.items()}
        return value

    resolved = resolve(document)
    assert isinstance(resolved, dict)
    validate_yaml_document(resolved, "resolved task")
    if collect_placeholders(resolved):
        raise ValueError("resolved task 仍包含未解析输入占位符")
    return resolved, values
