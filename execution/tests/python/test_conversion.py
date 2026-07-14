from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from cua.conversion.showui_trace import clamp_recorded_wait_ms, convert_trace
from cua.domain.types import ConvertOptions
from cua.models.flow import MidsceneFlow
from cua.models.task import SceneManifest, TaskManifest

EXECUTION_ROOT = Path(__file__).resolve().parents[2]
AIR_TASK = EXECUTION_ROOT / "projects" / "browser-demo" / "air-tickets-demo"
AIR_GOAL = "将 Qatar Airways 订票页面设置为 Singapore 到 Los Angeles 的单程航班搜索"


def options(projects_root: Path, task: str) -> ConvertOptions:
    return ConvertOptions(
        scene="browser-demo",
        task=task,
        goal=AIR_GOAL,
        projects_root=projects_root,
        conversion_command=(
            f'uv run cua task init-from-trace --scene browser-demo --task {task} --goal "{AIR_GOAL}"'
        ),
    )


def copy_source(projects_root: Path, task: str) -> Path:
    task_root = projects_root / "browser-demo" / task
    shutil.copytree(AIR_TASK / "source", task_root / "source")
    return task_root


def test_recorded_wait_bounds() -> None:
    assert clamp_recorded_wait_ms(199) == 0
    assert clamp_recorded_wait_ms(200) == 200
    assert clamp_recorded_wait_ms(30_001) == 30_000


def test_python_converter_initializes_canonical_flow(tmp_path: Path) -> None:
    task_root = copy_source(tmp_path, "new-task")
    output = convert_trace(options(tmp_path, "new-task"))
    actual = MidsceneFlow.model_validate_json(output.read_text(encoding="utf-8"))
    expected = MidsceneFlow.model_validate_json((AIR_TASK / "midscene-flow.json").read_text(encoding="utf-8"))
    assert [step.to_json_dict() for step in actual.steps] == [step.to_json_dict() for step in expected.steps]
    assert actual.scene == "browser-demo"
    assert actual.task == "new-task"
    assert actual.commands is not None
    assert actual.commands.trace_to_flow_conversion.startswith("uv run cua task init-from-trace")
    assert actual.commands.flow_execution == "uv run cua flow run --scene browser-demo --task new-task"

    scene = SceneManifest.model_validate_json((task_root.parent / "scene.json").read_text(encoding="utf-8"))
    task = TaskManifest.model_validate_json((task_root / "task.json").read_text(encoding="utf-8"))
    assert scene.scene == "browser-demo"
    assert set(task.inputs) == {"step-002-value", "step-008-value", "step-010-value"}
    assert "default" not in task.inputs["step-002-value"].to_json_dict()
    assert (task_root.parent / "SKILL.md").is_file()
    assert (task_root / "SKILL.md").is_file()


def test_converter_rejects_existing_flow_without_modifying_it(tmp_path: Path) -> None:
    task_root = copy_source(tmp_path, "existing-task")
    flow_path = task_root / "midscene-flow.json"
    flow_path.write_text('{"preserve": true}\n', encoding="utf-8")
    before = flow_path.read_bytes()
    with pytest.raises(ValueError, match="任务 flow 已存在，拒绝覆盖"):
        convert_trace(options(tmp_path, "existing-task"))
    assert flow_path.read_bytes() == before


def test_converter_rejects_missing_structured_operation(tmp_path: Path) -> None:
    task_root = copy_source(tmp_path, "missing-operation")
    trace_path = task_root / "source" / "showui-trace.json"
    trace = json.loads(trace_path.read_text(encoding="utf-8"))
    del trace["trajectory"][0]["caption"]["operation"]
    trace_path.write_text(json.dumps(trace, ensure_ascii=False), encoding="utf-8")
    with pytest.raises(ValueError, match="Field required"):
        convert_trace(options(tmp_path, "missing-operation"))
    assert not (task_root / "midscene-flow.json").exists()


def test_converter_rejects_input_without_locate_prompt(tmp_path: Path) -> None:
    task_root = copy_source(tmp_path, "missing-locate")
    trace_path = task_root / "source" / "showui-trace.json"
    trace = json.loads(trace_path.read_text(encoding="utf-8"))
    del trace["trajectory"][1]["caption"]["operation"]["locatePrompt"]
    trace_path.write_text(json.dumps(trace, ensure_ascii=False), encoding="utf-8")
    with pytest.raises(ValueError, match=r"trace step 2 的 operation\.locatePrompt 不能为空"):
        convert_trace(options(tmp_path, "missing-locate"))
    assert not (task_root / "midscene-flow.json").exists()
