from __future__ import annotations

import json
from pathlib import Path

import pytest

from cua.domain.types import ResolveTaskOptions, TaskCatalogRoots
from cua.models.task import SceneManifest, TaskInputDefinition, TaskManifest, TaskSource
from cua.task.inputs import load_runtime_inputs
from cua.task.io import write_model
from cua.task.projects import describe_task, list_scenes, list_tasks
from cua.task.resolver import resolve_task
from cua.task.yaml_task import write_yaml_document

SCENE = "browser-demo"
TASK = "search-demo"


def user_catalog(projects_root: Path, builtin_root: Path | None = None) -> TaskCatalogRoots:
    resolved_builtin = builtin_root or projects_root.parent / "empty-builtin"
    resolved_builtin.mkdir(parents=True, exist_ok=True)
    return TaskCatalogRoots(
        builtin_projects_root=resolved_builtin,
        user_projects_root=projects_root,
    )


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
                "step-001-input": TaskInputDefinition(
                    type="string", label="搜索词", description="搜索内容", default="默认关键词"
                )
            },
        ),
    )
    write_yaml_document(
        task_root / "task.yaml",
        {
            "computer": {},
            "agent": {
                "groupName": TASK,
                "groupDescription": "测试搜索",
                "generateReport": True,
            },
            "tasks": [
                {
                    "name": "step-001 | input",
                    "flow": [
                        {
                            "KeyboardTypeText": {
                                "locate": "页面顶部搜索框",
                                "value": "{{step-001-input}}",
                                "mode": "replace",
                            }
                        }
                    ],
                },
                {
                    "name": "step-002 | click",
                    "flow": [{"aiTap": "点击与 {{step-001-input}} 对应的候选项"}],
                },
            ],
        },
    )
    return task_root


def test_resolver_uses_defaults_and_replaces_every_explicit_placeholder(tmp_path: Path) -> None:
    task_root = create_task(tmp_path)
    defaults = resolve_task(ResolveTaskOptions(scene=SCENE, task=TASK, catalog=user_catalog(tmp_path)))
    assert defaults.inputs == {"step-001-input": "默认关键词"}
    assert defaults.document["tasks"][0]["name"] == "step-001 | input"

    resolved = resolve_task(
        ResolveTaskOptions(
            scene=SCENE,
            task=TASK,
            catalog=user_catalog(tmp_path),
            inputs={"step-001-input": "GUI agent"},
        )
    )
    assert resolved.document["tasks"][0]["flow"][0]["KeyboardTypeText"]["value"] == "GUI agent"
    assert resolved.document["tasks"][1]["flow"][0]["aiTap"] == "点击与 GUI agent 对应的候选项"
    assert "{{step-001-input}}" in (task_root / "task.yaml").read_text(encoding="utf-8")


def test_resolver_rejects_unknown_undeclared_unused_and_malformed_inputs(tmp_path: Path) -> None:
    task_root = create_task(tmp_path)
    with pytest.raises(ValueError, match="未知输入参数：unknown"):
        resolve_task(
            ResolveTaskOptions(scene=SCENE, task=TASK, catalog=user_catalog(tmp_path), inputs={"unknown": "value"})
        )

    yaml_path = task_root / "task.yaml"
    text = yaml_path.read_text(encoding="utf-8")
    yaml_path.write_text(text.replace("{{step-001-input}}", "{{missing}}"), encoding="utf-8")
    with pytest.raises(ValueError, match="未声明输入占位符：missing"):
        resolve_task(ResolveTaskOptions(scene=SCENE, task=TASK, catalog=user_catalog(tmp_path)))

    yaml_path.write_text(text.replace("{{step-001-input}}", "fixed"), encoding="utf-8")
    with pytest.raises(ValueError, match="任务清单输入未在 YAML 中使用：step-001-input"):
        resolve_task(ResolveTaskOptions(scene=SCENE, task=TASK, catalog=user_catalog(tmp_path)))

    yaml_path.write_text(text.replace("{{step-001-input}}", "{{StepInput}}"), encoding="utf-8")
    with pytest.raises(ValueError, match="非法输入占位符"):
        resolve_task(ResolveTaskOptions(scene=SCENE, task=TASK, catalog=user_catalog(tmp_path)))


@pytest.mark.parametrize(
    ("old_text", "new_text", "message"),
    [
        ("step-002 | click", "second click", "name 必须符合"),
        ("step-002 | click", "step-001 | click", "唯一且严格递增"),
        ("groupDescription: 测试搜索", "groupDescription: 其他目标", "groupDescription"),
    ],
)
def test_resolver_rejects_broken_recorded_step_contract(
    tmp_path: Path, old_text: str, new_text: str, message: str
) -> None:
    task_root = create_task(tmp_path)
    yaml_path = task_root / "task.yaml"
    yaml_path.write_text(
        yaml_path.read_text(encoding="utf-8").replace(old_text, new_text),
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match=message):
        resolve_task(ResolveTaskOptions(scene=SCENE, task=TASK, catalog=user_catalog(tmp_path)))


def test_resolver_rejects_continue_on_error(tmp_path: Path) -> None:
    task_root = create_task(tmp_path)
    yaml_path = task_root / "task.yaml"
    text = yaml_path.read_text(encoding="utf-8")
    yaml_path.write_text(text.replace("  flow:\n", "  continueOnError: true\n  flow:\n", 1), encoding="utf-8")
    with pytest.raises(ValueError, match="不允许启用 continueOnError"):
        resolve_task(ResolveTaskOptions(scene=SCENE, task=TASK, catalog=user_catalog(tmp_path)))


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
    catalog = user_catalog(tmp_path)
    assert list_scenes(catalog)[0]["scene"] == SCENE
    tasks = list_tasks(SCENE, catalog)
    assert tasks[0]["task"] == TASK
    assert tasks[0]["taskCount"] == 2
    assert tasks[0]["actionCount"] == 2
    assert describe_task(SCENE, TASK, catalog)["taskYamlPath"].endswith("task.yaml")
    assert tasks[0]["origin"] == "user"
    assert tasks[0]["writable"] is True


def test_dual_catalog_merges_scenes_and_rejects_duplicate_task(tmp_path: Path) -> None:
    builtin = tmp_path / "builtin"
    user = tmp_path / "user"
    create_task(builtin)
    catalog = user_catalog(user, builtin)
    assert list_scenes(catalog)[0]["origins"] == ["builtin"]
    create_task(user)
    assert list_scenes(catalog)[0]["origins"] == ["builtin", "user"]
    with pytest.raises(ValueError, match="builtin.*user|内置.*用户"):
        list_tasks(SCENE, catalog)


def test_builtin_task_is_reported_read_only(tmp_path: Path) -> None:
    create_task(tmp_path)
    resolved = resolve_task(
        ResolveTaskOptions(
            scene=SCENE,
            task=TASK,
            catalog=TaskCatalogRoots(builtin_projects_root=tmp_path),
        )
    )
    assert resolved.origin == "builtin"
    assert resolved.writable is False
