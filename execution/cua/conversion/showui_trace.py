from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

from cua.domain.types import ConvertOptions
from cua.models.task import (
    SCENE_SCHEMA_VERSION,
    TASK_SCHEMA_VERSION,
    SceneManifest,
    TaskInputDefinition,
    TaskManifest,
    TaskSource,
)
from cua.task.io import write_model
from cua.task.yaml_task import write_yaml_document

MIN_RECORDED_WAIT_MS = 200
MAX_RECORDED_WAIT_MS = 30_000


class InputModel(BaseModel):
    model_config = ConfigDict(extra="ignore", strict=True)


class ShowuiTraceOperation(InputModel):
    type: Literal["click", "doubleClick", "input", "keyboard", "wait"]
    prompt: str | None = None
    locatePrompt: str | None = None
    value: str | None = None
    key: str | None = None
    condition: str | None = None


class ShowuiCaption(InputModel):
    observation: str | None = None
    think: str | None = None
    action: str | None = None
    expectation: str | None = None
    operation: ShowuiTraceOperation


class ShowuiTraceStep(InputModel):
    step_idx: int
    caption: ShowuiCaption


class ShowuiTrace(InputModel):
    trajectory: list[ShowuiTraceStep]


class ProcessedLogStep(InputModel):
    timestamp: float


def read_json_model(path: Path, model: type[BaseModel]) -> BaseModel:
    try:
        return model.model_validate_json(path.read_text(encoding="utf-8"))
    except Exception as error:
        raise ValueError(f"读取并验证 JSON 失败：{path}\n{error}") from error


def read_processed_log(path: Path) -> list[ProcessedLogStep]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(value, list):
            raise ValueError("根节点不是数组")
        return [ProcessedLogStep.model_validate(item) for item in value]
    except Exception as error:
        raise ValueError(f"读取并验证 processed log 失败：{path}\n{error}") from error


def write_text_if_missing(path: Path, content: str) -> bool:
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with path.open("x", encoding="utf-8") as file:
            file.write(content)
        return True
    except FileExistsError:
        return False


def scene_skill_content(scene: str) -> str:
    return f"""---
name: {scene}
description: 发现和调用 {scene} 场景中的本地 CUA 任务。
---

# {scene} 场景

运行 `uv run cua task list --scene {scene} --json` 发现任务，再按需读取目标任务的 `SKILL.md`、`task.json` 和 `task.yaml`。
"""


def task_skill_content(scene: str, task: str) -> str:
    return f"""---
name: {task}
description: 调用和维护 {scene}/{task} 本地 CUA 任务。
---

# {task} 任务

使用 `uv run cua task describe --scene {scene} --task {task} --json` 读取输入定义。

本任务的执行流程是 `task.yaml`，输入契约是 `task.json`，`source/` 是只读录制证据。调用、校准和执行模式遵循执行器根 `SKILL.md`；本文件只提供任务特有信息，不覆盖根 Skill 的确认与只读规则。
"""


def required_operation_text(value: str | None, field: str, step_index: int) -> str:
    normalized = value.strip() if value else ""
    if not normalized:
        raise ValueError(f"trace step {step_index} 的 operation.{field} 不能为空")
    return normalized


def clamp_recorded_wait_ms(recorded_gap_ms: int) -> int:
    if recorded_gap_ms < MIN_RECORDED_WAIT_MS:
        return 0
    return min(recorded_gap_ms, MAX_RECORDED_WAIT_MS)


def recorded_wait_ms(current: ProcessedLogStep, previous: ProcessedLogStep | None) -> int:
    if previous is None:
        return 0
    gap_ms = max(0, math.floor((current.timestamp - previous.timestamp) * 1000 + 0.5))
    return clamp_recorded_wait_ms(gap_ms)


