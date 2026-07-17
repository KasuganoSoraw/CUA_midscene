from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from cua.conversion.showui_trace import convert_trace
from cua.domain.types import ConvertOptions, ExecutionOptions, ResolveTaskOptions, TaskCatalogRoots
from cua.task.data_paths import require_data_paths, resolve_runtime_layout
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


def add_data_root(parser: argparse.ArgumentParser) -> None:
    add_unique_argument(parser, "--data-root", type=Path, help="CUA 用户数据根目录（绝对路径）")


def add_task_identity(parser: argparse.ArgumentParser) -> None:
    add_unique_argument(parser, "--scene", required=True, help="业务场景标识")
    add_unique_argument(parser, "--task", required=True, help="任务标识")
    add_data_root(parser)


def add_runtime_inputs(parser: argparse.ArgumentParser) -> None:
    add_unique_argument(parser, "--inputs", type=Path, help="本次输入 JSON 文件")
    parser.add_argument("--input", action="append", default=[], help="稀疏输入，格式为 key=value")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="cua", description="CUA 场景、任务与 Midscene YAML 执行工具")
    domains = parser.add_subparsers(dest="domain", required=True)

    scene_parser = domains.add_parser("scene", help="场景查询")
    scene_commands = scene_parser.add_subparsers(dest="command", required=True)
    scene_list = scene_commands.add_parser("list", help="列出场景")
    add_data_root(scene_list)
    scene_list.add_argument("--json", action="store_true", help="输出机器可读 JSON")

    task_parser = domains.add_parser("task", help="录制任务的创建、查询、检查与执行")
    task_commands = task_parser.add_subparsers(dest="command", required=True)

    task_list = task_commands.add_parser("list", help="列出场景中的任务")
    add_unique_argument(task_list, "--scene", required=True, help="业务场景标识")
    add_data_root(task_list)
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

    act_parser = domains.add_parser("act", help="使用整体 aiAct 执行电脑操作")
    act_commands = act_parser.add_subparsers(dest="command", required=True)
    act_run = act_commands.add_parser("run", help="执行自然语言要求或录制任务的整体 aiAct")
    add_unique_argument(act_run, "--prompt", help="无录制自然语言电脑操作要求")
    add_unique_argument(act_run, "--scene", help="录制任务的业务场景标识")
    add_unique_argument(act_run, "--task", help="录制任务标识")
    add_data_root(act_run)
    add_runtime_inputs(act_run)
    act_run.add_argument("--dry-run", action="store_true", help="只验证生成的 YAML")
    return parser


def print_json(value: object) -> None:
    print(json.dumps(value, ensure_ascii=False, indent=2))


def quote_command_value(value: str) -> str:
    return f'"{value.replace(chr(34), chr(92) + chr(34))}"'


def layout_from_args(args: argparse.Namespace):
    return resolve_runtime_layout(args.data_root)


def build_conversion_command(args: argparse.Namespace) -> str:
    parts = [
        "uv run cua task init-from-trace",
        f"--scene {args.scene}",
        f"--task {args.task}",
        f"--goal {quote_command_value(args.goal)}",
    ]
    if args.data_root:
        parts.append(f"--data-root {quote_command_value(str(args.data_root))}")
    for option, value in (
        ("recording-preparation-command", args.recording_preparation_command),
        ("trace-generation-command", args.trace_generation_command),
    ):
        if value:
            parts.append(f"--{option} {quote_command_value(value)}")
    return " ".join(parts)


def resolve_from_args(args: argparse.Namespace, catalog: TaskCatalogRoots):
    return resolve_task(
        ResolveTaskOptions(
            scene=args.scene,
            task=args.task,
            catalog=catalog,
            inputs=load_runtime_inputs(args.inputs, args.input),
        )
    )


def validate_act_run_args(parser: argparse.ArgumentParser, args: argparse.Namespace) -> None:
    if args.domain != "act" or args.command != "run":
        return
    has_prompt = args.prompt is not None
    task_options = {
        "--scene": args.scene,
        "--task": args.task,
        "--inputs": args.inputs,
        "--input": args.input,
    }
    provided_task_options = [name for name, value in task_options.items() if value not in (None, [])]
    if has_prompt:
        if provided_task_options:
            parser.error(f"--prompt 不能与任务参数混用：{', '.join(provided_task_options)}")
        return
    if not args.scene or not args.task:
        parser.error("必须提供 --prompt，或同时提供 --scene 和 --task")


