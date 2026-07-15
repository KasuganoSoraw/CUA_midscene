from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from cua.conversion.showui_trace import convert_trace
from cua.domain.types import ConvertOptions, ExecutionOptions, ResolveTaskOptions
from cua.task.inputs import load_runtime_inputs
from cua.task.projects import describe_task, list_scenes, list_tasks
from cua.task.resolver import resolve_task
from cua.task.yaml_task import dump_yaml_document


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


def add_runtime_inputs(parser: argparse.ArgumentParser) -> None:
    add_unique_argument(parser, "--inputs", type=Path, help="本次输入 JSON 文件")
    parser.add_argument("--input", action="append", default=[], help="稀疏输入，格式为 key=value")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="cua", description="CUA 场景、任务与 Midscene YAML 执行工具")
    domains = parser.add_subparsers(dest="domain", required=True)

    scene_parser = domains.add_parser("scene", help="场景查询")
    scene_commands = scene_parser.add_subparsers(dest="command", required=True)
    scene_list = scene_commands.add_parser("list", help="列出场景")
    add_unique_argument(scene_list, "--projects-root", type=Path, help="场景集合目录")
    scene_list.add_argument("--json", action="store_true", help="输出机器可读 JSON")

    task_parser = domains.add_parser("task", help="录制任务的创建、查询、检查与执行")
    task_commands = task_parser.add_subparsers(dest="command", required=True)

    task_list = task_commands.add_parser("list", help="列出场景中的任务")
    add_unique_argument(task_list, "--scene", required=True, help="业务场景标识")
    add_unique_argument(task_list, "--projects-root", type=Path, help="场景集合目录")
    task_list.add_argument("--json", action="store_true", help="输出机器可读 JSON")

    task_describe = task_commands.add_parser("describe", help="查看任务契约")
    add_task_identity(task_describe)
    task_describe.add_argument("--json", action="store_true", help="输出机器可读 JSON")

    task_init = task_commands.add_parser("init-from-trace", help="从 record trace 初始化 Midscene YAML 任务")
    add_task_identity(task_init)
    add_unique_argument(task_init, "--goal", required=True, help="任务目标")
    add_unique_argument(task_init, "--recording-preparation-command", help="录制准备命令记录")
    add_unique_argument(task_init, "--trace-generation-command", help="trace 生成命令记录")

    for command in ("validate", "inspect", "run"):
        task_command = task_commands.add_parser(command)
        add_task_identity(task_command)
        add_runtime_inputs(task_command)
        task_command.add_argument("--json", action="store_true", help="输出机器可读 JSON")
        if command == "run":
            task_command.add_argument("--dry-run", action="store_true", help="只验证 resolved task YAML")

    act_parser = domains.add_parser("act", help="执行无录制自然语言电脑操作")
    act_commands = act_parser.add_subparsers(dest="command", required=True)
    act_run = act_commands.add_parser("run", help="将自然语言要求包装为 Midscene YAML 并执行")
    add_unique_argument(act_run, "--prompt", required=True, help="自然语言电脑操作要求")
    act_run.add_argument("--dry-run", action="store_true", help="只验证生成的 YAML")
    return parser


def print_json(value: object) -> None:
    print(json.dumps(value, ensure_ascii=False, indent=2))


def quote_command_value(value: str) -> str:
    return f'"{value.replace(chr(34), chr(92) + chr(34))}"'


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
    ):
        if value:
            parts.append(f"--{option} {quote_command_value(value)}")
    return " ".join(parts)


def resolve_from_args(args: argparse.Namespace):
    return resolve_task(
        ResolveTaskOptions(
            scene=args.scene,
            task=args.task,
            projects_root=projects_root_from_args(args),
            inputs=load_runtime_inputs(args.inputs, args.input),
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
        print_json(describe_task(args.scene, args.task, projects_root_from_args(args)))
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
            )
        )
        print_json({"initialized": True, "scene": args.scene, "task": args.task, "taskYamlPath": str(output)})
        return

    if args.domain == "task" and args.command == "validate":
        from cua.task.executor import run_task

        resolved, snapshot_path, result = run_task(
            ExecutionOptions(
                scene=args.scene,
                task=args.task,
                projects_root=projects_root_from_args(args),
                inputs=load_runtime_inputs(args.inputs, args.input),
                dry_run=True,
            )
        )
        print_json(
            {
                "valid": True,
                "scene": args.scene,
                "task": args.task,
                "inputs": resolved.inputs,
                "resolvedTaskPath": str(snapshot_path),
                "executor": result.to_json_dict(),
            }
        )
        return

    if args.domain == "task" and args.command == "inspect":
        resolved = resolve_from_args(args)
        if args.json:
            print_json(
                {
                    "scene": args.scene,
                    "task": args.task,
                    "inputs": resolved.inputs,
                    "sourceYamlPath": str(resolved.source_path),
                    "yaml": resolved.document,
                }
            )
        else:
            print(dump_yaml_document(resolved.document), end="")
        return

    if args.domain == "task" and args.command == "run":
        from cua.task.executor import run_task

        resolved, snapshot_path, result = run_task(
            ExecutionOptions(
                scene=args.scene,
                task=args.task,
                projects_root=projects_root_from_args(args),
                inputs=load_runtime_inputs(args.inputs, args.input),
                dry_run=args.dry_run,
            )
        )
        print_json(
            {
                "scene": args.scene,
                "task": args.task,
                "inputs": resolved.inputs,
                "resolvedTaskPath": str(snapshot_path),
                "executor": result.to_json_dict(),
            }
        )
        return

    if args.domain == "act" and args.command == "run":
        from cua.task.executor import run_prompt

        yaml_path, result = run_prompt(args.prompt, dry_run=args.dry_run)
        print_json({"resolvedTaskPath": str(yaml_path), "executor": result.to_json_dict()})
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
