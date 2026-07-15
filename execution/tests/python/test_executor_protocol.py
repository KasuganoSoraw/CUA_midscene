from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

import pytest

from cua.domain.types import ExecutionOptions, ResolveTaskOptions
from cua.task.executor import execute_yaml, run_prompt, run_task
from cua.task.resolver import resolve_task
from cua.task.yaml_task import read_yaml_document

EXECUTION_ROOT = Path(__file__).resolve().parents[2]
AIR_TASK = EXECUTION_ROOT / "projects" / "browser-demo" / "air-tickets-demo"


def copy_air_scene(projects_root: Path) -> None:
    scene_root = projects_root / "browser-demo"
    scene_root.mkdir(parents=True)
    shutil.copy2(AIR_TASK.parent / "scene.json", scene_root / "scene.json")
    task_root = scene_root / "air-tickets-demo"
    task_root.mkdir()
    shutil.copy2(AIR_TASK / "task.yaml", task_root / "task.yaml")
    shutil.copy2(AIR_TASK / "task.json", task_root / "task.json")


def write_fake_executor(path: Path, behavior: str) -> None:
    path.write_text(
        f"""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
import yaml

parser = argparse.ArgumentParser()
parser.add_argument('--yaml', required=True)
parser.add_argument('--result', required=True)
parser.add_argument('--dry-run', action='store_true')
args = parser.parse_args()
behavior = {behavior!r}
document = yaml.safe_load(Path(args.yaml).read_text(encoding='utf-8'))
if behavior == 'invalid-result':
    Path(args.result).write_text('{{}}', encoding='utf-8')
    raise SystemExit(0)
result = {{
    'schemaVersion': '0.2',
    'status': 'failed' if behavior == 'action-failure' else 'succeeded',
    'sourceYamlPath': str(Path(args.yaml).resolve()),
    'dryRun': args.dry_run,
    'taskCount': len(document['tasks']),
    'finishedAt': datetime.now(timezone.utc).isoformat(),
}}
if behavior == 'action-failure':
    result['error'] = 'KeyboardTypeText 不支持字符'
Path(args.result).write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8')
raise SystemExit(9 if behavior == 'action-failure' else 0)
""".strip()
        + "\n",
        encoding="utf-8",
    )


def test_run_task_uses_same_resolved_yaml_as_inspect(tmp_path: Path) -> None:
    copy_air_scene(tmp_path)
    fake_executor = tmp_path / "success.py"
    write_fake_executor(fake_executor, "success")
    inputs = {"step-002-input": "GOOGLE"}
    inspected = resolve_task(
        ResolveTaskOptions(scene="browser-demo", task="air-tickets-demo", projects_root=tmp_path, inputs=inputs)
    )
    resolved, snapshot_path, result = run_task(
        ExecutionOptions(
            scene="browser-demo",
            task="air-tickets-demo",
            projects_root=tmp_path,
            inputs=inputs,
            dry_run=True,
            command_prefix=(sys.executable, str(fake_executor)),
        )
    )
    assert resolved.document == inspected.document == read_yaml_document(snapshot_path)
    assert result.status == "succeeded"
    assert result.task_count == 16
    assert snapshot_path.name == "resolved-task.yaml"
    assert not (tmp_path / "browser-demo" / "air-tickets-demo" / "resolved-flow.json").exists()


def test_executor_nonzero_exit_preserves_original_error(tmp_path: Path) -> None:
    copy_air_scene(tmp_path)
    fake_executor = tmp_path / "failure.py"
    write_fake_executor(fake_executor, "action-failure")
    with pytest.raises(RuntimeError, match="退出码 9.*KeyboardTypeText 不支持字符"):
        run_task(
            ExecutionOptions(
                scene="browser-demo",
                task="air-tickets-demo",
                projects_root=tmp_path,
                command_prefix=(sys.executable, str(fake_executor)),
            )
        )


def test_executor_rejects_invalid_or_mismatched_result(tmp_path: Path) -> None:
    yaml_path = tmp_path / "task.yaml"
    yaml_path.write_text("tasks:\n  - name: test\n    flow:\n      - sleep: 1\n", encoding="utf-8")
    fake_executor = tmp_path / "invalid.py"
    write_fake_executor(fake_executor, "invalid-result")
    with pytest.raises(RuntimeError, match="未返回有效结果"):
        execute_yaml(
            yaml_path,
            tmp_path / "invalid-result.json",
            dry_run=True,
            command_prefix=(sys.executable, str(fake_executor)),
        )


def test_natural_language_prompt_generates_one_action_yaml(tmp_path: Path) -> None:
    fake_executor = tmp_path / "success.py"
    write_fake_executor(fake_executor, "success")
    yaml_path, result = run_prompt(
        "打开 Chrome 并搜索 GUI agent",
        dry_run=True,
        reports_root=tmp_path / "reports",
        command_prefix=(sys.executable, str(fake_executor)),
    )
    document = read_yaml_document(yaml_path)
    assert document["tasks"][0]["flow"] == [{"ai": "打开 Chrome 并搜索 GUI agent"}]
    assert "KeyboardTypeText" in document["agent"]["aiActContext"]
    assert result.status == "succeeded"
    with pytest.raises(ValueError, match="prompt 不能为空"):
        run_prompt("   ", reports_root=tmp_path / "empty")
