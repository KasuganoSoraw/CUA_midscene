from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from cua.domain.types import ResolveTaskOptions, ResolvedTaskResult, TaskPaths
from cua.models.task import SceneManifest, TaskManifest
from cua.task.io import read_model
from cua.task.yaml_task import read_yaml_document, resolve_yaml_inputs, write_yaml_document


def task_paths(scene: str, task: str, projects_root: Path | None = None) -> TaskPaths:
    projects = (projects_root or Path("projects")).resolve()
    root = (projects / scene / task).resolve()
    scene_root = root.parent
    return TaskPaths(
        scene_root=scene_root,
        task_root=root,
        scene_manifest_path=scene_root / "scene.json",
        task_manifest_path=root / "task.json",
        task_yaml_path=root / "task.yaml",
        reports_dir=root / "reports",
    )


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
    paths = task_paths(options.scene, options.task, options.projects_root)
    scene = read_model(paths.scene_manifest_path, SceneManifest, "场景清单")
    manifest = read_model(paths.task_manifest_path, TaskManifest, "任务清单")
    validate_manifests(scene, manifest, options.scene, options.task)
    document = read_yaml_document(paths.task_yaml_path)
    resolved, values = resolve_yaml_inputs(document, manifest, options.inputs)
    return ResolvedTaskResult(
        document=resolved,
        manifest=manifest,
        source_path=paths.task_yaml_path,
        inputs=values,
    )


def create_run_directory(reports_dir: Path) -> Path:
    now = datetime.now(UTC)
    run_id = now.isoformat(timespec="milliseconds").replace(":", "-").replace(".", "-").replace("+00-00", "Z")
    run_dir = reports_dir.resolve() / run_id
    run_dir.mkdir(parents=True, exist_ok=False)
    return run_dir


def write_resolved_task(result: ResolvedTaskResult, reports_dir: Path) -> Path:
    run_dir = create_run_directory(reports_dir)
    snapshot_path = run_dir / "resolved-task.yaml"
    write_yaml_document(snapshot_path, result.document)
    return snapshot_path
