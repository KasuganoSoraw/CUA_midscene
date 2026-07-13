from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from cua.domain.types import CalibrationOptions, ResolveProjectOptions
from cua.models.flow import (
    InputRoute,
    MidsceneFlow,
    MidsceneFlowEvidence,
    MidsceneFlowFallback,
    MidsceneFlowSource,
    MidsceneFlowSourceTrace,
    MidsceneFlowStep,
    TapRoute,
)
from cua.models.task import (
    CalibrationBefore,
    CalibrationChange,
    CalibrationProposal,
    FlowOverrides,
    FlowStepPatch,
    RoutePatch,
    TaskInputBinding,
    TaskInputDefinition,
    TaskProjectConfig,
)
from cua.task.calibration import apply_calibration_proposal, validate_calibration_proposal
from cua.task.inputs import load_runtime_inputs
from cua.task.io import read_model, write_model
from cua.task.projects import list_projects
from cua.task.resolver import (
    apply_step_patch,
    create_empty_overrides,
    fingerprint_flow_content,
    resolve_project_flow,
    validate_overrides,
    write_resolved_flow_snapshot,
)

PROJECT = "task-core-test"


def sample_flow() -> MidsceneFlow:
    return MidsceneFlow(
        schema_version="0.1",
        project=PROJECT,
        goal="测试任务解析",
        source=MidsceneFlowSource(trace_path="source/showui-trace.json"),
        steps=[
            MidsceneFlowStep(
                id="step-001",
                source_trace=MidsceneFlowSourceTrace(step_index=1),
                intent="输入关键词",
                evidence=MidsceneFlowEvidence(observation="", action="输入默认关键词"),
                route=InputRoute(
                    strategy="input",
                    prompt="在搜索框输入 {{value}}",
                    locate_prompt="页面顶部的搜索输入框",
                    value="默认关键词",
                    mode="replace",
                    input_method="keyboard-action",
                ),
                fallback=MidsceneFlowFallback(strategy="vision", instruction="在搜索框输入 {{value}}"),
            ),
            MidsceneFlowStep(
                id="step-002",
                source_trace=MidsceneFlowSourceTrace(step_index=2),
                intent="点击搜索",
                evidence=MidsceneFlowEvidence(observation="", action="点击搜索按钮"),
                route=TapRoute(strategy="tap", prompt="页面右侧的蓝色搜索按钮"),
                fallback=MidsceneFlowFallback(strategy="vision", instruction="点击搜索按钮"),
            ),
        ],
    )


def sample_config() -> TaskProjectConfig:
    return TaskProjectConfig(
        schema_version="0.1",
        project=PROJECT,
        title="解析测试",
        description="验证任务参数和校准",
        goal="测试任务解析",
        inputs={
            "step-001-value": TaskInputDefinition(
                type="string",
                label="搜索关键词",
                default="默认关键词",
                binding=TaskInputBinding(step_id="step-001", field="route.value"),
            )
        },
    )


def create_project(root: Path, overrides: FlowOverrides | None = None) -> tuple[MidsceneFlow, str]:
    flow = sample_flow()
    write_model(root / "ir" / "midscene-flow.json", flow)
    write_model(root / "config" / "project.json", sample_config())
    write_model(root / "config" / "flow-overrides.json", overrides or create_empty_overrides(PROJECT))
    (root / "calibration" / "proposals").mkdir(parents=True)
    (root / "calibration" / "history").mkdir(parents=True)
    flow_content = (root / "ir" / "midscene-flow.json").read_text(encoding="utf-8")
    return flow, fingerprint_flow_content(flow_content)


def input_route_value(flow: MidsceneFlow) -> str:
    route = flow.steps[0].route
    assert isinstance(route, InputRoute)
    return route.value


def test_resolver_applies_overrides_sparse_inputs_and_snapshot(tmp_path: Path) -> None:
    overrides = FlowOverrides(
        schema_version="0.1",
        project=PROJECT,
        steps={"step-002": FlowStepPatch(route=RoutePatch(prompt="页面顶部工具栏右侧的蓝色搜索按钮"))},
    )
    _, fingerprint = create_project(tmp_path, overrides)
    defaults = resolve_project_flow(ResolveProjectOptions(project=PROJECT, project_root=tmp_path))
    assert input_route_value(defaults.flow) == "默认关键词"
    assert defaults.flow.steps[1].route.prompt == "页面顶部工具栏右侧的蓝色搜索按钮"  # type: ignore[union-attr]
    assert defaults.sources.base_flow_fingerprint == fingerprint

    sparse = resolve_project_flow(
        ResolveProjectOptions(
            project=PROJECT,
            project_root=tmp_path,
            inputs={"step-001-value": "47405"},
        )
    )
    assert input_route_value(sparse.flow) == "47405"
    original_flow = (tmp_path / "ir" / "midscene-flow.json").read_text(encoding="utf-8")
    snapshot_path = write_resolved_flow_snapshot(sparse, tmp_path / "reports")
    assert snapshot_path.name == "resolved-flow.json"
    assert (tmp_path / "ir" / "midscene-flow.json").read_text(encoding="utf-8") == original_flow


