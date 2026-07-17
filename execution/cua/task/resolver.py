from __future__ import annotations

from pathlib import Path

from cua.domain.types import ResolveTaskOptions, ResolvedTaskResult, TaskPaths
from cua.models.task import SceneManifest, TaskManifest
from cua.task.io import read_model
from cua.task.yaml_task import read_yaml_document, resolve_yaml_inputs, validate_recorded_task_document


def require_identifier(value: str, label: str) -> str:
    if not value or Path(value).name != value or value in {".", ".."} or "/" in value or "\\" in value:
        raise ValueError(f"{label} 必须是单一目录标识：{value}")
    return value


def candidate_task_paths(scene: str, task: str, projects_root: Path, origin: str, writable: bool) -> TaskPaths:
    scene_id = require_identifier(scene, "scene")
    task_id = require_identifier(task, "task")
    projects = projects_root.resolve()
    root = (projects / scene_id / task_id).resolve()
    if not root.is_relative_to(projects):
        raise ValueError(f"任务路径越出 catalog：{root}")
    scene_root = root.parent
    return TaskPaths(
        origin=origin,  # type: ignore[arg-type]
        writable=writable,
        scene_root=scene_root,
        task_root=root,
        scene_manifest_path=scene_root / "scene.json",
        task_manifest_path=root / "task.json",
        task_yaml_path=root / "task.yaml",
    )


def task_paths(scene: str, task: str, options: ResolveTaskOptions) -> TaskPaths:
    candidates = [
        candidate_task_paths(scene, task, options.catalog.builtin_projects_root, "builtin", False)
    ]
    if options.catalog.user_projects_root is not None:
        candidates.append(candidate_task_paths(scene, task, options.catalog.user_projects_root, "user", True))
    existing = [candidate for candidate in candidates if candidate.task_manifest_path.is_file()]
    if len(existing) > 1:
        locations = ", ".join(str(candidate.task_root) for candidate in existing)
        raise ValueError(f"任务 {scene}/{task} 同时存在于内置与用户 catalog：{locations}")
    if not existing:
        locations = ", ".join(str(candidate.task_root) for candidate in candidates)
        raise ValueError(f"任务不存在：{scene}/{task}\n已检查：{locations}")
    return existing[0]


def require_non_empty(value: str, field: str) -> None:
    if not value.strip():
        raise ValueError(f"{field} 必须是非空字符串")


def validate_manifests(scene: SceneManifest, task: TaskManifest, requested_scene: str, requested_task: str) -> None:
    if scene.scene != requested_scene:
        raise ValueError(f"请求场景 {requested_scene} 与 scene.json 标识 {scene.scene} 不一致")
    if task.scene != requested_scene or task.task != requested_task:
        raise ValueError(
            f"请求任务 {requested_scene}/{requested_task} 与 task.json 标识 {task.scene}/{task.task} 不一致"
        )
    require_non_empty(scene.title, "scene.title")
    require_non_empty(task.title, "task.title")
    require_non_empty(task.goal, "task.goal")
    for input_id, definition in task.inputs.items():
        require_non_empty(input_id, "input id")
        require_non_empty(definition.label, f"输入 {input_id}.label")


def resolve_task(options: ResolveTaskOptions) -> ResolvedTaskResult:
    paths = task_paths(options.scene, options.task, options)
    scene = read_model(paths.scene_manifest_path, SceneManifest, "场景清单")
    manifest = read_model(paths.task_manifest_path, TaskManifest, "任务清单")
    validate_manifests(scene, manifest, options.scene, options.task)
    document = read_yaml_document(paths.task_yaml_path)
    validate_recorded_task_document(document, manifest, paths.task_yaml_path)
    resolved, values = resolve_yaml_inputs(document, manifest, options.inputs)
    return ResolvedTaskResult(
        document=resolved,
        manifest=manifest,
        source_path=paths.task_yaml_path,
        inputs=values,
        origin=paths.origin,
        writable=paths.writable,
    )
