from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from cua.domain.types import ResolveTaskOptions, ResolvedFlowResult, TaskPaths
from cua.models.flow import InputRoute, MidsceneFlow
from cua.models.task import (
    RESOLVED_FLOW_SCHEMA_VERSION,
    ResolvedFlowSnapshot,
    ResolvedFlowSources,
    SceneManifest,
    TaskInputBinding,
    TaskInputDefinition,
    TaskManifest,
)
from cua.task.io import read_model, write_model


def task_paths(
    scene: str,
    task: str,
    projects_root: Path | None = None,
    task_root: Path | None = None,
    flow_path: Path | None = None,
) -> TaskPaths:
    projects = (projects_root or Path("projects")).resolve()
    root = (task_root or projects / scene / task).resolve()
    scene_root = root.parent
    return TaskPaths(
        scene_root=scene_root,
        task_root=root,
        scene_manifest_path=scene_root / "scene.json",
        task_manifest_path=root / "task.json",
        flow_path=(flow_path or root / "midscene-flow.json").resolve(),
        reports_dir=root / "reports",
    )


def require_non_empty(value: str, field: str) -> None:
    if not value.strip():
        raise ValueError(f"{field} 必须是非空字符串")


def read_flow(flow_path: Path) -> MidsceneFlow:
    return read_model(flow_path, MidsceneFlow, "Midscene flow")


def validate_flow(flow: MidsceneFlow, executable: bool = True) -> None:
    require_non_empty(flow.scene, "flow.scene")
    require_non_empty(flow.task, "flow.task")
    ids: set[str] = set()
    for step in flow.steps:
        require_non_empty(step.id, "step.id")
        if step.id in ids:
            raise ValueError(f"flow 包含重复 step id：{step.id}")
        ids.add(step.id)
        if executable and step.route.strategy == "manual-review":
            raise ValueError(f"{step.id}.route 需要人工审查：{step.route.reason}")


def validate_manifests(scene: SceneManifest, task: TaskManifest, flow: MidsceneFlow) -> None:
    if scene.scene != flow.scene:
        raise ValueError(f"scene.json 场景 {scene.scene} 与 flow 场景 {flow.scene} 不一致")
    if task.scene != flow.scene or task.task != flow.task:
        raise ValueError(
            f"task.json 标识 {task.scene}/{task.task} 与 flow 标识 {flow.scene}/{flow.task} 不一致"
        )
    require_non_empty(scene.title, "scene.title")
    require_non_empty(task.title, "task.title")
    step_map = {step.id: step for step in flow.steps}
    for input_id, definition in task.inputs.items():
        require_non_empty(input_id, "input id")
        require_non_empty(definition.label, f"输入 {input_id}.label")
        step = step_map.get(definition.binding.step_id)
        if step is None:
            raise ValueError(f"输入 {input_id} 绑定了不存在的 step：{definition.binding.step_id}")
        if step.route.strategy != "input":
            raise ValueError(f"输入 {input_id} 只能绑定 input route：{step.id}")


def apply_inputs(
    flow: MidsceneFlow,
    task: TaskManifest,
    provided_inputs: dict[str, str],
) -> tuple[MidsceneFlow, dict[str, str]]:
    for input_id in provided_inputs:
        if input_id not in task.inputs:
            raise ValueError(f"未知输入参数：{input_id}")

    flow_data = flow.to_json_dict()
    step_map = {step["id"]: step for step in flow_data["steps"]}  # type: ignore[index]
    values: dict[str, str] = {}
    for input_id, definition in task.inputs.items():
        step = step_map.get(definition.binding.step_id)
        if step is None or step["route"]["strategy"] != "input":  # type: ignore[index]
            raise ValueError(f"输入 {input_id} 的绑定已失效：{definition.binding.step_id}")
        route = step["route"]  # type: ignore[index]
        if input_id in provided_inputs:
            route["value"] = provided_inputs[input_id]
        values[input_id] = route["value"]
    return MidsceneFlow.model_validate(flow_data), values


def resolve_task_flow(options: ResolveTaskOptions) -> ResolvedFlowResult:
    paths = task_paths(
        options.scene,
        options.task,
        options.projects_root,
        options.task_root,
        options.flow_path,
    )
    flow = read_flow(paths.flow_path)
    scene = read_model(paths.scene_manifest_path, SceneManifest, "场景清单")
    task = read_model(paths.task_manifest_path, TaskManifest, "任务清单")
    validate_flow(flow, executable=False)
    if flow.scene != options.scene or flow.task != options.task:
        raise ValueError(
            f"请求任务 {options.scene}/{options.task} 与 flow 标识 {flow.scene}/{flow.task} 不一致"
        )
    validate_manifests(scene, task, flow)
    resolved_flow, values = apply_inputs(flow, task, options.inputs or {})
    validate_flow(resolved_flow, executable=options.executable)
    return ResolvedFlowResult(
        flow=resolved_flow,
        sources=ResolvedFlowSources(
            flow_path=str(paths.flow_path),
            task_path=str(paths.task_manifest_path),
        ),
        inputs=values,
    )


def create_resolved_flow_snapshot(result: ResolvedFlowResult) -> ResolvedFlowSnapshot:
    return ResolvedFlowSnapshot(
        schema_version=RESOLVED_FLOW_SCHEMA_VERSION,
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


def create_initial_task_manifest(flow: MidsceneFlow) -> TaskManifest:
    inputs: dict[str, TaskInputDefinition] = {}
    for step in flow.steps:
        if not isinstance(step.route, InputRoute):
            continue
        input_id = f"{step.id}-value"
        inputs[input_id] = TaskInputDefinition(
            type="string",
            label=step.route.locate_prompt,
            description=step.route.prompt,
            binding=TaskInputBinding(step_id=step.id, field="route.value"),
        )
    return TaskManifest(
        schema_version="0.1",
        scene=flow.scene,
        task=flow.task,
        title=flow.task,
        description=flow.goal,
        goal=flow.goal,
        inputs=inputs,
    )