def task_run_payload(args: argparse.Namespace, resolved: Any, snapshot_path: Path, result: Any) -> dict[str, Any]:
    return {
        "scene": args.scene,
        "task": args.task,
        "origin": resolved.origin,
        "writable": resolved.writable,
        "inputs": resolved.inputs,
        "runDir": str(snapshot_path.parent),
        "resolvedTaskPath": str(snapshot_path),
        "executor": result.to_json_dict(),
    }


def run_command(args: argparse.Namespace) -> None:
    if args.domain == "scene" and args.command == "list":
        scenes = list_scenes(layout_from_args(args).catalog)
        if args.json:
            print_json({"scenes": scenes})
        else:
            for scene in scenes:
                print(f"{scene['scene']}\t{scene['title']}\t{scene['description']}")
        return

    if args.domain == "task" and args.command == "list":
        tasks = list_tasks(args.scene, layout_from_args(args).catalog)
        if args.json:
            print_json({"scene": args.scene, "tasks": tasks})
        else:
            for task in tasks:
                print(f"{task['task']}\t{task['title']}\t{task['description']}")
        return

    if args.domain == "task" and args.command == "describe":
        print_json(describe_task(args.scene, args.task, layout_from_args(args).catalog))
        return

    if args.domain == "task" and args.command == "init-from-trace":
        layout = layout_from_args(args)
        require_data_paths(layout)
        output = convert_trace(
            ConvertOptions(
                scene=args.scene,
                task=args.task,
                goal=args.goal,
                catalog=layout.catalog,
                conversion_command=build_conversion_command(args),
                recording_preparation_command=args.recording_preparation_command,
                trace_generation_command=args.trace_generation_command,
            )
        )
        print_json({"initialized": True, "scene": args.scene, "task": args.task, "taskYamlPath": str(output)})
        return

    if args.domain == "task" and args.command in ("validate", "run"):
        from cua.task.executor import run_task

        layout = layout_from_args(args)
        data = require_data_paths(layout)
        resolved, snapshot_path, result = run_task(
            ExecutionOptions(
                scene=args.scene,
                task=args.task,
                catalog=layout.catalog,
                runs_root=data.runs_root,
                inputs=load_runtime_inputs(args.inputs, args.input),
                dry_run=True if args.command == "validate" else args.dry_run,
            )
        )
        payload = task_run_payload(args, resolved, snapshot_path, result)
        if args.command == "validate":
            payload["valid"] = True
        print_json(payload)
        return

    if args.domain == "task" and args.command == "inspect":
        resolved = resolve_from_args(args, layout_from_args(args).catalog)
        if args.json:
            print_json(
                {
                    "scene": args.scene,
                    "task": args.task,
                    "origin": resolved.origin,
                    "writable": resolved.writable,
                    "inputs": resolved.inputs,
                    "sourceYamlPath": str(resolved.source_path),
                    "yaml": resolved.document,
                }
            )
        else:
            print(dump_yaml_document(resolved.document), end="")
        return

    if args.domain == "act" and args.command == "run":
        from cua.task.executor import run_prompt, run_recorded_task_ai_act

        layout = layout_from_args(args)
        data = require_data_paths(layout)
        if args.prompt is not None:
            yaml_path, result = run_prompt(args.prompt, dry_run=args.dry_run, runs_root=data.runs_root)
            print_json(
                {
                    "mode": "prompt",
                    "runDir": str(yaml_path.parent),
                    "aiActYamlPath": str(yaml_path),
                    "executor": result.to_json_dict(),
                }
            )
            return
        run = run_recorded_task_ai_act(
            ExecutionOptions(
                scene=args.scene,
                task=args.task,
                catalog=layout.catalog,
                runs_root=data.runs_root,
                inputs=load_runtime_inputs(args.inputs, args.input),
                dry_run=args.dry_run,
            )
        )
        print_json(
            {
                "mode": "recorded-task",
                "scene": args.scene,
                "task": args.task,
                "origin": run.resolved.origin,
                "writable": run.resolved.writable,
                "inputs": run.resolved.inputs,
                "runDir": str(run.run_dir),
                "resolvedTaskPath": str(run.resolved_task_path),
                "promptPath": str(run.prompt_path),
                "aiActYamlPath": str(run.ai_act_yaml_path),
                "executor": run.executor_result.to_json_dict(),
            }
        )
        return
    raise ValueError(f"不支持的命令：{args.domain} {args.command}")


def main(argv: list[str] | None = None) -> None:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    parser = build_parser()
    args = parser.parse_args(argv)
    validate_act_run_args(parser, args)
    try:
        run_command(args)
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1) from error


if __name__ == "__main__":
    main()
