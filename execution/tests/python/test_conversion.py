from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from cua.conversion.input_locate import derive_input_locate_prompt
from cua.conversion.showui_trace import clamp_recorded_wait_ms, convert_trace
from cua.domain.types import ConvertOptions
from cua.models.flow import MidsceneFlow
from cua.models.task import FlowOverrides, TaskProjectConfig

EXECUTION_ROOT = Path(__file__).resolve().parents[2]
AIR_PROJECT = EXECUTION_ROOT / "projects" / "air-tickets-demo"
AIR_GOAL = "将 Qatar Airways 订票页面设置为 Singapore 到 Los Angeles 的单程航班搜索"


@pytest.mark.parametrize(
    ("prompt", "expected"),
    [
        ("在 Chrome 地址栏/搜索栏中输入 {{value}}", "Chrome 地址栏/搜索栏"),
        (
            "在 Book a flight 预订组件的 From（出发地）输入框中输入 {{value}}",
            "Book a flight 预订组件的 From（出发地）输入框",
        ),
        (
            "在 Book a flight 预订组件的 To（目的地）输入框中继续输入 {{value}}，以进一步过滤",
            "Book a flight 预订组件的 To（目的地）输入框",
        ),
    ],
)
def test_derive_input_locate_prompt(prompt: str, expected: str) -> None:
    assert derive_input_locate_prompt(prompt) == expected


def test_derive_input_locate_prompt_fails_for_ambiguous_prompt() -> None:
    with pytest.raises(ValueError, match="无法从 input prompt 推导 locatePrompt"):
        derive_input_locate_prompt("输入 {{value}}")


def test_recorded_wait_bounds() -> None:
    assert clamp_recorded_wait_ms(199) == 0
    assert clamp_recorded_wait_ms(200) == 200
    assert clamp_recorded_wait_ms(30_001) == 30_000


def test_python_converter_preserves_steps_and_existing_config(tmp_path: Path) -> None:
    project_root = tmp_path / "air-tickets-demo"
    shutil.copytree(AIR_PROJECT / "source", project_root / "source")
    (project_root / "config").mkdir(parents=True)
    config_content = (AIR_PROJECT / "config" / "project.json").read_text(encoding="utf-8")
    overrides_content = (AIR_PROJECT / "config" / "flow-overrides.json").read_text(encoding="utf-8")
    (project_root / "config" / "project.json").write_text(config_content, encoding="utf-8")
    (project_root / "config" / "flow-overrides.json").write_text(overrides_content, encoding="utf-8")

    output = convert_trace(
        ConvertOptions(
            project="air-tickets-demo",
            goal=AIR_GOAL,
            project_root=project_root,
            conversion_command=f'uv run cua flow convert --project air-tickets-demo --goal "{AIR_GOAL}"',
        )
    )

    actual = MidsceneFlow.model_validate_json(output.read_text(encoding="utf-8"))
    expected = MidsceneFlow.model_validate_json(
        (AIR_PROJECT / "ir" / "midscene-flow.json").read_text(encoding="utf-8")
    )
    assert [step.to_json_dict() for step in actual.steps] == [step.to_json_dict() for step in expected.steps]
    assert actual.source == expected.source
    assert actual.commands is not None
    assert actual.commands.trace_to_flow_conversion.startswith("uv run cua flow convert")
    assert actual.commands.flow_execution == "uv run cua flow run --project air-tickets-demo"
    assert (project_root / "config" / "project.json").read_text(encoding="utf-8") == config_content
    assert (project_root / "config" / "flow-overrides.json").read_text(encoding="utf-8") == overrides_content


def test_converter_initializes_missing_task_files(tmp_path: Path) -> None:
    project_root = tmp_path / "new-project"
    (project_root / "source").mkdir(parents=True)
    for filename in ("showui-trace.json", "processed-log.json", "processed-log-sc.json"):
        shutil.copy2(AIR_PROJECT / "source" / filename, project_root / "source" / filename)

    convert_trace(
        ConvertOptions(
            project="new-project",
            goal="测试目标",
            project_root=project_root,
            conversion_command="uv run cua flow convert --project new-project --goal 测试目标",
        )
    )

    config = TaskProjectConfig.model_validate_json(
        (project_root / "config" / "project.json").read_text(encoding="utf-8")
    )
    overrides = FlowOverrides.model_validate_json(
        (project_root / "config" / "flow-overrides.json").read_text(encoding="utf-8")
    )
    assert set(config.inputs) == {"step-002-value", "step-008-value", "step-010-value"}
    assert overrides.project == "new-project"
    assert overrides.steps == {}
    assert (project_root / "calibration" / "proposals").is_dir()
    assert (project_root / "calibration" / "history").is_dir()
