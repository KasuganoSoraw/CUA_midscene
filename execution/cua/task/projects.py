from __future__ import annotations

from pathlib import Path

from cua.models.task import FlowOverrides, TaskProjectConfig
from cua.task.io import read_model
from cua.task.resolver import (
    read_flow_with_fingerprint,
    task_project_paths,
    validate_flow,
    validate_overrides,
    validate_project_config,
)


def list_projects(projects_root: Path) -> list[dict[str, object]]:
    root = projects_root.resolve()
    if not root.is_dir():
        raise ValueError(f"读取项目目录失败：{root}\n目录不存在")
    projects: list[dict[str, object]] = []
    for project_root in sorted((path for path in root.iterdir() if path.is_dir()), key=lambda path: path.name):
        paths = task_project_paths(project_root.name, project_root)
        flow, fingerprint = read_flow_with_fingerprint(paths.flow_path)
        config = read_model(paths.project_config_path, TaskProjectConfig, "项目配置")
        overrides = read_model(paths.overrides_path, FlowOverrides, "校准配置")
        validate_flow(flow, executable=False)
        validate_project_config(config, flow)
        validate_overrides(overrides, flow)
        projects.append(
            {
                "project": config.project,
                "title": config.title,
                "description": config.description,
                "goal": config.goal,
                "inputs": {key: value.to_json_dict() for key, value in config.inputs.items()},
                "baseFlowFingerprint": fingerprint,
            }
        )
    return projects
