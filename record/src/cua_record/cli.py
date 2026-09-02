"""`python -m cua_record` 命令入口。"""

from __future__ import annotations

import argparse
from collections.abc import Sequence

from .pipeline import run_pipeline
from .resources import default_prompt_path


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="cua-record")
    subparsers = parser.add_subparsers(dest="command", required=True)

    process = subparsers.add_parser("process", help="处理一个原始录制目录")
    process.add_argument("recording", help="包含 inputs/ 的录制目录")

    subparsers.add_parser("doctor", help="验证模块与包内资源可用")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "process":
        run_pipeline(args.recording)
        return 0
    if args.command == "doctor":
        prompt = default_prompt_path()
        if not prompt.is_file():
            raise RuntimeError(f"包内默认 prompt 不存在：{prompt}")
        print(f"cua_record ready: {prompt.name}")
        return 0
    raise AssertionError(f"未处理的命令：{args.command}")
