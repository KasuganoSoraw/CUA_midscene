from __future__ import annotations

from datetime import datetime
from typing import Literal

from .base import ContractModel

SCENE_SCHEMA_VERSION = "0.1"
TASK_SCHEMA_VERSION = "0.2"
EXECUTOR_RESULT_SCHEMA_VERSION = "0.2"


class SceneManifest(ContractModel):
    schema_version: Literal["0.1"]
    scene: str
    title: str
    description: str


class TaskInputDefinition(ContractModel):
    type: Literal["string"]
    label: str
    description: str | None = None
    default: str


class TaskSource(ContractModel):
    trace_path: str
    processed_log_path: str
    conversion_command: str
    recording_preparation_command: str | None = None
    trace_generation_command: str | None = None


class TaskManifest(ContractModel):
    schema_version: Literal["0.2"]
    scene: str
    task: str
    title: str
    description: str
    goal: str
    source: TaskSource
    inputs: dict[str, TaskInputDefinition]


class ExecutorResult(ContractModel):
    schema_version: Literal["0.2"]
    status: Literal["succeeded", "failed"]
    source_yaml_path: str
    dry_run: bool
    task_count: int | None = None
    midscene_result: dict[str, object] | None = None
    finished_at: datetime
    error: str | None = None
