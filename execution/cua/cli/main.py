from __future__ import annotations

import argparse


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="cua", description="CUA 任务转换、校准与执行工具")
    parser.add_subparsers(dest="domain", required=True)
    return parser


def main(argv: list[str] | None = None) -> None:
    parser = build_parser()
    parser.parse_args(argv)
    parser.error("当前子命令尚未注册")


if __name__ == "__main__":
    main()
