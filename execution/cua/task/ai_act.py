from __future__ import annotations

import shutil
import subprocess
from datetime import UTC, datetime
from pathlib import Path

from cua.domain.types import ExecutionOptions, ResolveTaskOptions
from cua.models.task import AiActExecutorResult, ResolvedFlowSnapshot
from cua.task.io import read_model
from cua.task.resolver import resolve_task_flow, task_paths, write_resolved_flow_snapshot

EXECUTION_ROOT = Path(__file__).resolve().parents[2]


def default_ai_act_executor_command() -> tuple[str, ...]:
    npm = shutil.which("npm")
    if npm is None:
        raise RuntimeError("无法找到 npm，不能启动 Midscene aiAct executor")
    return (npm, "exec", "--", "tsx", "executors/run-midscene-ai-act.ts")


def create_run_directory(reports_root: Path) -> Path:
    now = datetime.now(UTC)
    run_id = now.isoformat(timespec="milliseconds").replace(":", "-").replace(".", "-").replace("+00-00", "Z")
    run_dir = reports_root.resolve() / run_id
    run_dir.mkdir(parents=True, exist_ok=False)
    return run_dir


def execute_ai_act(
    source_path: Path,
    result_path: Path,
    *,
    mode: str,
    dry_run: bool,
    scene: str | None = None,
    task: str | None = None,
    command_prefix: tuple[str, ...] | None = None,
) -> AiActExecutorResult:
    if mode not in {"prompt", "task"}:
        raise ValueError(f"不支持的 aiAct 模式：{mode}")
    source_option = "--prompt-file" if mode == "prompt" else "--resolved-flow"
    command = [
        *(command_prefix or default_ai_act_executor_command()),
        source_option,
        str(source_path.resolve()),
        "--result",
        str(result_path.resolve()),
    ]
    if dry_run:
        command.append("--dry-run")
    completed = subprocess.run(command, cwd=EXECUTION_ROOT, check=False)

    result: AiActExecutorResult | None = None
    result_error: Exception | None = None
    try:
        result = read_model(result_path, AiActExecutorResult, "Midscene aiAct executor 结果")
    except Exception as error:
        result_error = error

    if completed.returncode != 0:
        detail = result.error if result and result.error else str(result_error or "未生成有效结果文件")
        raise RuntimeError(f"Midscene aiAct executor 执行失败，退出码 {completed.returncode}：{detail}")
    if result is None:
        raise RuntimeError(f"Midscene aiAct executor 未返回有效结果：{result_error}")
    if result.status != "succeeded":
        raise RuntimeError(f"Midscene aiAct executor 返回失败状态：{result.error or '未提供原因'}")
    if result.mode != mode:
        raise RuntimeError(f"Midscene aiAct executor 结果模式 {result.mode} 与请求模式 {mode} 不一致")
    if Path(result.source_path).resolve() != source_path.resolve():
        raise RuntimeError("Midscene aiAct executor 结果引用了不同的源文件")
    if result.dry_run != dry_run:
        raise RuntimeError("Midscene aiAct executor 结果中的 dryRun 与本次调用不一致")
    if not result.prompt_path or not Path(result.prompt_path).is_file():
        raise RuntimeError("Midscene aiAct executor 未保存有效的最终 prompt")
    if mode == "task" and (result.scene != scene or result.task != task):
        raise RuntimeError(
            f"Midscene aiAct executor 结果任务 {result.scene}/{result.task} "
            f"与请求任务 {scene}/{task} 不一致"
        )
    if mode == "prompt" and (result.scene is not None or result.task is not None):
        raise RuntimeError("自然语言 aiAct executor 结果不应包含 scene 或 task")
    return result


def run_prompt_ai_act(
    prompt: str,
    *,
    dry_run: bool = False,
    reports_root: Path | None = None,
    command_prefix: tuple[str, ...] | None = None,
) -> AiActExecutorResult:
    normalized_prompt = prompt.strip()
    if not normalized_prompt:
        raise ValueError("自然语言 prompt 不能为空")
    run_dir = create_run_directory(reports_root or EXECUTION_ROOT / "reports")
    source_path = run_dir / "source-prompt.txt"
    source_path.write_text(normalized_prompt + "\n", encoding="utf-8")
    return execute_ai_act(
        source_path,
        run_dir / "ai-act-result.json",
        mode="prompt",
        dry_run=dry_run,
        command_prefix=command_prefix,
    )


def run_task_ai_act(options: ExecutionOptions) -> tuple[ResolvedFlowSnapshot, AiActExecutorResult]:
    resolved = resolve_task_flow(
        ResolveTaskOptions(
            scene=options.scene,
            task=options.task,
            projects_root=options.projects_root,
            task_root=options.task_root,
            flow_path=options.flow_path,
            inputs=options.inputs,
            executable=True,
        )
    )
    paths = task_paths(
        options.scene,
        options.task,
        options.projects_root,
        options.task_root,
        options.flow_path,
    )
    snapshot_path = write_resolved_flow_snapshot(resolved, paths.reports_dir)
    result = execute_ai_act(
        snapshot_path,
        snapshot_path.parent / "ai-act-result.json",
        mode="task",
        dry_run=options.dry_run,
        scene=options.scene,
        task=options.task,
        command_prefix=options.command_prefix,
    )
    return read_model(snapshot_path, ResolvedFlowSnapshot, "resolved flow 快照"), result
