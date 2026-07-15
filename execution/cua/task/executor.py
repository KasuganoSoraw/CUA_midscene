from __future__ import annotations

import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from cua.domain.types import ExecutionOptions, ResolveTaskOptions, ResolvedTaskResult
from cua.models.task import ExecutorResult
from cua.task.ai_act_prompt import build_recorded_task_ai_act_prompt
from cua.task.io import read_model
from cua.task.resolver import create_run_directory, resolve_task, task_paths
from cua.task.yaml_task import write_yaml_document

EXECUTION_ROOT = Path(__file__).resolve().parents[2]

AI_ACT_CONTEXT = """文本输入必须遵守以下规则：
1. 仅使用 KeyboardTypeText 输入 ASCII 文本，不使用默认 Input 或剪贴板。
2. 待输入文本包含 KeyboardTypeText 不支持的字符时直接失败，不切换输入动作。
3. 不得因为定位失败或一般执行失败改用其他输入方式。"""


@dataclass(frozen=True)
class RecordedTaskAiActRun:
    resolved: ResolvedTaskResult
    resolved_task_path: Path
    prompt_path: Path
    ai_act_yaml_path: Path
    executor_result: ExecutorResult


def default_executor_command() -> tuple[str, ...]:
    npm = shutil.which("npm")
    if npm is None:
        raise RuntimeError("无法找到 npm，不能启动 Midscene YAML runner")
    return (npm, "exec", "--", "tsx", "executors/run-midscene-yaml.ts")


def execute_yaml(
    yaml_path: Path,
    result_path: Path,
    *,
    dry_run: bool,
    command_prefix: tuple[str, ...] | None = None,
) -> ExecutorResult:
    command = [
        *(command_prefix or default_executor_command()),
        "--yaml",
        str(yaml_path.resolve()),
        "--result",
        str(result_path.resolve()),
    ]
    if dry_run:
        command.append("--dry-run")
    completed = subprocess.run(command, cwd=EXECUTION_ROOT, check=False)

    result: ExecutorResult | None = None
    result_error: Exception | None = None
    try:
        result = read_model(result_path, ExecutorResult, "Midscene YAML runner 结果")
    except Exception as error:
        result_error = error

    if completed.returncode != 0:
        detail = result.error if result and result.error else str(result_error or "未生成有效结果文件")
        raise RuntimeError(f"Midscene YAML runner 执行失败，退出码 {completed.returncode}：{detail}")
    if result is None:
        raise RuntimeError(f"Midscene YAML runner 未返回有效结果：{result_error}")
    if result.status != "succeeded":
        raise RuntimeError(f"Midscene YAML runner 返回失败状态：{result.error or '未提供原因'}")
    if Path(result.source_yaml_path).resolve() != yaml_path.resolve():
        raise RuntimeError("Midscene YAML runner 结果引用了不同的 YAML")
    if result.dry_run != dry_run:
        raise RuntimeError("Midscene YAML runner 结果中的 dryRun 与本次调用不一致")
    return result


def write_task_run_snapshot(resolved: ResolvedTaskResult, reports_dir: Path) -> Path:
    run_dir = create_run_directory(reports_dir)
    snapshot_path = run_dir / "resolved-task.yaml"
    write_yaml_document(snapshot_path, resolved.document)
    return snapshot_path


def run_task(options: ExecutionOptions) -> tuple[ResolvedTaskResult, Path, ExecutorResult]:
    resolved = resolve_task(
        ResolveTaskOptions(
            scene=options.scene,
            task=options.task,
            projects_root=options.projects_root,
            inputs=options.inputs,
        )
    )
    paths = task_paths(options.scene, options.task, options.projects_root)
    snapshot_path = write_task_run_snapshot(resolved, paths.reports_dir)
    result = execute_yaml(
        snapshot_path,
        snapshot_path.parent / "execution-result.json",
        dry_run=options.dry_run,
        command_prefix=options.command_prefix,
    )
    return resolved, snapshot_path, result


def ai_act_yaml_document(
    prompt: str,
    *,
    group_name: str,
    group_description: str,
    task_name: str,
) -> dict[str, Any]:
    return {
        "computer": {},
        "agent": {
            "groupName": group_name,
            "groupDescription": group_description,
            "generateReport": True,
            "aiActContext": AI_ACT_CONTEXT,
        },
        "tasks": [
            {
                "name": task_name,
                "flow": [{"ai": prompt}],
            }
        ],
    }


def run_recorded_task_ai_act(options: ExecutionOptions) -> RecordedTaskAiActRun:
    resolved = resolve_task(
        ResolveTaskOptions(
            scene=options.scene,
            task=options.task,
            projects_root=options.projects_root,
            inputs=options.inputs,
        )
    )
    prompt = build_recorded_task_ai_act_prompt(resolved.document)
    paths = task_paths(options.scene, options.task, options.projects_root)
    run_dir = create_run_directory(paths.reports_dir)
    resolved_task_path = run_dir / "resolved-task.yaml"
    prompt_path = run_dir / "ai-act-prompt.txt"
    ai_act_yaml_path = run_dir / "ai-act-task.yaml"
    write_yaml_document(resolved_task_path, resolved.document)
    prompt_path.write_text(prompt, encoding="utf-8")
    write_yaml_document(
        ai_act_yaml_path,
        ai_act_yaml_document(
            prompt,
            group_name=f"{options.task}-ai-act",
            group_description=resolved.manifest.goal,
            task_name="录制任务整体 aiAct",
        ),
    )
    result = execute_yaml(
        ai_act_yaml_path,
        run_dir / "execution-result.json",
        dry_run=options.dry_run,
        command_prefix=options.command_prefix,
    )
    return RecordedTaskAiActRun(
        resolved=resolved,
        resolved_task_path=resolved_task_path,
        prompt_path=prompt_path,
        ai_act_yaml_path=ai_act_yaml_path,
        executor_result=result,
    )


def run_prompt(
    prompt: str,
    *,
    dry_run: bool = False,
    reports_root: Path | None = None,
    command_prefix: tuple[str, ...] | None = None,
) -> tuple[Path, ExecutorResult]:
    normalized_prompt = prompt.strip()
    if not normalized_prompt:
        raise ValueError("自然语言 prompt 不能为空")
    run_dir = create_run_directory(reports_root or EXECUTION_ROOT / "reports")
    yaml_path = run_dir / "resolved-task.yaml"
    write_yaml_document(
        yaml_path,
        ai_act_yaml_document(
            normalized_prompt,
            group_name="natural-language-ai-act",
            group_description="执行无录制自然语言电脑操作",
            task_name="自然语言电脑操作",
        ),
    )
    result = execute_yaml(
        yaml_path,
        run_dir / "execution-result.json",
        dry_run=dry_run,
        command_prefix=command_prefix,
    )
    return yaml_path, result
