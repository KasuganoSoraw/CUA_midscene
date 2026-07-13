from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from cua.conversion.showui_trace import convert_trace
from cua.domain.types import CalibrationOptions, ConvertOptions, ResolveProjectOptions
from cua.task.calibration import apply_calibration_proposal, validate_calibration_proposal
from cua.task.inputs import load_runtime_inputs
from cua.task.projects import list_projects
from cua.task.resolver import create_resolved_flow_snapshot, resolve_project_flow


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


def add_project_arguments(parser: argparse.ArgumentParser, *, inputs: bool = False) -> None:
    add_unique_argument(parser, "--project", required=True, help="任务项目名")
    add_unique_argument(parser, "--project-root", type=Path, help="项目目录覆盖")
    add_unique_argument(parser, "--flow", type=Path, help="基础 IR 路径覆盖")
    if inputs:
        add_unique_argument(parser, "--inputs", type=Path, help="本次输入 JSON 文件")
        parser.add_argument("--input", action="append", default=[], help="稀疏输入，格式为 key=value")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="cua", description="CUA 任务转换、校准与执行工具")
    domains = parser.add_subparsers(dest="domain", required=True)

    project_parser = domains.add_parser("project", help="任务项目查询")
    project_commands = project_parser.add_subparsers(dest="command", required=True)
    project_list = project_commands.add_parser("list", help="列出可调用任务")
    add_unique_argument(project_list, "--projects-root", type=Path, help="项目集合目录")
    project_list.add_argument("--json", action="store_true", help="输出机器可读 JSON")

    flow_parser = domains.add_parser("flow", help="流程转换、检查与执行")
    flow_commands = flow_parser.add_subparsers(dest="command", required=True)
    flow_convert = flow_commands.add_parser("convert", help="将 record trace 转换为基础 IR")
    add_unique_argument(flow_convert, "--project", required=True, help="任务项目名")
    add_unique_argument(flow_convert, "--project-root", type=Path, help="项目目录覆盖")
    add_unique_argument(flow_convert, "--goal", help="任务目标")
    add_unique_argument(flow_convert, "--recording-preparation-command", help="录制准备命令记录")
    add_unique_argument(flow_convert, "--trace-generation-command", help="trace 生成命令记录")
    add_unique_argument(flow_convert, "--flow-execution-command", help="flow 执行命令记录")

    for command in ("validate", "inspect", "run"):
        flow_command = flow_commands.add_parser(command)
        add_project_arguments(flow_command, inputs=True)
        flow_command.add_argument("--json", action="store_true", help="输出机器可读 JSON")
        if command == "run":
            flow_command.add_argument("--dry-run", action="store_true", help="只验证执行快照和 route")

    calibration_parser = domains.add_parser("calibration", help="人工校准建议")
    calibration_commands = calibration_parser.add_subparsers(dest="command", required=True)
    for command in ("validate", "apply"):
        calibration_command = calibration_commands.add_parser(command)
        add_unique_argument(calibration_command, "--project", required=True, help="任务项目名")
        add_unique_argument(calibration_command, "--project-root", type=Path, help="项目目录覆盖")
        add_unique_argument(calibration_command, "--proposal", required=True, help="建议 ID")
        calibration_command.add_argument("--json", action="store_true", help="输出机器可读 JSON")
        if command == "apply":
            calibration_command.add_argument("--confirmed", action="store_true", help="确认应用长期校准")
    return parser


def print_json(value: object) -> None:
    print(json.dumps(value, ensure_ascii=False, indent=2))


def quote_command_value(value: str) -> str:
    escaped = value.replace('"', '\\"')
    return f'"{escaped}"'


def build_conversion_command(args: argparse.Namespace) -> str:
    parts = ["uv run cua flow convert", f"--project {args.project}"]
    if args.goal:
        parts.append(f"--goal {quote_command_value(args.goal)}")
    if args.project_root:
        parts.append(f"--project-root {quote_command_value(str(args.project_root))}")
    return " ".join(parts)


def project_root_from_args(args: argparse.Namespace) -> Path | None:
    return args.project_root.resolve() if args.project_root else None


def resolve_from_args(args: argparse.Namespace, *, executable: bool = True):
    inputs = load_runtime_inputs(args.inputs, args.input)
    return resolve_project_flow(
        ResolveProjectOptions(
            project=args.project,
            project_root=project_root_from_args(args),
            flow_path=args.flow.resolve() if args.flow else None,
            inputs=inputs,
            executable=executable,
        )
    )


def run_command(args: argparse.Namespace) -> None:
    if args.domain == "project" and args.command == "list":
        projects = list_projects(args.projects_root or Path("projects"))
        if args.json:
            print_json({"projects": projects})
        else:
            for project in projects:
                print(f"{project['project']}\t{project['title']}\t{project['description']}")
        return

    if args.domain == "flow" and args.command == "convert":
        project_root = project_root_from_args(args) or (Path("projects") / args.project).resolve()
        output = convert_trace(
            ConvertOptions(
                project=args.project,
                goal=args.goal or "",
                project_root=project_root,
                conversion_command=build_conversion_command(args),
                recording_preparation_command=args.recording_preparation_command,
                trace_generation_command=args.trace_generation_command,
                flow_execution_command=args.flow_execution_command,
            )
        )
        print_json({"converted": True, "project": args.project, "flowPath": str(output)})
        return

    if args.domain == "flow" and args.command in {"validate", "inspect"}:
        resolved = resolve_from_args(args)
        if args.command == "validate":
            print_json(
                {
                    "valid": True,
                    "project": args.project,
                    "inputs": resolved.inputs,
                    "sources": resolved.sources.to_json_dict(),
                    "stepCount": len(resolved.flow.steps),
                }
            )
        else:
            print_json(create_resolved_flow_snapshot(resolved).to_json_dict())
        return

    if args.domain == "flow" and args.command == "run":
        from cua.task.executor import run_project

        run_project(args)
        return

    if args.domain == "calibration":
        options = CalibrationOptions(
            project=args.project,
            project_root=project_root_from_args(args),
            proposal=args.proposal,
        )
        if args.command == "validate":
            validated = validate_calibration_proposal(options)
            print_json({"valid": True, "project": args.project, "proposal": validated.proposal.to_json_dict()})
            return
        if not args.confirmed:
            raise ValueError("应用校准前必须取得用户明确确认，并传入 --confirmed")
        history = apply_calibration_proposal(options)
        print_json({"applied": True, "project": args.project, "history": history.to_json_dict()})
        return
    raise ValueError(f"不支持的命令：{args.domain} {args.command}")


def main(argv: list[str] | None = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        run_command(args)
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1) from error


if __name__ == "__main__":
    main()
