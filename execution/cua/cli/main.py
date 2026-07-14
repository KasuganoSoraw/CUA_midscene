from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from cua.conversion.showui_trace import convert_trace
from cua.domain.types import ConvertOptions, ExecutionOptions, ResolveTaskOptions
from cua.task.inputs import load_runtime_inputs
from cua.task.projects import describe_task, list_scenes, list_tasks
from cua.task.resolver import create_resolved_flow_snapshot, resolve_task_flow


class UniqueStoreAction(argparse.Action):
    def __call__(
        self,
        parser: argparse.ArgumentParser,
        namespace: argparse.Namespace,
        values: object,
        option_string: str | None = None,
    ) -> None:
        if getattr(namespace, self.dest, None) is not None:
            parser.error(f"参数 {option_string} 不能重复提供")
        setattr(namespace, self.dest, values)


def add_unique_argument(parser: argparse.ArgumentParser, name: str, **kwargs: object) -> None:
    parser.add_argument(name, action=UniqueStoreAction, **kwargs)


def add_task_identity(parser: argparse.ArgumentParser) -> None:
    add_unique_argument(parser, "--scene", required=True, help="业务场景标识")
    add_unique_argument(parser, "--task", required=True, help="任务标识")
    add_unique_argument(parser, "--projects-root", type=Path, help="场景集合目录，默认 projects")


def add_flow_arguments(parser: argparse.ArgumentParser, *, inputs: bool = False) -> None:
    add_task_identity(parser)
    add_unique_argument(parser, "--task-root", type=Path, help="任务目录覆盖")
    add_unique_argument(parser, "--flow", type=Path, help="canonical flow 路径覆盖")
    if inputs:
        add_unique_argument(parser, "--inputs", type=Path, help="本次输入 JSON 文件")
        parser.add_argument("--input", action="append", default=[], help="稀疏输入，格式为 key=value")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="cua", description="CUA 场景、任务与执行工具")
    domains = parser.add_subparsers(dest="domain", required=True)

    scene_parser = domains.add_parser("scene", help="场景查询")
    scene_commands = scene_parser.add_subparsers(dest="command", required=True)
    scene_list = scene_commands.add_parser("list", help="列出场景")
    add_unique_argument(scene_list, "--projects-root", type=Path, help="场景集合目录")
    scene_list.add_argument("--json", action="store_true", help="输出机器可读 JSON")

    task_parser = domains.add_parser("task", help="任务查询与初始化")
    task_commands = task_parser.add_subparsers(dest="command", required=True)
    task_list = task_commands.add_parser("list", help="列出场景中的任务")
    add_unique_argument(task_list, "--scene", required=True, help="业务场景标识")
    add_unique_argument(task_list, "--projects-root", type=Path, help="场景集合目录")
    task_list.add_argument("--json", action="store_true", help="输出机器可读 JSON")

    task_describe = task_commands.add_parser("describe", help="查看任务契约")
    add_task_identity(task_describe)
    task_describe.add_argument("--json", action="store_true", help="输出机器可读 JSON")

    task_init = task_commands.add_parser("init-from-trace", help="从 record trace 首次初始化任务 flow")
    add_task_identity(task_init)
    add_unique_argument(task_init, "--goal", required=True, help="任务目标")
    add_unique_argument(task_init, "--recording-preparation-command", help="录制准备命令记录")
    add_unique_argument(task_init, "--trace-generation-command", help="trace 生成命令记录")
    add_unique_argument(task_init, "--flow-execution-command", help="flow 执行命令记录")

    flow_parser = domains.add_parser("flow", help="流程验证、检查与执行")
    flow_commands = flow_parser.add_subparsers(dest="command", required=True)
    for command in ("validate", "inspect", "run"):
        flow_command = flow_commands.add_parser(command)
        add_flow_arguments(flow_command, inputs=True)
        flow_command.add_argument("--json", action="store_true", help="输出机器可读 JSON")
        if command == "run":
            flow_command.add_argument("--dry-run", action="store_true", help="只验证执行快照和 route")

    act_parser = domains.add_parser("act", help="使用 Midscene aiAct 执行自然语言或完整录制任务")
    act_commands = act_parser.add_subparsers(dest="command", required=True)
    act_run = act_commands.add_parser("run", help="执行一次 aiAct")
    add_unique_argument(act_run, "--prompt", help="无录制任务的自然语言要求")
    add_unique_argument(act_run, "--scene", help="业务场景标识")
    add_unique_argument(act_run, "--task", help="任务标识")
    add_unique_argument(act_run, "--projects-root", type=Path, help="场景集合目录，默认 projects")
    add_unique_argument(act_run, "--task-root", type=Path, help="任务目录覆盖")
    add_unique_argument(act_run, "--flow", type=Path, help="canonical flow 路径覆盖")
    add_unique_argument(act_run, "--inputs", type=Path, help="本次输入 JSON 文件")
    act_run.add_argument("--input", action="append", default=[], help="稀疏输入，格式为 key=value")
    act_run.add_argument("--dry-run", action="store_true", help="只验证并输出最终 aiAct prompt")
    return parser


def print_json(value: object) -> None:
    print(json.dumps(value, ensure_ascii=False, indent=2))


def quote_command_value(value: str) -> str:
    escaped = value.replace('"', '\\"')
    return f'"{escaped}"'


