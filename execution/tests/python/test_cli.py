from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from cua.cli.main import build_parser, main, validate_act_run_args

EXECUTION_ROOT = Path(__file__).resolve().parents[2]
PROJECTS_ROOT = EXECUTION_ROOT / "projects"


def test_scene_and_task_list_json(capsys: pytest.CaptureFixture[str]) -> None:
    main(["scene", "list", "--json"])
    assert json.loads(capsys.readouterr().out)["scenes"][0]["scene"] == "browser-demo"
    main(["task", "list", "--scene", "browser-demo", "--json"])
    result = json.loads(capsys.readouterr().out)
    assert result["tasks"][0]["task"] == "air-tickets-demo"
    assert list(result["tasks"][0]["inputs"]) == [
        "step-002-input",
        "step-008-input",
        "step-010-input",
    ]
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
            "--input",
            "step-002-input=GOOGLE",
            "--json",
        ]
    )
    result = json.loads(capsys.readouterr().out)
    assert result["inputs"]["step-002-input"] == "GOOGLE"
    assert result["inputs"]["step-008-input"] == "SINGAPORE"
    assert result["yaml"]["tasks"][1]["flow"][1]["KeyboardTypeText"]["value"] == "GOOGLE"


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


def test_act_accepts_exactly_one_prompt_or_recorded_task_source() -> None:
    parser = build_parser()
    prompt_args = parser.parse_args(["act", "run", "--prompt", "打开 Chrome"])
    validate_act_run_args(parser, prompt_args)
    task_args = parser.parse_args(
        ["act", "run", "--scene", "browser-demo", "--task", "air-tickets-demo"]
    )
    validate_act_run_args(parser, task_args)

    with pytest.raises(SystemExit) as missing:
        main(["act", "run"])
    assert missing.value.code == 2
    with pytest.raises(SystemExit) as mixed:
        main(
            [
                "act",
                "run",
                "--prompt",
                "打开 Chrome",
                "--scene",
                "browser-demo",
                "--task",
                "air-tickets-demo",
            ]
        )
    assert mixed.value.code == 2
    with pytest.raises(SystemExit) as incomplete:
        main(["act", "run", "--scene", "browser-demo"])
    assert incomplete.value.code == 2
    with pytest.raises(SystemExit) as prompt_input:
        main(["act", "run", "--prompt", "打开 Chrome", "--input", "query=value"])
    assert prompt_input.value.code == 2


def test_act_recorded_task_routes_inputs_and_outputs_artifacts(
    capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    executor_result = SimpleNamespace(to_json_dict=lambda: {"status": "succeeded"})
    run = SimpleNamespace(
        resolved=SimpleNamespace(inputs={"step-002-input": "GOOGLE"}, origin="builtin", writable=False),
        resolved_task_path=tmp_path / "resolved-task.yaml",
        prompt_path=tmp_path / "ai-act-prompt.txt",
        ai_act_yaml_path=tmp_path / "ai-act-task.yaml",
        executor_result=executor_result,
        run_dir=tmp_path,
    )

    def fake_run(options: object) -> object:
        assert getattr(options, "inputs") == {"step-002-input": "GOOGLE"}
        assert getattr(options, "dry_run") is True
        return run

    monkeypatch.setattr("cua.task.executor.run_recorded_task_ai_act", fake_run)
    main(
        [
            "act",
            "run",
            "--scene",
            "browser-demo",
            "--task",
            "air-tickets-demo",
            "--data-root",
            str(tmp_path),
            "--input",
            "step-002-input=GOOGLE",
            "--dry-run",
        ]
    )
    result = json.loads(capsys.readouterr().out)
    assert result["mode"] == "recorded-task"
    assert result["inputs"] == {"step-002-input": "GOOGLE"}
    assert result["promptPath"].endswith("ai-act-prompt.txt")
    assert result["aiActYamlPath"].endswith("ai-act-task.yaml")


def test_task_rejects_unknown_input_before_executor(
    capsys: pytest.CaptureFixture[str], tmp_path: Path
) -> None:
    with pytest.raises(SystemExit) as error:
        main(
            [
                "task",
                "run",
                "--scene",
                "browser-demo",
                "--task",
                "air-tickets-demo",
                "--data-root",
                str(tmp_path),
                "--input",
                "unknown=value",
                "--dry-run",
            ]
        )
    assert error.value.code == 1
    assert "未知输入参数：unknown" in capsys.readouterr().err


def test_act_recorded_task_rejects_unknown_input_before_executor(
    capsys: pytest.CaptureFixture[str], tmp_path: Path,
) -> None:
    with pytest.raises(SystemExit) as error:
        main(
            [
                "act",
                "run",
                "--scene",
                "browser-demo",
                "--task",
                "air-tickets-demo",
                "--data-root",
                str(tmp_path),
                "--input",
                "unknown=value",
                "--dry-run",
            ]
        )
    assert error.value.code == 1
    assert "未知输入参数：unknown" in capsys.readouterr().err
