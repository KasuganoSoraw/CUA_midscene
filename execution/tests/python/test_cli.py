from __future__ import annotations

import json
from pathlib import Path

import pytest

from cua.cli.main import main

EXECUTION_ROOT = Path(__file__).resolve().parents[2]
AIR_PROJECT = EXECUTION_ROOT / "projects" / "air-tickets-demo"


def test_project_list_json(capsys: pytest.CaptureFixture[str]) -> None:
    main(["project", "list", "--projects-root", str(EXECUTION_ROOT / "projects"), "--json"])
    result = json.loads(capsys.readouterr().out)
    assert result["projects"][0]["project"] == "air-tickets-demo"
    assert "step-002-value" in result["projects"][0]["inputs"]


def test_flow_inspect_applies_only_explicit_input(capsys: pytest.CaptureFixture[str]) -> None:
    main(
        [
            "flow",
            "inspect",
            "--project",
            "air-tickets-demo",
            "--project-root",
            str(AIR_PROJECT),
            "--input",
            "step-002-value=GOOGLE",
        ]
    )
    result = json.loads(capsys.readouterr().out)
    assert result["inputs"]["step-002-value"] == "GOOGLE"
    assert result["inputs"]["step-008-value"] == "SINGAPORE"
    assert result["flow"]["steps"][1]["route"]["value"] == "GOOGLE"
    assert result["flow"]["steps"][7]["route"]["value"] == "SINGAPORE"


def test_cli_rejects_duplicate_single_value_argument() -> None:
    with pytest.raises(SystemExit) as error:
        main(
            [
                "flow",
                "inspect",
                "--project",
                "first",
                "--project",
                "second",
            ]
        )
    assert error.value.code == 2


def test_calibration_apply_requires_confirmation(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as error:
        main(
            [
                "calibration",
                "apply",
                "--project",
                "air-tickets-demo",
                "--project-root",
                str(AIR_PROJECT),
                "--proposal",
                "not-applied",
            ]
        )
    assert error.value.code == 1
    assert "必须取得用户明确确认" in capsys.readouterr().err
