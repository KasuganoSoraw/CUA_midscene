from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Sequence

from .media import capture_preview, inspect_media, require_recording_capabilities
from .protocol import RecorderError, write_diagnostic, write_event
from .session import RecordingSession
from .windows import list_displays, require_output_root


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="cua-recorder", description="CUA Windows 屏幕与键鼠录制 Worker")
    commands = parser.add_subparsers(dest="command", required=True)

    commands.add_parser("doctor", help="检查 PyAV 录制能力")
    displays = commands.add_parser("displays", help="枚举显示器并生成静态预览")
    displays.add_argument("--preview-dir", type=Path, help="PNG 预览输出目录；省略时只枚举")
    record = commands.add_parser("record", help="录制一个显示器，stdin 接收 stop 或 EOF")
    record.add_argument("--display-id", required=True, help="displays 返回的显示器 ID 或 index")
    record.add_argument("--output-root", required=True, type=Path, help="录制一级目录的输出根")
    record.add_argument("--framerate", type=int, default=30, choices=range(1, 61), metavar="1..60")
    record.add_argument("--exclude-injected", action="store_true", help="过滤被 Windows 标记为 injected 的事件")
    return parser


def _doctor() -> int:
    capabilities = inspect_media()
    require_recording_capabilities(capabilities)
    write_event(
        "doctor",
        ready=True,
        pyav_version=capabilities.pyav_version,
        library_versions={name: list(version) for name, version in capabilities.library_versions.items()},
        gdigrab=capabilities.has_gdigrab,
        h264_mf=capabilities.has_h264_mf,
        mp4=capabilities.has_mp4,
    )
    return 0


def _displays(preview_dir: Path | None) -> int:
    displays = list_displays()
    if preview_dir is not None:
        capabilities = inspect_media()
        preview_dir = preview_dir.resolve()
        for display in displays:
            capture_preview(capabilities, display, preview_dir / f"display-{display.index}.png")
        documents = [
            {**display.to_json(), "preview_path": str(preview_dir / f"display-{display.index}.png")}
            for display in displays
        ]
    else:
        documents = [display.to_json() for display in displays]
    write_event("displays", displays=documents)
    return 0


def _select_display(raw: str):
    displays = list_displays()
    for display in displays:
        if raw == display.id or raw == str(display.index):
            return display
    choices = ", ".join(f"{item.index}:{item.id}" for item in displays)
    raise RecorderError(f"显示器不存在或拓扑已变化：{raw}；当前显示器：{choices}")


def _record(args: argparse.Namespace) -> int:
    capabilities = inspect_media()
    require_recording_capabilities(capabilities)
    session = RecordingSession(
        capabilities=capabilities,
        display=_select_display(args.display_id),
        output_root=require_output_root(args.output_root),
        framerate=args.framerate,
        include_injected=not args.exclude_injected,
    )
    try:
        session.run(sys.stdin, write_event)
    except KeyboardInterrupt:
        session.stop()
        raise
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "doctor":
            return _doctor()
        if args.command == "displays":
            return _displays(args.preview_dir)
        if args.command == "record":
            return _record(args)
        raise RecorderError(f"不支持的命令：{args.command}")
    except RecorderError as error:
        write_event("error", message=str(error))
        write_diagnostic(str(error))
        return 2
    except KeyboardInterrupt:
        write_event("error", message="操作被用户中断")
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
