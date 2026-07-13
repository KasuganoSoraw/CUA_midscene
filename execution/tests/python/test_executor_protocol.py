from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

import pytest

from cua.domain.types import ExecutionOptions, ResolveProjectOptions
from cua.task.executor import execute_resolved_flow, run_project
from cua.task.resolver import resolve_project_flow

EXECUTION_ROOT = Path(__file__).resolve().parents[2]
AIR_PROJECT = EXECUTION_ROOT / "projects" / "air-tickets-demo"


def copy_air_task(target: Path) -> None:
    shutil.copytree(AIR_PROJECT / "ir", target / "ir")
    shutil.copytree(AIR_PROJECT / "config", target / "config")
    (target / "calibration" / "proposals").mkdir(parents=True)
    (target / "calibration" / "history").mkdir(parents=True)


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
    'project': snapshot['flow']['project'],
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


def test_run_project_uses_same_resolved_flow_as_inspect(tmp_path: Path) -> None:
    project_root = tmp_path / "air-tickets-demo"
    copy_air_task(project_root)
    fake_executor = tmp_path / "success.py"
    write_fake_executor(fake_executor, "success")
    inputs = {"step-002-value": "GOOGLE"}
    inspected = resolve_project_flow(
        ResolveProjectOptions(project="air-tickets-demo", project_root=project_root, inputs=inputs)
    )
    snapshot, result = run_project(
        ExecutionOptions(
            project="air-tickets-demo",
            project_root=project_root,
            inputs=inputs,
            dry_run=True,
            command_prefix=(sys.executable, str(fake_executor)),
        )
    )
    assert snapshot.flow.to_json_dict() == inspected.flow.to_json_dict()
    assert result.status == "succeeded"
    assert result.dry_run is True
    assert result.step_count == 16


def test_executor_nonzero_exit_preserves_step_error(tmp_path: Path) -> None:
    project_root = tmp_path / "air-tickets-demo"
    copy_air_task(project_root)
    fake_executor = tmp_path / "failure.py"
    write_fake_executor(fake_executor, "step-failure")
    with pytest.raises(RuntimeError, match="退出码 9.*step step-002 执行失败"):
        run_project(
            ExecutionOptions(
                project="air-tickets-demo",
                project_root=project_root,
                command_prefix=(sys.executable, str(fake_executor)),
            )
        )


def test_executor_rejects_invalid_result(tmp_path: Path) -> None:
    project_root = tmp_path / "air-tickets-demo"
    copy_air_task(project_root)
    fake_executor = tmp_path / "invalid.py"
    write_fake_executor(fake_executor, "invalid-result")
    with pytest.raises(RuntimeError, match="未返回有效结果"):
        run_project(
            ExecutionOptions(
                project="air-tickets-demo",
                project_root=project_root,
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
        execute_resolved_flow(
            snapshot,
            result,
            dry_run=True,
            command_prefix=(sys.executable, str(fake_executor)),
        )
