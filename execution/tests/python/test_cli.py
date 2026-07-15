from __future__ import annotations

import json
from pathlib import Path

import pytest

from cua.cli.main import main

EXECUTION_ROOT = Path(__file__).resolve().parents[2]
PROJECTS_ROOT = EXECUTION_ROOT / "projects"


def test_scene_and_task_list_json(capsys: pytest.CaptureFixture[str]) -> None:
    main(["scene", "list", "--projects-root", str(PROJECTS_ROOT), "--json"])
    assert json.loads(capsys.readouterr().out)["scenes"][0]["scene"] == "browser-demo"
    main(["task", "list", "--scene", "browser-demo", "--projects-root", str(PROJECTS_ROOT), "--json"])
    result = json.loads(capsys.readouterr().out)
    assert result["tasks"][0]["task"] == "air-tickets-demo"
    assert list(result["tasks"][0]["inputs"]) == ["input-001", "input-002", "input-003"]
    assert result["tasks"][0]["taskYamlPath"].endswith("task.yaml")


def test_task_inspect_applies_only_explicit_input(capsys: pytest.CaptureFixture[str]) -> None:
    main(
        [
            "task",
            "inspect",
            "--scene",
            "browser-demo",
            "--task",
            "air-tickets-demo",
            "--projects-root",
            str(PROJECTS_ROOT),
            "--input",
            "input-001=GOOGLE",
            "--json",
        ]
    )
    result = json.loads(capsys.readouterr().out)
    assert result["inputs"]["input-001"] == "GOOGLE"
    assert result["inputs"]["input-002"] == "SINGAPORE"
    assert result["yaml"]["tasks"][0]["flow"][2]["KeyboardTypeText"]["value"] == "GOOGLE"


def test_cli_rejects_duplicate_single_value_argument() -> None:
    with pytest.raises(SystemExit) as error:
        main(["task", "inspect", "--scene", "first", "--scene", "second", "--task", "demo"])
    assert error.value.code == 2


def test_removed_flow_and_calibration_commands_are_rejected() -> None:
    with pytest.raises(SystemExit) as flow_error:
        main(["flow", "inspect"])
    assert flow_error.value.code == 2
    with pytest.raises(SystemExit) as calibration_error:
        main(["calibration", "apply"])
    assert calibration_error.value.code == 2


def test_act_only_accepts_prompt() -> None:
    with pytest.raises(SystemExit) as missing:
        main(["act", "run"])
    assert missing.value.code == 2
    with pytest.raises(SystemExit) as task_mode:
        main(["act", "run", "--scene", "browser-demo", "--task", "air-tickets-demo"])
    assert task_mode.value.code == 2


def test_task_rejects_unknown_input_before_executor(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as error:
        main(
            [
                "task",
                "run",
                "--scene",
                "browser-demo",
                "--task",
                "air-tickets-demo",
                "--projects-root",
                str(PROJECTS_ROOT),
                "--input",
                "unknown=value",
                "--dry-run",
            ]
        )
    assert error.value.code == 1
    assert "未知输入参数：unknown" in capsys.readouterr().err
