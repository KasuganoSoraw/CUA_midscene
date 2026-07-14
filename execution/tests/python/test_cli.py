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
    assert "step-002-value" in result["tasks"][0]["inputs"]


def test_flow_inspect_applies_only_explicit_input(capsys: pytest.CaptureFixture[str]) -> None:
    main(
        [
            "flow", "inspect",
            "--scene", "browser-demo",
            "--task", "air-tickets-demo",
            "--projects-root", str(PROJECTS_ROOT),
            "--input", "step-002-value=GOOGLE",
        ]
    )
    result = json.loads(capsys.readouterr().out)
    assert result["inputs"]["step-002-value"] == "GOOGLE"
    assert result["inputs"]["step-008-value"] == "SINGAPORE"
    assert result["flow"]["steps"][1]["route"]["value"] == "GOOGLE"
    assert result["flow"]["steps"][7]["route"]["value"] == "SINGAPORE"


def test_cli_rejects_duplicate_single_value_argument() -> None:
    with pytest.raises(SystemExit) as error:
        main(["flow", "inspect", "--scene", "first", "--scene", "second", "--task", "demo"])
    assert error.value.code == 2


def test_removed_project_and_calibration_commands_are_rejected() -> None:
    with pytest.raises(SystemExit) as project_error:
        main(["project", "list"])
    assert project_error.value.code == 2
    with pytest.raises(SystemExit) as calibration_error:
        main(["calibration", "apply"])
    assert calibration_error.value.code == 2
