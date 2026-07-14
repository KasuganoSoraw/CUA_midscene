from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import Field

from .base import ContractModel
from .flow import MidsceneFlow

SCENE_SCHEMA_VERSION = "0.1"
TASK_SCHEMA_VERSION = "0.1"
RESOLVED_FLOW_SCHEMA_VERSION = "0.1"


class SceneManifest(ContractModel):
    schema_version: Literal["0.1"]
    scene: str
    title: str
    description: str


class TaskInputBinding(ContractModel):
    step_id: str
    field: Literal["route.value"]


class TaskInputDefinition(ContractModel):
    type: Literal["string"]
    label: str
    description: str | None = None
    binding: TaskInputBinding


class TaskManifest(ContractModel):
    schema_version: Literal["0.1"]
    scene: str
    task: str
    title: str
    description: str
    goal: str
    inputs: dict[str, TaskInputDefinition]


class ResolvedFlowSources(ContractModel):
    flow_path: str
    task_path: str


class ResolvedFlowSnapshot(ContractModel):
    schema_version: Literal["0.1"]
    resolved_at: datetime
    flow: MidsceneFlow
    sources: ResolvedFlowSources
    inputs: dict[str, str]


class ExecutorResult(ContractModel):
    schema_version: Literal["0.1"]
    status: Literal["succeeded", "failed"]
    scene: str | None = None
    task: str | None = None
    resolved_flow_path: str
    dry_run: bool
    step_count: int | None = Field(default=None, ge=0)
    completed_step_ids: list[str]
    finished_at: datetime
    error: str | None = None
