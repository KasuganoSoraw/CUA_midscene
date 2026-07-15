from __future__ import annotations

import json
from pathlib import Path

import pytest

from cua.domain.types import ResolveTaskOptions
from cua.models.task import SceneManifest, TaskInputDefinition, TaskManifest, TaskSource
from cua.task.inputs import load_runtime_inputs
from cua.task.io import write_model
from cua.task.projects import describe_task, list_scenes, list_tasks
from cua.task.resolver import resolve_task
from cua.task.yaml_task import write_yaml_document

SCENE = "browser-demo"
TASK = "search-demo"


def create_task(projects_root: Path) -> Path:
    scene_root = projects_root / SCENE
    task_root = scene_root / TASK
    write_model(
        scene_root / "scene.json",
        SceneManifest(schema_version="0.1", scene=SCENE, title="浏览器示例", description="测试场景"),
    )
    write_model(
        task_root / "task.json",
        TaskManifest(
            schema_version="0.2",
            scene=SCENE,
            task=TASK,
            title="搜索示例",
            description="测试任务",
            goal="测试搜索",
            source=TaskSource(
                trace_path="source/showui-trace.json",
                processed_log_path="source/processed-log-sc.json",
                conversion_command="uv run cua task init-from-trace",
            ),
            inputs={
                "query": TaskInputDefinition(
                    type="string", label="搜索词", description="搜索内容", default="默认关键词"
                )
            },
        ),
    )
    write_yaml_document(
        task_root / "task.yaml",
        {
            "computer": {},
            "tasks": [
                {
                    "name": "搜索 {{query}}",
                    "flow": [
                        {
                            "KeyboardTypeText": {
                                "locate": "页面顶部搜索框",
                                "value": "{{query}}",
                                "mode": "replace",
                            }
                        },
                        {"aiTap": "点击与 {{query}} 对应的候选项"},
                    ],
                }
            ],
        },
    )
    return task_root


def test_resolver_uses_defaults_and_replaces_every_explicit_placeholder(tmp_path: Path) -> None:
    task_root = create_task(tmp_path)
    defaults = resolve_task(ResolveTaskOptions(scene=SCENE, task=TASK, projects_root=tmp_path))
    assert defaults.inputs == {"query": "默认关键词"}
    assert defaults.document["tasks"][0]["name"] == "搜索 默认关键词"

    resolved = resolve_task(
        ResolveTaskOptions(scene=SCENE, task=TASK, projects_root=tmp_path, inputs={"query": "GUI agent"})
    )
    flow = resolved.document["tasks"][0]["flow"]
    assert flow[0]["KeyboardTypeText"]["value"] == "GUI agent"
    assert flow[1]["aiTap"] == "点击与 GUI agent 对应的候选项"
    assert "{{query}}" in (task_root / "task.yaml").read_text(encoding="utf-8")


def test_resolver_rejects_unknown_undeclared_unused_and_malformed_inputs(tmp_path: Path) -> None:
    task_root = create_task(tmp_path)
    with pytest.raises(ValueError, match="未知输入参数：unknown"):
        resolve_task(
            ResolveTaskOptions(scene=SCENE, task=TASK, projects_root=tmp_path, inputs={"unknown": "value"})
        )

    yaml_path = task_root / "task.yaml"
    text = yaml_path.read_text(encoding="utf-8")
    yaml_path.write_text(text.replace("{{query}}", "{{missing}}"), encoding="utf-8")
    with pytest.raises(ValueError, match="未声明输入占位符：missing"):
        resolve_task(ResolveTaskOptions(scene=SCENE, task=TASK, projects_root=tmp_path))

    yaml_path.write_text(text.replace("{{query}}", "fixed"), encoding="utf-8")
    with pytest.raises(ValueError, match="任务清单输入未在 YAML 中使用：query"):
        resolve_task(ResolveTaskOptions(scene=SCENE, task=TASK, projects_root=tmp_path))

    yaml_path.write_text(text.replace("{{query}}", "{{Query}}"), encoding="utf-8")
    with pytest.raises(ValueError, match="非法输入占位符"):
        resolve_task(ResolveTaskOptions(scene=SCENE, task=TASK, projects_root=tmp_path))


def test_runtime_inputs_reject_duplicates_and_non_strings(tmp_path: Path) -> None:
    inputs_path = tmp_path / "inputs.json"
    inputs_path.write_text(json.dumps({"from": "SIN"}), encoding="utf-8")
    assert load_runtime_inputs(inputs_path, ["to=LAX"]) == {"from": "SIN", "to": "LAX"}
    with pytest.raises(ValueError, match="输入 from 被重复提供"):
        load_runtime_inputs(inputs_path, ["from=SHA"])
    inputs_path.write_text(json.dumps({"count": 1}), encoding="utf-8")
    with pytest.raises(ValueError, match="必须是字符串"):
        load_runtime_inputs(inputs_path, [])


def test_scene_and_task_discovery_validate_assets(tmp_path: Path) -> None:
    create_task(tmp_path)
    assert list_scenes(tmp_path)[0]["scene"] == SCENE
    tasks = list_tasks(SCENE, tmp_path)
    assert tasks[0]["task"] == TASK
    assert tasks[0]["actionCount"] == 2
    assert describe_task(SCENE, TASK, tmp_path)["taskYamlPath"].endswith("task.yaml")
