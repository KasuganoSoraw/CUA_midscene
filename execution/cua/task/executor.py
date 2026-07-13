from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from cua.domain.types import ExecutionOptions, ResolveProjectOptions
from cua.models.task import ExecutorResult, ResolvedFlowSnapshot
from cua.task.io import read_model
from cua.task.resolver import resolve_project_flow, task_project_paths, write_resolved_flow_snapshot

EXECUTION_ROOT = Path(__file__).resolve().parents[2]


def default_executor_command() -> tuple[str, ...]:
    npm = shutil.which("npm")
    if npm is None:
        raise RuntimeError("无法找到 npm，不能启动 Midscene executor")
    return (npm, "exec", "--", "tsx", "executors/run-midscene-flow.ts")


def execute_resolved_flow(
    snapshot_path: Path,
    result_path: Path,
    *,
    dry_run: bool,
    command_prefix: tuple[str, ...] | None = None,
) -> ExecutorResult:
    command = [
        *(command_prefix or default_executor_command()),
        "--resolved-flow",
        str(snapshot_path.resolve()),
        "--result",
        str(result_path.resolve()),
    ]
    if dry_run:
        command.append("--dry-run")
    completed = subprocess.run(command, cwd=EXECUTION_ROOT, check=False)

    result: ExecutorResult | None = None
    result_error: Exception | None = None
    try:
        result = read_model(result_path, ExecutorResult, "Midscene executor 结果")
    except Exception as error:
        result_error = error

    if completed.returncode != 0:
        detail = result.error if result and result.error else str(result_error or "未生成有效结果文件")
        raise RuntimeError(f"Midscene executor 执行失败，退出码 {completed.returncode}：{detail}")
    if result is None:
        raise RuntimeError(f"Midscene executor 未返回有效结果：{result_error}")
    if result.status != "succeeded":
        raise RuntimeError(f"Midscene executor 返回失败状态：{result.error or '未提供原因'}")
    if Path(result.resolved_flow_path).resolve() != snapshot_path.resolve():
        raise RuntimeError("Midscene executor 结果引用了不同的 resolved flow")
    if result.dry_run != dry_run:
        raise RuntimeError("Midscene executor 结果中的 dryRun 与本次调用不一致")
    return result


def run_project(options: ExecutionOptions) -> tuple[ResolvedFlowSnapshot, ExecutorResult]:
    resolved = resolve_project_flow(
        ResolveProjectOptions(
            project=options.project,
            project_root=options.project_root,
            flow_path=options.flow_path,
            inputs=options.inputs,
            executable=True,
        )
    )
    paths = task_project_paths(options.project, options.project_root, options.flow_path)
    snapshot_path = write_resolved_flow_snapshot(resolved, paths.reports_dir)
    result_path = snapshot_path.parent / "execution-result.json"
    result = execute_resolved_flow(
        snapshot_path,
        result_path,
        dry_run=options.dry_run,
        command_prefix=options.command_prefix,
    )
    if result.project != options.project:
        raise RuntimeError(f"Midscene executor 结果项目 {result.project} 与请求项目 {options.project} 不一致")
    return read_model(snapshot_path, ResolvedFlowSnapshot, "resolved flow 快照"), result