def action_from_operation(
    operation: ShowuiTraceOperation,
    step_index: int,
) -> tuple[dict[str, Any], tuple[str, TaskInputDefinition] | None]:
    if operation.type == "click":
        prompt = required_operation_text(operation.prompt, "prompt", step_index)
        return {"aiTap": prompt}, None
    if operation.type == "doubleClick":
        prompt = required_operation_text(operation.prompt, "prompt", step_index)
        return {"aiDoubleClick": prompt}, None
    if operation.type == "input":
        prompt = required_operation_text(operation.prompt, "prompt", step_index)
        locate = required_operation_text(operation.locatePrompt, "locatePrompt", step_index)
        value = required_operation_text(operation.value, "value", step_index)
        input_id = f"step-{step_index:03d}-input"
        definition = TaskInputDefinition(
            type="string",
            label=locate,
            description=prompt,
            default=value,
        )
        return {
            "KeyboardTypeText": {
                "locate": locate,
                "value": f"{{{{{input_id}}}}}",
                "mode": "replace",
            }
        }, (input_id, definition)
    if operation.type == "keyboard":
        key = required_operation_text(operation.key, "key", step_index)
        return {"KeyboardPress": {"keyName": key}}, None
    prompt = operation.prompt.strip() if operation.prompt else None
    condition = required_operation_text(operation.condition, "condition", step_index)
    return {"aiWaitFor": prompt or condition, "timeout": 15_000}, None


def build_task_assets(
    trace: ShowuiTrace,
    processed_steps: list[ProcessedLogStep],
    options: ConvertOptions,
) -> tuple[dict[str, Any], TaskManifest]:
    if not trace.trajectory:
        raise ValueError("trace trajectory 不能为空")
    if len(trace.trajectory) != len(processed_steps):
        raise ValueError(
            f"trace step 数量 {len(trace.trajectory)} 与 processed log 数量 {len(processed_steps)} 不一致"
        )

    tasks: list[dict[str, Any]] = []
    inputs: dict[str, TaskInputDefinition] = {}
    previous: ProcessedLogStep | None = None
    previous_step_index = 0
    for trace_step, processed_step in zip(trace.trajectory, processed_steps, strict=True):
        step_index = trace_step.step_idx
        if step_index <= previous_step_index:
            raise ValueError("trace step_idx 必须为正整数、唯一且按轨迹顺序严格递增")

        flow: list[dict[str, Any]] = []
        wait_ms = recorded_wait_ms(processed_step, previous)
        if wait_ms:
            flow.append({"sleep": wait_ms})
        action, input_definition = action_from_operation(
            trace_step.caption.operation,
            step_index,
        )
        flow.append(action)
        tasks.append(
            {
                "name": f"step-{step_index:03d} | {trace_step.caption.operation.type}",
                "flow": flow,
            }
        )
        if input_definition:
            input_id, definition = input_definition
            inputs[input_id] = definition
        previous = processed_step
        previous_step_index = step_index

    document = {
        "computer": {},
        "agent": {
            "groupName": options.task,
            "groupDescription": options.goal,
            "generateReport": True,
        },
        "tasks": tasks,
    }
    manifest = TaskManifest(
        schema_version=TASK_SCHEMA_VERSION,
        scene=options.scene,
        task=options.task,
        title=options.task,
        description=options.goal,
        goal=options.goal,
        source=TaskSource(
            trace_path="source/showui-trace.json",
            processed_log_path="source/processed-log-sc.json",
            conversion_command=options.conversion_command,
            recording_preparation_command=options.recording_preparation_command,
            trace_generation_command=options.trace_generation_command,
        ),
        inputs=inputs,
    )
    return document, manifest


def convert_trace(options: ConvertOptions) -> Path:
    task_root = (options.projects_root / options.scene / options.task).resolve()
    source_root = task_root / "source"
    task_yaml_path = task_root / "task.yaml"
    task_manifest_path = task_root / "task.json"
    existing = [path for path in (task_yaml_path, task_manifest_path) if path.exists()]
    if existing:
        raise ValueError(f"任务资产已存在，拒绝覆盖：{', '.join(str(path) for path in existing)}")

    trace = read_json_model(source_root / "showui-trace.json", ShowuiTrace)
    assert isinstance(trace, ShowuiTrace)
    processed_steps = read_processed_log(source_root / "processed-log-sc.json")
    document, manifest = build_task_assets(trace, processed_steps, options)

    write_yaml_document(task_yaml_path, document)
    write_model(task_manifest_path, manifest)
    scene_manifest = SceneManifest(
        schema_version=SCENE_SCHEMA_VERSION,
        scene=options.scene,
        title=options.scene,
        description=f"{options.scene} 场景任务集合",
    )
    if not (task_root.parent / "scene.json").exists():
        write_model(task_root.parent / "scene.json", scene_manifest)
    write_text_if_missing(task_root.parent / "SKILL.md", scene_skill_content(options.scene))
    write_text_if_missing(task_root / "SKILL.md", task_skill_content(options.scene, options.task))
    return task_yaml_path
