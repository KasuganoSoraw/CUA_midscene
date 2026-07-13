from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from pathlib import Path

from pydantic import TypeAdapter, ValidationError

from cua.domain.types import ResolveProjectOptions, ResolvedFlowResult, TaskProjectPaths
from cua.models.flow import InputRoute, MidsceneFlow, MidsceneFlowRoute, MidsceneFlowStep, MidsceneFlowTiming
from cua.models.task import (
    FlowOverrides,
    FlowStepPatch,
    ResolvedFlowSnapshot,
    ResolvedFlowSources,
    TaskInputBinding,
    TaskInputDefinition,
    TaskProjectConfig,
)
from cua.task.io import read_model, write_model

ROUTE_ADAPTER = TypeAdapter(MidsceneFlowRoute)


def task_project_paths(
    project: str,
    project_root: Path | None = None,
    flow_path: Path | None = None,
) -> TaskProjectPaths:
    root = (project_root or Path("projects") / project).resolve()
    return TaskProjectPaths(
        project_root=root,
        flow_path=(flow_path or root / "ir" / "midscene-flow.json").resolve(),
        project_config_path=root / "config" / "project.json",
        overrides_path=root / "config" / "flow-overrides.json",
        proposals_dir=root / "calibration" / "proposals",
        history_dir=root / "calibration" / "history",
        reports_dir=root / "reports",
    )