def test_resolver_rejects_unknown_input_and_invalid_override(tmp_path: Path) -> None:
    flow, _ = create_project(tmp_path)
    with pytest.raises(ValueError, match="未知输入参数：unknown"):
        resolve_project_flow(
            ResolveProjectOptions(project=PROJECT, project_root=tmp_path, inputs={"unknown": "value"})
        )

    unknown_step = FlowOverrides(
        schema_version="0.1",
        project=PROJECT,
        steps={"step-999": FlowStepPatch(route=RoutePatch(prompt="不存在的目标"))},
    )
    with pytest.raises(ValueError, match="不存在的 step：step-999"):
        validate_overrides(unknown_step, flow)

    invalid_route = FlowOverrides(
        schema_version="0.1",
        project=PROJECT,
        steps={"step-002": FlowStepPatch(route=RoutePatch(strategy="input", value="缺少定位字段"))},
    )
    with pytest.raises(ValueError, match="route 校准无效"):
        validate_overrides(invalid_route, flow)

    with pytest.raises(ValidationError, match="source"):
        FlowStepPatch.model_validate({"source": {"tracePath": "invalid"}})


def test_runtime_inputs_reject_duplicates_and_non_strings(tmp_path: Path) -> None:
    inputs_path = tmp_path / "inputs.json"
    inputs_path.write_text(json.dumps({"from": "SIN"}), encoding="utf-8")
    assert load_runtime_inputs(inputs_path, ["to=LAX"]) == {"from": "SIN", "to": "LAX"}
    with pytest.raises(ValueError, match="输入 from 被重复提供"):
        load_runtime_inputs(inputs_path, ["from=SHA"])
    inputs_path.write_text(json.dumps({"count": 1}), encoding="utf-8")
    with pytest.raises(ValueError, match="必须是字符串"):
        load_runtime_inputs(inputs_path, [])


def test_calibration_requires_current_fingerprint_and_updates_defaults(tmp_path: Path) -> None:
    flow, fingerprint = create_project(tmp_path)
    before_route = flow.steps[0].route
    proposal = CalibrationProposal(
        schema_version="0.1",
        id="fix-input-target",
        project=PROJECT,
        base_flow_fingerprint=fingerprint,
        summary="修正输入框定位与默认值",
        reason="原定位描述不足，默认搜索值需要长期调整",
        changes=[
            CalibrationChange(
                step_id="step-001",
                before=CalibrationBefore(route=before_route),
                after=FlowStepPatch(
                    route=RoutePatch(locate_prompt="页面顶部工具栏中的搜索输入框", value="47405")
                ),
            )
        ],
    )
    proposal_path = tmp_path / "calibration" / "proposals" / "fix-input-target.json"
    write_model(proposal_path, proposal)

    pending = resolve_project_flow(ResolveProjectOptions(project=PROJECT, project_root=tmp_path))
    assert isinstance(pending.flow.steps[0].route, InputRoute)
    assert pending.flow.steps[0].route.locate_prompt == "页面顶部的搜索输入框"
    validate_calibration_proposal(
        CalibrationOptions(project=PROJECT, project_root=tmp_path, proposal="fix-input-target")
    )
    history = apply_calibration_proposal(
        CalibrationOptions(project=PROJECT, project_root=tmp_path, proposal="fix-input-target")
    )
    assert history.status == "applied"
    assert not proposal_path.exists()
    applied = resolve_project_flow(ResolveProjectOptions(project=PROJECT, project_root=tmp_path))
    assert isinstance(applied.flow.steps[0].route, InputRoute)
    assert applied.flow.steps[0].route.locate_prompt == "页面顶部工具栏中的搜索输入框"
    assert applied.flow.steps[0].route.value == "47405"
    config = read_model(tmp_path / "config" / "project.json", TaskProjectConfig, "项目配置")
    assert config.inputs["step-001-value"].default == "47405"

    stale = proposal.model_copy(update={"id": "stale", "base_flow_fingerprint": "0" * 64})
    write_model(tmp_path / "calibration" / "proposals" / "stale.json", stale)
    with pytest.raises(ValueError, match="proposal 已过期"):
        validate_calibration_proposal(
            CalibrationOptions(project=PROJECT, project_root=tmp_path, proposal="stale")
        )


def test_project_listing_validates_task_packages(tmp_path: Path) -> None:
    project_root = tmp_path / PROJECT
    create_project(project_root)
    projects = list_projects(tmp_path)
    assert len(projects) == 1
    assert projects[0]["project"] == PROJECT
    assert "step-001-value" in projects[0]["inputs"]  # type: ignore[operator]
