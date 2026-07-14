from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from cua.models.flow import MidsceneFlow
    from cua.models.task import ResolvedFlowSources


@dataclass(frozen=True)
class TaskPaths:
    scene_root: Path
    task_root: Path
    scene_manifest_path: Path
    task_manifest_path: Path
    flow_path: Path
    reports_dir: Path


@dataclass(frozen=True)
class ResolveTaskOptions:
    scene: str
    task: str
    projects_root: Path | None = None
    task_root: Path | None = None
    flow_path: Path | None = None
    inputs: dict[str, str] | None = None
    executable: bool = True


@dataclass(frozen=True)
class ConvertOptions:
    scene: str
    task: str
    goal: str
    projects_root: Path
    conversion_command: str
    recording_preparation_command: str | None = None
    trace_generation_command: str | None = None
    flow_execution_command: str | None = None


@dataclass(frozen=True)
class ResolvedFlowResult:
    flow: MidsceneFlow
    sources: ResolvedFlowSources
    inputs: dict[str, str]


@dataclass(frozen=True)
class ExecutionOptions:
    scene: str
    task: str
    projects_root: Path | None = None
    task_root: Path | None = None
    flow_path: Path | None = None
    inputs: dict[str, str] | None = None
    dry_run: bool = False
    command_prefix: tuple[str, ...] | None = None
