from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from cua.models.task import TaskManifest


@dataclass(frozen=True)
class TaskPaths:
    scene_root: Path
    task_root: Path
    scene_manifest_path: Path
    task_manifest_path: Path
    task_yaml_path: Path
    reports_dir: Path


@dataclass(frozen=True)
class ResolveTaskOptions:
    scene: str
    task: str
    projects_root: Path | None = None
    inputs: dict[str, str] | None = None


@dataclass(frozen=True)
class ConvertOptions:
    scene: str
    task: str
    goal: str
    projects_root: Path
    conversion_command: str
    recording_preparation_command: str | None = None
    trace_generation_command: str | None = None


@dataclass(frozen=True)
class ResolvedTaskResult:
    document: dict[str, Any]
    manifest: TaskManifest
    source_path: Path
    inputs: dict[str, str]


@dataclass(frozen=True)
class ExecutionOptions:
    scene: str
    task: str
    projects_root: Path | None = None
    inputs: dict[str, str] | None = None
    dry_run: bool = False
    command_prefix: tuple[str, ...] | None = None
