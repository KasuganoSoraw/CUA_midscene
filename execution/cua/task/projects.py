from __future__ import annotations

from pathlib import Path

from cua.models.task import SceneManifest, TaskManifest
from cua.task.io import read_model
from cua.task.resolver import read_flow, task_paths, validate_flow, validate_manifests


def require_directory(path: Path, label: str) -> Path:
    root = path.resolve()
    if not root.is_dir():
        raise ValueError(f"读取{label}失败：{root}\n目录不存在")
    return root


def list_scenes(projects_root: Path) -> list[dict[str, object]]:
    root = require_directory(projects_root, "场景目录")
    scenes: list[dict[str, object]] = []
    for scene_root in sorted((path for path in root.iterdir() if path.is_dir()), key=lambda path: path.name):
        manifest = read_model(scene_root / "scene.json", SceneManifest, "场景清单")
        if manifest.scene != scene_root.name:
            raise ValueError(f"场景目录 {scene_root.name} 与 scene.json 标识 {manifest.scene} 不一致")
        scenes.append(manifest.to_json_dict())
    return scenes


def describe_task(scene: str, task: str, projects_root: Path) -> dict[str, object]:
    paths = task_paths(scene, task, projects_root)
    flow = read_flow(paths.flow_path)
    scene_manifest = read_model(paths.scene_manifest_path, SceneManifest, "场景清单")
    task_manifest = read_model(paths.task_manifest_path, TaskManifest, "任务清单")
    validate_flow(flow, executable=False)
    validate_manifests(scene_manifest, task_manifest, flow)
    return {
        **task_manifest.to_json_dict(),
        "flowPath": str(paths.flow_path),
        "stepCount": len(flow.steps),
    }


def list_tasks(scene: str, projects_root: Path) -> list[dict[str, object]]:
    scene_root = require_directory(projects_root.resolve() / scene, "任务目录")
    scene_manifest = read_model(scene_root / "scene.json", SceneManifest, "场景清单")
    if scene_manifest.scene != scene:
        raise ValueError(f"请求场景 {scene} 与 scene.json 标识 {scene_manifest.scene} 不一致")
    tasks: list[dict[str, object]] = []
    for task_root in sorted((path for path in scene_root.iterdir() if path.is_dir()), key=lambda path: path.name):
        if not (task_root / "task.json").is_file():
            continue
        tasks.append(describe_task(scene, task_root.name, projects_root))
    return tasks
