from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

import pytest

from cua.domain.types import ExecutionOptions, ResolveTaskOptions
from cua.task.ai_act import execute_ai_act, run_prompt_ai_act, run_task_ai_act
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


def write_fake_ai_act_executor(path: Path, behavior: str) -> None:
    path.write_text(
        f"""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

parser = argparse.ArgumentParser()
source = parser.add_mutually_exclusive_group(required=True)
source.add_argument('--prompt-file')
source.add_argument('--resolved-flow')
parser.add_argument('--result', required=True)
parser.add_argument('--dry-run', action='store_true')
args = parser.parse_args()
behavior = {behavior!r}
source_path = Path(args.prompt_file or args.resolved_flow).resolve()
mode = 'prompt' if args.prompt_file else 'task'
scene = task = None
if mode == 'task':
    snapshot = json.loads(source_path.read_text(encoding='utf-8'))
    scene = snapshot['flow']['scene']
    task = snapshot['flow']['task']
prompt_path = Path(args.result).resolve().parent / 'ai-act-prompt.txt'
prompt_path.parent.mkdir(parents=True, exist_ok=True)
prompt_path.write_text('最终 aiAct prompt\\n', encoding='utf-8')
if behavior == 'invalid-result':
    Path(args.result).write_text('{{}}', encoding='utf-8')
    raise SystemExit(0)
result = {{
    'schemaVersion': '0.1',
    'status': 'failed' if behavior == 'failure' else 'succeeded',
    'mode': mode,
    'promptPath': str(prompt_path),
    'sourcePath': str(source_path),
    'dryRun': args.dry_run,
    'finishedAt': datetime.now(timezone.utc).isoformat(),
}}
if scene is not None:
    result['scene'] = scene
    result['task'] = task
if behavior == 'failure':
    result['error'] = 'aiAct 原始规划错误'
else:
    result['aiActResult'] = '执行完成'
Path(args.result).write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8')
raise SystemExit(7 if behavior == 'failure' else 0)
""".strip()
        + "\n",
        encoding="utf-8",
    )


def test_prompt_mode_writes_global_report_and_preserves_result(tmp_path: Path) -> None:
    fake = tmp_path / "success.py"
    write_fake_ai_act_executor(fake, "success")
    reports = tmp_path / "reports"
    result = run_prompt_ai_act(
        "打开 Chrome 并搜索 GUI agent",
        dry_run=True,
        reports_root=reports,
        command_prefix=(sys.executable, str(fake)),
    )
    assert result.mode == "prompt"
    assert result.ai_act_result == "执行完成"
    assert Path(result.source_path).parent.parent == reports.resolve()
    assert Path(result.source_path).read_text(encoding="utf-8") == "打开 Chrome 并搜索 GUI agent\n"


def test_task_mode_uses_same_resolved_parameters_as_inspect(tmp_path: Path) -> None:
    copy_air_scene(tmp_path)
    fake = tmp_path / "success.py"
    write_fake_ai_act_executor(fake, "success")
    inputs = {"step-008-value": "TOKYO"}
    inspected = resolve_task_flow(
        ResolveTaskOptions(
            scene="browser-demo",
            task="air-tickets-demo",
            projects_root=tmp_path,
            inputs=inputs,
        )
    )
    snapshot, result = run_task_ai_act(
        ExecutionOptions(
            scene="browser-demo",
            task="air-tickets-demo",
            projects_root=tmp_path,
            inputs=inputs,
            dry_run=True,
            command_prefix=(sys.executable, str(fake)),
        )
    )
    assert snapshot.flow.to_json_dict() == inspected.flow.to_json_dict()
    assert result.mode == "task"
    assert result.scene == "browser-demo"
    assert result.task == "air-tickets-demo"
    assert Path(result.source_path).name == "resolved-flow.json"


def test_ai_act_failure_preserves_original_error(tmp_path: Path) -> None:
    prompt_path = tmp_path / "prompt.txt"
    prompt_path.write_text("执行任务", encoding="utf-8")
    fake = tmp_path / "failure.py"
    write_fake_ai_act_executor(fake, "failure")
    with pytest.raises(RuntimeError, match="退出码 7.*aiAct 原始规划错误"):
        execute_ai_act(
            prompt_path,
            tmp_path / "ai-act-result.json",
            mode="prompt",
            dry_run=False,
            command_prefix=(sys.executable, str(fake)),
        )


def test_ai_act_rejects_invalid_result(tmp_path: Path) -> None:
    prompt_path = tmp_path / "prompt.txt"
    prompt_path.write_text("执行任务", encoding="utf-8")
    fake = tmp_path / "invalid.py"
    write_fake_ai_act_executor(fake, "invalid-result")
    with pytest.raises(RuntimeError, match="未返回有效结果"):
        execute_ai_act(
            prompt_path,
            tmp_path / "ai-act-result.json",
            mode="prompt",
            dry_run=True,
            command_prefix=(sys.executable, str(fake)),
        )


def test_prompt_mode_rejects_empty_prompt_before_executor(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="prompt 不能为空"):
        run_prompt_ai_act("   ", reports_root=tmp_path)