def fingerprint_flow_content(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def read_flow_with_fingerprint(flow_path: Path) -> tuple[MidsceneFlow, str]:
    try:
        content = flow_path.read_text(encoding="utf-8")
    except Exception as error:
        raise ValueError(f"读取 Midscene flow 失败：{flow_path}\n{error}") from error
    try:
        return MidsceneFlow.model_validate_json(content), fingerprint_flow_content(content)
    except Exception as error:
        raise ValueError(f"解析并验证 Midscene flow 失败：{flow_path}\n{error}") from error


def require_non_empty(value: str, field: str) -> None:
    if not value.strip():
        raise ValueError(f"{field} 必须是非空字符串")


def validate_flow(flow: MidsceneFlow, executable: bool = True) -> None:
    require_non_empty(flow.project, "flow.project")
    ids: set[str] = set()
    for step in flow.steps:
        require_non_empty(step.id, "step.id")
        if step.id in ids:
            raise ValueError(f"flow 包含重复 step id：{step.id}")
        ids.add(step.id)
        if executable and step.route.strategy == "manual-review":
            raise ValueError(f"{step.id}.route 需要人工审查：{step.route.reason}")


def validate_project_config(config: TaskProjectConfig, flow: MidsceneFlow) -> None:
    if config.project != flow.project:
        raise ValueError(f"project.json 项目 {config.project} 与 flow 项目 {flow.project} 不一致")
    require_non_empty(config.title, "project.title")
    step_map = {step.id: step for step in flow.steps}
    for input_id, definition in config.inputs.items():
        require_non_empty(input_id, "input id")
        require_non_empty(definition.label, f"输入 {input_id}.label")
        step = step_map.get(definition.binding.step_id)
        if step is None:
            raise ValueError(f"输入 {input_id} 绑定了不存在的 step：{definition.binding.step_id}")
        if step.route.strategy != "input":
            raise ValueError(f"输入 {input_id} 只能绑定 input route：{step.id}")


def route_patch_data(patch: FlowStepPatch) -> dict[str, object] | None:
    if patch.route is None:
        return None
    return patch.route.model_dump(by_alias=True, exclude_none=True)


def apply_step_patch(step: MidsceneFlowStep, patch: FlowStepPatch) -> MidsceneFlowStep:
    if patch.route is None and patch.timing is None:
        raise ValueError(f"{step.id} 校准必须包含 route 或 timing")
    step_data = step.to_json_dict()
    route_patch = route_patch_data(patch)
    if route_patch is not None:
        patch_strategy = route_patch.get("strategy")
        if patch_strategy is not None and patch_strategy != step.route.strategy:
            candidate = route_patch
        else:
            candidate = {**step.route.to_json_dict(), **route_patch, "strategy": step.route.strategy}
        try:
            step_data["route"] = ROUTE_ADAPTER.validate_python(candidate).to_json_dict()
        except ValidationError as error:
            raise ValueError(f"{step.id}.route 校准无效：{error}") from error

    if patch.timing is not None:
        timing_data = step.timing.to_json_dict() if step.timing else {}
        timing_data.update(patch.timing.to_json_dict())
        timing_data["waitReason"] = "manual-calibration"
        step_data["timing"] = MidsceneFlowTiming.model_validate(timing_data).to_json_dict()
    return MidsceneFlowStep.model_validate(step_data)


def validate_overrides(overrides: FlowOverrides, flow: MidsceneFlow) -> None:
    if overrides.project != flow.project:
        raise ValueError(f"flow-overrides 项目 {overrides.project} 与 flow 项目 {flow.project} 不一致")
    step_map = {step.id: step for step in flow.steps}
    for step_id, patch in overrides.steps.items():
        step = step_map.get(step_id)
        if step is None:
            raise ValueError(f"flow-overrides 引用了不存在的 step：{step_id}")
        apply_step_patch(step, patch)


def apply_overrides(flow: MidsceneFlow, overrides: FlowOverrides) -> MidsceneFlow:
    flow_data = flow.to_json_dict()
    flow_data["steps"] = [
        apply_step_patch(step, overrides.steps[step.id]).to_json_dict()
        if step.id in overrides.steps
        else step.to_json_dict()
        for step in flow.steps
    ]
    return MidsceneFlow.model_validate(flow_data)


def apply_inputs(
    flow: MidsceneFlow,
    config: TaskProjectConfig,
    provided_inputs: dict[str, str],
) -> tuple[MidsceneFlow, dict[str, str]]:
    for input_id in provided_inputs:
        if input_id not in config.inputs:
            raise ValueError(f"未知输入参数：{input_id}")

    flow_data = flow.to_json_dict()
    step_map = {step["id"]: step for step in flow_data["steps"]}  # type: ignore[index]
    values: dict[str, str] = {}
    for input_id, definition in config.inputs.items():
        value = provided_inputs.get(input_id, definition.default)
        values[input_id] = value
        step = step_map.get(definition.binding.step_id)
        if step is None or step["route"]["strategy"] != "input":  # type: ignore[index]
            raise ValueError(f"输入 {input_id} 的绑定已失效：{definition.binding.step_id}")
        step["route"]["value"] = value  # type: ignore[index]
    return MidsceneFlow.model_validate(flow_data), values


def resolve_project_flow(options: ResolveProjectOptions) -> ResolvedFlowResult:
    paths = task_project_paths(options.project, options.project_root, options.flow_path)
    base_flow, fingerprint = read_flow_with_fingerprint(paths.flow_path)
    config = read_model(paths.project_config_path, TaskProjectConfig, "项目配置")
    overrides = read_model(paths.overrides_path, FlowOverrides, "校准配置")
    validate_flow(base_flow, executable=False)
    if base_flow.project != options.project:
        raise ValueError(f"请求项目 {options.project} 与 flow 项目 {base_flow.project} 不一致")
    validate_project_config(config, base_flow)
    validate_overrides(overrides, base_flow)

    calibrated_flow = apply_overrides(base_flow, overrides)
    resolved_flow, values = apply_inputs(calibrated_flow, config, options.inputs or {})
    validate_flow(resolved_flow, executable=options.executable)
    return ResolvedFlowResult(
        flow=resolved_flow,
        sources=ResolvedFlowSources(
            base_flow_path=str(paths.flow_path),
            project_config_path=str(paths.project_config_path),
            overrides_path=str(paths.overrides_path),
            base_flow_fingerprint=fingerprint,
            applied_override_steps=list(overrides.steps),
        ),
        inputs=values,
    )


def create_resolved_flow_snapshot(result: ResolvedFlowResult) -> ResolvedFlowSnapshot:
    return ResolvedFlowSnapshot(
        resolved_at=datetime.now(UTC),
        flow=result.flow,
        sources=result.sources,
        inputs=result.inputs,
    )


def write_resolved_flow_snapshot(result: ResolvedFlowResult, reports_dir: Path) -> Path:
    now = datetime.now(UTC)
    run_id = now.isoformat(timespec="milliseconds").replace(":", "-").replace(".", "-").replace("+00-00", "Z")
    snapshot_path = reports_dir / run_id / "resolved-flow.json"
    write_model(snapshot_path, create_resolved_flow_snapshot(result))
    return snapshot_path


def create_initial_project_config(flow: MidsceneFlow) -> TaskProjectConfig:
    inputs: dict[str, TaskInputDefinition] = {}
    for step in flow.steps:
        if not isinstance(step.route, InputRoute):
            continue
        input_id = f"{step.id}-value"
        inputs[input_id] = TaskInputDefinition(
            type="string",
            label=f"{step.route.locate_prompt}输入值",
            description=step.route.prompt,
            default=step.route.value,
            binding=TaskInputBinding(step_id=step.id, field="route.value"),
        )
    return TaskProjectConfig(
        project=flow.project,
        title=flow.project,
        description=flow.goal,
        goal=flow.goal,
        inputs=inputs,
    )


def create_empty_overrides(project: str) -> FlowOverrides:
    return FlowOverrides(project=project, steps={})