def projects_root_from_args(args: argparse.Namespace) -> Path:
    return (args.projects_root or Path("projects")).resolve()


def build_conversion_command(args: argparse.Namespace) -> str:
    parts = [
        "uv run cua task init-from-trace",
        f"--scene {args.scene}",
        f"--task {args.task}",
        f"--goal {quote_command_value(args.goal)}",
    ]
    if args.projects_root:
        parts.append(f"--projects-root {quote_command_value(str(args.projects_root))}")
    for option, value in (
        ("recording-preparation-command", args.recording_preparation_command),
        ("trace-generation-command", args.trace_generation_command),
        ("flow-execution-command", args.flow_execution_command),
    ):
        if value:
            parts.append(f"--{option} {quote_command_value(value)}")
    return " ".join(parts)


def resolve_from_args(args: argparse.Namespace, *, executable: bool = True):
    inputs = load_runtime_inputs(args.inputs, args.input)
    return resolve_task_flow(
        ResolveTaskOptions(
            scene=args.scene,
            task=args.task,
            projects_root=projects_root_from_args(args),
            task_root=args.task_root.resolve() if args.task_root else None,
            flow_path=args.flow.resolve() if args.flow else None,
            inputs=inputs,
            executable=executable,
        )
    )


def run_command(args: argparse.Namespace) -> None:
    if args.domain == "scene" and args.command == "list":
        scenes = list_scenes(projects_root_from_args(args))
        if args.json:
            print_json({"scenes": scenes})
        else:
            for scene in scenes:
                print(f"{scene['scene']}\t{scene['title']}\t{scene['description']}")
        return

    if args.domain == "task" and args.command == "list":
        tasks = list_tasks(args.scene, projects_root_from_args(args))
        if args.json:
            print_json({"scene": args.scene, "tasks": tasks})
        else:
            for task in tasks:
                print(f"{task['task']}\t{task['title']}\t{task['description']}")
        return

    if args.domain == "task" and args.command == "describe":
        task = describe_task(args.scene, args.task, projects_root_from_args(args))
        print_json(task)
        return

    if args.domain == "task" and args.command == "init-from-trace":
        output = convert_trace(
            ConvertOptions(
                scene=args.scene,
                task=args.task,
                goal=args.goal,
                projects_root=projects_root_from_args(args),
                conversion_command=build_conversion_command(args),
                recording_preparation_command=args.recording_preparation_command,
                trace_generation_command=args.trace_generation_command,
                flow_execution_command=args.flow_execution_command,
            )
        )
        print_json({"initialized": True, "scene": args.scene, "task": args.task, "flowPath": str(output)})
        return

    if args.domain == "flow" and args.command in {"validate", "inspect"}:
        resolved = resolve_from_args(args)
        if args.command == "validate":
            print_json(
                {
                    "valid": True,
                    "scene": args.scene,
                    "task": args.task,
                    "inputs": resolved.inputs,
                    "sources": resolved.sources.to_json_dict(),
                    "stepCount": len(resolved.flow.steps),
                }
            )
        else:
            print_json(create_resolved_flow_snapshot(resolved).to_json_dict())
        return

    if args.domain == "flow" and args.command == "run":
        from cua.task.executor import run_task

        inputs = load_runtime_inputs(args.inputs, args.input)
        snapshot, result = run_task(
            ExecutionOptions(
                scene=args.scene,
                task=args.task,
                projects_root=projects_root_from_args(args),
                task_root=args.task_root.resolve() if args.task_root else None,
                flow_path=args.flow.resolve() if args.flow else None,
                inputs=inputs,
                dry_run=args.dry_run,
            )
        )
        print_json({"snapshot": snapshot.to_json_dict(), "executor": result.to_json_dict()})
        return

    if args.domain == "act" and args.command == "run":
        from cua.task.ai_act import run_prompt_ai_act, run_task_ai_act

        has_prompt = args.prompt is not None
        has_task_identity = args.scene is not None or args.task is not None
        task_only_values = [args.projects_root, args.task_root, args.flow, args.inputs]
        if has_prompt:
            if has_task_identity or any(value is not None for value in task_only_values) or args.input:
                raise ValueError("--prompt 不能与 scene/task、任务路径或任务输入参数混用")
            result = run_prompt_ai_act(args.prompt, dry_run=args.dry_run)
            print_json({"executor": result.to_json_dict()})
            return
        if not args.scene or not args.task:
            raise ValueError("任务 aiAct 模式必须同时提供 --scene 和 --task")
        inputs = load_runtime_inputs(args.inputs, args.input)
        snapshot, result = run_task_ai_act(
            ExecutionOptions(
                scene=args.scene,
                task=args.task,
                projects_root=projects_root_from_args(args),
                task_root=args.task_root.resolve() if args.task_root else None,
                flow_path=args.flow.resolve() if args.flow else None,
                inputs=inputs,
                dry_run=args.dry_run,
            )
        )
        print_json({"snapshot": snapshot.to_json_dict(), "executor": result.to_json_dict()})
        return
    raise ValueError(f"不支持的命令：{args.domain} {args.command}")


def main(argv: list[str] | None = None) -> None:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        run_command(args)
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1) from error


if __name__ == "__main__":
    main()
