from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import yaml

from cua.models.task import TaskManifest

PLACEHOLDER_PATTERN = re.compile(r"\{\{([a-z][a-z0-9-]*)\}\}")
RECORDED_TASK_NAME_PATTERN = re.compile(
    r"^(step-(\d{3,})) \| (click|doubleClick|input|keyboard|wait)$"
)
RECORDED_INPUT_ID_PATTERN = re.compile(r"^(step-(\d{3,}))-input$")


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


def validate_recorded_task_document(
    document: dict[str, Any],
    manifest: TaskManifest,
    source: Path | str,
) -> None:
    agent = document.get("agent")
    if not isinstance(agent, dict):
        raise ValueError(f"录制任务 YAML agent 必须是对象：{source}")
    if agent.get("groupName") != manifest.task:
        raise ValueError(f"录制任务 YAML agent.groupName 必须等于 task.json 的 task：{source}")
    if agent.get("groupDescription") != manifest.goal:
        raise ValueError(f"录制任务 YAML agent.groupDescription 必须等于 task.json 的 goal：{source}")

    previous_step_number = 0
    operation_by_step_id: dict[str, str] = {}
    for index, task in enumerate(document["tasks"], start=1):
        name = task["name"]
        match = RECORDED_TASK_NAME_PATTERN.fullmatch(name)
        if match is None:
            raise ValueError(
                f"录制任务 YAML tasks[{index}].name 必须符合 step-NNN | <operation-type>：{source}"
            )
        step_id, number_text, operation_type = match.groups()
        step_number = int(number_text)
        if step_number <= 0 or step_id != f"step-{step_number:03d}":
            raise ValueError(f"录制任务 YAML tasks[{index}] 的 step ID 非法：{source}")
        if step_number <= previous_step_number:
            raise ValueError(f"录制任务 YAML step ID 必须唯一且严格递增：{source}")
        if task.get("continueOnError") is True:
            raise ValueError(f"录制任务 YAML 不允许启用 continueOnError：{source}")
        operation_by_step_id[step_id] = operation_type
        previous_step_number = step_number

    for input_id in manifest.inputs:
        match = RECORDED_INPUT_ID_PATTERN.fullmatch(input_id)
        if match is None:
            raise ValueError(f"录制任务输入 ID 必须符合 step-NNN-input：{input_id}")
        step_id, number_text = match.groups()
        step_number = int(number_text)
        if step_number <= 0 or step_id != f"step-{step_number:03d}":
            raise ValueError(f"录制任务输入 ID 非法：{input_id}")
        if operation_by_step_id.get(step_id) != "input":
            raise ValueError(f"录制任务输入 {input_id} 未对应 input 类型步骤")


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
