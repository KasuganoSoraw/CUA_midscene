from __future__ import annotations

from pathlib import Path

from cua.domain.types import ResolveTaskOptions, TaskCatalogRoots, TaskPaths
from cua.models.task import SceneManifest, TaskManifest
from cua.task.io import read_model
from cua.task.resolver import candidate_task_paths, resolve_task, task_paths
from cua.task.yaml_task import read_yaml_document


def require_directory(path: Path, label: str) -> Path:
    root = path.resolve()
    if not root.is_dir():
        raise ValueError(f"读取{label}失败：{root}\n目录不存在")
    return root


def catalog_entries(catalog: TaskCatalogRoots) -> list[tuple[str, bool, Path]]:
    entries: list[tuple[str, bool, Path]] = [("builtin", False, catalog.builtin_projects_root.resolve())]
    if catalog.user_projects_root is not None:
        entries.append(("user", True, catalog.user_projects_root.resolve()))
    return entries


def list_scenes(catalog: TaskCatalogRoots) -> list[dict[str, object]]:
    scenes: dict[str, dict[str, object]] = {}
    for origin, writable, root in catalog_entries(catalog):
        if not root.exists() and origin == "user":
            continue
        root = require_directory(root, f"{origin} 场景目录")
        for scene_root in sorted((path for path in root.iterdir() if path.is_dir()), key=lambda path: path.name):
            manifest = read_model(scene_root / "scene.json", SceneManifest, "场景清单")
            if manifest.scene != scene_root.name:
                raise ValueError(f"场景目录 {scene_root.name} 与 scene.json 标识 {manifest.scene} 不一致")
            current = scenes.get(manifest.scene)
            if current is None:
                current = {
                    **manifest.to_json_dict(),
                    "origins": [],
                    "writable": False,
                    "sceneRoots": [],
                }
                scenes[manifest.scene] = current
            current["origins"].append(origin)  # type: ignore[union-attr]
            current["writable"] = bool(current["writable"]) or writable
            current["sceneRoots"].append(str(scene_root.resolve()))  # type: ignore[union-attr]
    return [scenes[key] for key in sorted(scenes)]


def describe_task(scene: str, task: str, catalog: TaskCatalogRoots) -> dict[str, object]:
    options = ResolveTaskOptions(scene=scene, task=task, catalog=catalog)
    paths = task_paths(scene, task, options)
    manifest = read_model(paths.task_manifest_path, TaskManifest, "任务清单")
    document = read_yaml_document(paths.task_yaml_path)
    resolve_task(options)
    tasks = document["tasks"]
    action_count = sum(len(item["flow"]) for item in tasks)
    return {
        **manifest.to_json_dict(),
        "origin": paths.origin,
        "writable": paths.writable,
        "taskRoot": str(paths.task_root),
        "taskYamlPath": str(paths.task_yaml_path),
        "taskCount": len(tasks),
        "actionCount": action_count,
    }


def list_tasks(scene: str, catalog: TaskCatalogRoots) -> list[dict[str, object]]:
    discovered: dict[str, list[TaskPaths]] = {}
    for origin, writable, projects_root in catalog_entries(catalog):
        scene_root = projects_root / scene
        if not scene_root.exists():
            continue
        scene_root = require_directory(scene_root, f"{origin} 任务目录")
        scene_manifest = read_model(scene_root / "scene.json", SceneManifest, "场景清单")
        if scene_manifest.scene != scene:
            raise ValueError(f"请求场景 {scene} 与 scene.json 标识 {scene_manifest.scene} 不一致")
        for task_root in sorted((path for path in scene_root.iterdir() if path.is_dir()), key=lambda path: path.name):
            if not (task_root / "task.json").is_file():
                continue
            discovered.setdefault(task_root.name, []).append(
                candidate_task_paths(scene, task_root.name, projects_root, origin, writable)
            )
    tasks: list[dict[str, object]] = []
    for task in sorted(discovered):
        locations = discovered[task]
        if len(locations) > 1:
            roots = ", ".join(str(item.task_root) for item in locations)
            raise ValueError(f"任务 {scene}/{task} 同时存在于内置与用户 catalog：{roots}")
        tasks.append(describe_task(scene, task, catalog))
    return tasks
