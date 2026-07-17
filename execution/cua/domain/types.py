from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from cua.models.task import TaskManifest


@dataclass(frozen=True)
class TaskPaths:
    origin: Literal["builtin", "user"]
    writable: bool
    scene_root: Path
    task_root: Path
    scene_manifest_path: Path
    task_manifest_path: Path
    task_yaml_path: Path


@dataclass(frozen=True)
class TaskCatalogRoots:
    builtin_projects_root: Path
    user_projects_root: Path | None = None


@dataclass(frozen=True)
class DataPaths:
    root: Path
    projects_root: Path
    runs_root: Path
    cache_root: Path


@dataclass(frozen=True)
class RuntimeLayout:
    catalog: TaskCatalogRoots
    data: DataPaths | None = None


@dataclass(frozen=True)
class ResolveTaskOptions:
    scene: str
    task: str
    catalog: TaskCatalogRoots
    inputs: dict[str, str] | None = None


@dataclass(frozen=True)
class ConvertOptions:
    scene: str
    task: str
    goal: str
    catalog: TaskCatalogRoots
    conversion_command: str
    recording_preparation_command: str | None = None
    trace_generation_command: str | None = None


@dataclass(frozen=True)
class ResolvedTaskResult:
    document: dict[str, Any]
    manifest: TaskManifest
    source_path: Path
    inputs: dict[str, str]
    origin: Literal["builtin", "user"]
    writable: bool


@dataclass(frozen=True)
class ExecutionOptions:
    scene: str
    task: str
    catalog: TaskCatalogRoots
    runs_root: Path
    inputs: dict[str, str] | None = None
    dry_run: bool = False
    command_prefix: tuple[str, ...] | None = None
