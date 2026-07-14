from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

import pytest

from cua.domain.types import ExecutionOptions, ResolveTaskOptions
from cua.task.executor import execute_resolved_flow, run_task
from cua.task.resolver import resolve_task_flow

EXECUTION_ROOT = Path(__file__).resolve().parents[2]
AIR_TASK = EXECUTION_ROOT / "projects" / "browser-demo" / "air-tickets-demo"


def copy_air_scene(projects_root: Path) -> None:
    scene_root = projects_root / "browser-demo"
    scene_root.mkdir(parents=True)
    shutil.copy2(AIR_TASK.parent / "scene.json", scene_root / "scene.json")
    task_root = scene_root / "air-tickets-demo"
    task_root.mkdir()
    shutil.copy2(AIR_TASK / "midscene-flow.json", task_root / "midscene-flow.json")
    shutil.copy2(AIR_TASK / "task.json", task_root / "task.json")


def write_fake_executor(path: Path, behavior: str) -> None:
    path.write_text(
        f"""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--resolved-flow', required=True)
parser.add_argument('--result', required=True)
parser.add_argument('--dry-run', action='store_true')
args = parser.parse_args()
snapshot = json.loads(Path(args.resolved_flow).read_text(encoding='utf-8'))
behavior = {behavior!r}
if behavior == 'invalid-result':
    Path(args.result).write_text('{{}}', encoding='utf-8')
    raise SystemExit(0)
result = {{
    'schemaVersion': '0.1',
    'status': 'failed' if behavior == 'step-failure' else 'succeeded',
    'scene': snapshot['flow']['scene'],
    'task': snapshot['flow']['task'],
    'resolvedFlowPath': str(Path(args.resolved_flow).resolve()),
    'dryRun': args.dry_run,
    'stepCount': len(snapshot['flow']['steps']),
    'completedStepIds': [] if args.dry_run else [step['id'] for step in snapshot['flow']['steps']],
    'finishedAt': datetime.now(timezone.utc).isoformat(),
}}
if behavior == 'step-failure':
    result['error'] = 'step step-002 执行失败'
Path(args.result).write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8')
raise SystemExit(9 if behavior == 'step-failure' else 0)
""".strip()
        + "\n",
        encoding="utf-8",
    )


def test_run_task_uses_same_resolved_flow_as_inspect(tmp_path: Path) -> None:
    copy_air_scene(tmp_path)
    fake_executor = tmp_path / "success.py"
    write_fake_executor(fake_executor, "success")
    inputs = {"step-002-value": "GOOGLE"}
    inspected = resolve_task_flow(
        ResolveTaskOptions(scene="browser-demo", task="air-tickets-demo", projects_root=tmp_path, inputs=inputs)
    )
    snapshot, result = run_task(
        ExecutionOptions(
            scene="browser-demo",
            task="air-tickets-demo",
            projects_root=tmp_path,
            inputs=inputs,
            dry_run=True,
            command_prefix=(sys.executable, str(fake_executor)),
        )
    )
    assert snapshot.flow.to_json_dict() == inspected.flow.to_json_dict()
    assert result.status == "succeeded"
    assert result.scene == "browser-demo"
    assert result.task == "air-tickets-demo"
    assert result.step_count == 16


def test_executor_nonzero_exit_preserves_step_error(tmp_path: Path) -> None:
    copy_air_scene(tmp_path)
    fake_executor = tmp_path / "failure.py"
    write_fake_executor(fake_executor, "step-failure")
    with pytest.raises(RuntimeError, match="退出码 9.*step step-002 执行失败"):
        run_task(
            ExecutionOptions(
                scene="browser-demo",
                task="air-tickets-demo",
                projects_root=tmp_path,
                command_prefix=(sys.executable, str(fake_executor)),
            )
        )


def test_executor_rejects_invalid_result(tmp_path: Path) -> None:
    copy_air_scene(tmp_path)
    fake_executor = tmp_path / "invalid.py"
    write_fake_executor(fake_executor, "invalid-result")
    with pytest.raises(RuntimeError, match="未返回有效结果"):
        run_task(
            ExecutionOptions(
                scene="browser-demo",
                task="air-tickets-demo",
                projects_root=tmp_path,
                dry_run=True,
                command_prefix=(sys.executable, str(fake_executor)),
            )
        )


def test_executor_rejects_mismatched_result_path(tmp_path: Path) -> None:
    snapshot = tmp_path / "resolved-flow.json"
    snapshot.write_text("{}", encoding="utf-8")
    result = tmp_path / "execution-result.json"
    fake_executor = tmp_path / "success.py"
    write_fake_executor(fake_executor, "success")
    with pytest.raises(RuntimeError):
        execute_resolved_flow(snapshot, result, dry_run=True, command_prefix=(sys.executable, str(fake_executor)))
