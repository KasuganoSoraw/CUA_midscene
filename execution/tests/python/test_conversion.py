from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from cua.conversion.showui_trace import clamp_recorded_wait_ms, convert_trace
from cua.domain.types import ConvertOptions
from cua.models.task import TaskManifest
from cua.task.yaml_task import read_yaml_document

EXECUTION_ROOT = Path(__file__).resolve().parents[2]
AIR_TASK = EXECUTION_ROOT / "projects" / "browser-demo" / "air-tickets-demo"
AIR_GOAL = "将 Qatar Airways 订票页面设置为 Singapore 到 Los Angeles 的单程航班搜索"


def options(projects_root: Path, task: str) -> ConvertOptions:
    return ConvertOptions(
        scene="browser-demo",
        task=task,
        goal=AIR_GOAL,
        projects_root=projects_root,
        conversion_command=f"uv run cua task init-from-trace --scene browser-demo --task {task}",
    )


def copy_source(projects_root: Path, task: str) -> Path:
    task_root = projects_root / "browser-demo" / task
    shutil.copytree(AIR_TASK / "source", task_root / "source")
    return task_root


def test_recorded_wait_bounds() -> None:
    assert clamp_recorded_wait_ms(199) == 0
    assert clamp_recorded_wait_ms(200) == 200
    assert clamp_recorded_wait_ms(30_001) == 30_000


def test_converter_generates_midscene_yaml_and_trace_inputs(tmp_path: Path) -> None:
    task_root = copy_source(tmp_path, "new-task")
    output = convert_trace(options(tmp_path, "new-task"))
    document = read_yaml_document(output)
    manifest = TaskManifest.model_validate_json((task_root / "task.json").read_text(encoding="utf-8"))
    tasks = document["tasks"]

    assert output.name == "task.yaml"
    assert document["computer"] == {}
    assert document["agent"] == {
        "groupName": "new-task",
        "groupDescription": AIR_GOAL,
        "generateReport": True,
    }
    assert len(tasks) == 16
    assert tasks[0] == {
        "name": "step-001 | click",
        "flow": [{"aiTap": "点击 Chrome 浏览器顶部的地址栏/搜索栏区域以聚焦输入框"}],
    }
    assert tasks[1]["name"] == "step-002 | input"
    assert tasks[1]["flow"][0] == {"sleep": 4101}
    assert tasks[1]["flow"][1]["KeyboardTypeText"]["value"] == "{{step-002-input}}"
    assert tasks[2] == {
        "name": "step-003 | keyboard",
        "flow": [{"sleep": 394}, {"KeyboardPress": {"keyName": "Enter"}}],
    }
    assert list(manifest.inputs) == ["step-002-input", "step-008-input", "step-010-input"]
    assert manifest.inputs["step-002-input"].default == "QATAR AIRWAYS"
    assert manifest.inputs["step-008-input"].default == "SINGAPORE"
    assert manifest.source.trace_path == "source/showui-trace.json"
    assert not (task_root / "midscene-flow.json").exists()


def test_converter_rejects_existing_assets(tmp_path: Path) -> None:
    task_root = copy_source(tmp_path, "existing-task")
    (task_root / "task.yaml").write_text("preserve: true\n", encoding="utf-8")
    with pytest.raises(ValueError, match="任务资产已存在，拒绝覆盖"):
        convert_trace(options(tmp_path, "existing-task"))
    assert (task_root / "task.yaml").read_text(encoding="utf-8") == "preserve: true\n"


def test_converter_rejects_missing_operation_and_does_not_guess(tmp_path: Path) -> None:
    task_root = copy_source(tmp_path, "missing-operation")
    trace_path = task_root / "source" / "showui-trace.json"
    trace = json.loads(trace_path.read_text(encoding="utf-8"))
    del trace["trajectory"][0]["caption"]["operation"]
    trace_path.write_text(json.dumps(trace, ensure_ascii=False), encoding="utf-8")
    with pytest.raises(ValueError, match="Field required"):
        convert_trace(options(tmp_path, "missing-operation"))
    assert not (task_root / "task.yaml").exists()


def test_converter_rejects_input_without_locate_prompt(tmp_path: Path) -> None:
    task_root = copy_source(tmp_path, "missing-locate")
    trace_path = task_root / "source" / "showui-trace.json"
    trace = json.loads(trace_path.read_text(encoding="utf-8"))
    del trace["trajectory"][1]["caption"]["operation"]["locatePrompt"]
    trace_path.write_text(json.dumps(trace, ensure_ascii=False), encoding="utf-8")
    with pytest.raises(ValueError, match=r"trace step 2 的 operation\.locatePrompt 不能为空"):
        convert_trace(options(tmp_path, "missing-locate"))


def test_converter_rejects_trace_and_log_length_mismatch(tmp_path: Path) -> None:
    task_root = copy_source(tmp_path, "mismatch")
    log_path = task_root / "source" / "processed-log-sc.json"
    log = json.loads(log_path.read_text(encoding="utf-8"))
    log_path.write_text(json.dumps(log[:-1], ensure_ascii=False), encoding="utf-8")
    with pytest.raises(ValueError, match="数量.*不一致"):
        convert_trace(options(tmp_path, "mismatch"))


@pytest.mark.parametrize(("first_step", "second_step"), [(0, 2), (1, 1), (2, 1)])
def test_converter_rejects_invalid_or_unordered_step_ids(
    tmp_path: Path, first_step: int, second_step: int
) -> None:
    task_name = f"invalid-steps-{first_step}-{second_step}"
    task_root = copy_source(tmp_path, task_name)
    trace_path = task_root / "source" / "showui-trace.json"
    trace = json.loads(trace_path.read_text(encoding="utf-8"))
    trace["trajectory"][0]["step_idx"] = first_step
    trace["trajectory"][1]["step_idx"] = second_step
    trace_path.write_text(json.dumps(trace, ensure_ascii=False), encoding="utf-8")

    with pytest.raises(ValueError, match="正整数、唯一且按轨迹顺序严格递增"):
        convert_trace(options(tmp_path, task_name))
    assert not (task_root / "task.yaml").exists()
