from __future__ import annotations

import json
from pathlib import Path

import pytest

from cua.domain.types import ResolveTaskOptions
from cua.models.flow import (
    InputRoute,
    MidsceneFlow,
    MidsceneFlowEvidence,
    MidsceneFlowSource,
    MidsceneFlowSourceTrace,
    MidsceneFlowStep,
    TapRoute,
    TraceClickOperation,
    TraceInputOperation,
)
from cua.models.task import SceneManifest, TaskInputBinding, TaskInputDefinition, TaskManifest
from cua.task.inputs import load_runtime_inputs
from cua.task.io import write_model
from cua.task.projects import describe_task, list_scenes, list_tasks
from cua.task.resolver import resolve_task_flow, write_resolved_flow_snapshot

SCENE = "browser-demo"
TASK = "search-demo"


def make_flow(value: str = "默认关键词") -> MidsceneFlow:
    return MidsceneFlow(
        schema_version="0.1",
        scene=SCENE,
        task=TASK,
        goal="测试搜索",
        source=MidsceneFlowSource(trace_path="source/showui-trace.json"),
        steps=[
            MidsceneFlowStep(
                id="step-001",
                source_trace=MidsceneFlowSourceTrace(step_index=1),
                intent="输入搜索词",
                evidence=MidsceneFlowEvidence(
                    observation="搜索框可见",
                    action="输入关键词",
                    operation=TraceInputOperation(
                        type="input",
                        prompt="在搜索框输入 {{value}}",
                        locate_prompt="页面顶部搜索框",
                        value=value,
                    ),
                ),
                route=InputRoute(
                    strategy="input",
                    prompt="在搜索框输入 {{value}}",
                    locate_prompt="页面顶部搜索框",
                    value=value,
                    mode="replace",
                    input_method="keyboard-action",
                ),
            ),
            MidsceneFlowStep(
                id="step-002",
                source_trace=MidsceneFlowSourceTrace(step_index=2),
                intent="点击搜索",
                evidence=MidsceneFlowEvidence(
                    observation="搜索按钮可见",
                    action="点击搜索",
                    operation=TraceClickOperation(type="click", prompt="页面顶部的搜索按钮"),
                ),
                route=TapRoute(strategy="tap", prompt="页面顶部的搜索按钮"),
            ),
        ],
    )


def create_task(projects_root: Path, value: str = "默认关键词") -> Path:
    scene_root = projects_root / SCENE
    task_root = scene_root / TASK
    flow = make_flow(value)
    write_model(
        scene_root / "scene.json",
        SceneManifest(
            schema_version="0.1",
            scene=SCENE,
            title="浏览器示例",
            description="测试场景",
        ),
    )
    write_model(
        task_root / "task.json",
        TaskManifest(
            schema_version="0.1",
            scene=SCENE,
            task=TASK,
            title="搜索示例",
            description="测试任务",
            goal=flow.goal,
            inputs={
                "query": TaskInputDefinition(
                    type="string",
                    label="搜索词",
                    binding=TaskInputBinding(step_id="step-001", field="route.value"),
                )
            },
        ),
    )
    write_model(task_root / "midscene-flow.json", flow)
    return task_root


def input_value(flow: MidsceneFlow) -> str:
    route = flow.steps[0].route
    assert isinstance(route, InputRoute)
    return route.value


def test_resolver_uses_flow_value_and_applies_sparse_input(tmp_path: Path) -> None:
    task_root = create_task(tmp_path)
    defaults = resolve_task_flow(ResolveTaskOptions(scene=SCENE, task=TASK, projects_root=tmp_path))
    assert input_value(defaults.flow) == "默认关键词"
    assert defaults.inputs == {"query": "默认关键词"}

    sparse = resolve_task_flow(
        ResolveTaskOptions(scene=SCENE, task=TASK, projects_root=tmp_path, inputs={"query": "47405"})
    )
    assert input_value(sparse.flow) == "47405"
    canonical = MidsceneFlow.model_validate_json(
        (task_root / "midscene-flow.json").read_text(encoding="utf-8")
    )
    assert input_value(canonical) == "默认关键词"
    snapshot_path = write_resolved_flow_snapshot(sparse, task_root / "reports")
    assert snapshot_path.name == "resolved-flow.json"


def test_direct_flow_edit_becomes_new_default(tmp_path: Path) -> None:
    task_root = create_task(tmp_path)
    flow = make_flow("长期修改后的关键词")
    write_model(task_root / "midscene-flow.json", flow)
    resolved = resolve_task_flow(ResolveTaskOptions(scene=SCENE, task=TASK, projects_root=tmp_path))
    assert input_value(resolved.flow) == "长期修改后的关键词"


def test_resolver_rejects_unknown_input_and_invalid_binding(tmp_path: Path) -> None:
    task_root = create_task(tmp_path)
    with pytest.raises(ValueError, match="未知输入参数：unknown"):
        resolve_task_flow(
            ResolveTaskOptions(scene=SCENE, task=TASK, projects_root=tmp_path, inputs={"unknown": "value"})
        )

    manifest = TaskManifest.model_validate_json((task_root / "task.json").read_text(encoding="utf-8"))
    invalid = manifest.model_copy(
        update={
            "inputs": {
                "query": manifest.inputs["query"].model_copy(
                    update={"binding": TaskInputBinding(step_id="step-999", field="route.value")}
                )
            }
        }
    )
    write_model(task_root / "task.json", invalid)
    with pytest.raises(ValueError, match="不存在的 step：step-999"):
        resolve_task_flow(ResolveTaskOptions(scene=SCENE, task=TASK, projects_root=tmp_path))


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
    assert "query" in tasks[0]["inputs"]  # type: ignore[operator]
    assert describe_task(SCENE, TASK, tmp_path)["stepCount"] == 2
