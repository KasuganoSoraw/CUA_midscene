from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from cua.domain.types import ExecutionOptions, ResolveTaskOptions, ResolvedTaskResult
from cua.models.task import ExecutorResult
from cua.task.io import read_model
from cua.task.resolver import create_run_directory, resolve_task, task_paths
from cua.task.yaml_task import write_yaml_document

EXECUTION_ROOT = Path(__file__).resolve().parents[2]


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
        {
            "computer": {},
            "tasks": [
                {
                    "name": "自然语言电脑操作",
                    "flow": [{"ai": normalized_prompt}],
                }
            ],
        },
    )
    result = execute_yaml(
        yaml_path,
        run_dir / "execution-result.json",
        dry_run=dry_run,
        command_prefix=command_prefix,
    )
    return yaml_path, result
