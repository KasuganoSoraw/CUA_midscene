"""录制日志整理、截图提取及可供宿主读取的资产校验。"""

import json
import time
from collections.abc import Callable
from pathlib import Path

from .log_processor import LogProcessor
from .screenshot_processor import VideoScreenshotExtractor


def resolve_recording(raw: str) -> Path:
    target = Path(raw)
    if not target.exists():
        target = Path.cwd() / "projects" / raw
    if not target.is_dir() or not (target / "inputs").is_dir():
        raise FileNotFoundError(f"录制 inputs 目录不存在：{target}")
    return target.resolve()


def find_log(inputs: Path) -> Path:
    matches = [item for pattern in ("*.txt", "*.log", "*.json") for item in inputs.glob(pattern)]
    if len(matches) != 1:
        raise ValueError(f"录制 inputs 必须包含一个日志文件，实际为 {len(matches)}：{inputs}")
    return matches[0]


def validate_assets(root: Path, log: Path, screenshots: Path) -> int:
    actions = json.loads(log.read_text(encoding="utf-8"))
    if not isinstance(actions, list) or not actions or not screenshots.is_dir():
        raise ValueError("录制没有可用的操作步骤或截图目录")
    for action in actions:
        if not isinstance(action, dict):
            raise ValueError("操作记录必须为对象")
        for field in ("screenshot_full", "screenshot_crop", "screenshot_reference"):
            value = action.get(field)
            if field == "screenshot_reference" and value is None:
                continue
            if not isinstance(value, str) or not value or Path(value).is_absolute():
                raise ValueError(f"操作截图引用无效：{field}")
            target = (root / value).resolve()
            if not target.is_relative_to(screenshots.resolve()) or not target.is_file():
                raise ValueError(f"操作截图缺失或越出截图目录：{value}")
            if target.stat().st_size == 0:
                raise ValueError(f"操作截图为空：{value}")
    return len(actions)


def prepare_recording(
    recording: str, progress: Callable[[str], None] | None = None,
) -> dict[str, object]:
    start = time.perf_counter()
    root = resolve_recording(recording)
    raw_log = find_log(root / "inputs")
    processed = root / f"{root.name}_processed_log.json"
    if progress:
        progress("processing")
    LogProcessor().process_log_file(str(raw_log), str(processed), time_threshold=5.0)
    logged = time.perf_counter()
    if progress:
        progress("extracting")
    _, screenshots, _ = VideoScreenshotExtractor().process_project(str(root))
    extracted = time.perf_counter()
    log_sc = root / f"{root.name}_processed_log_sc.json"
    step_count = validate_assets(root, log_sc, Path(screenshots))
    return {
        "recordingRoot": str(root), "processedLogPath": str(log_sc),
        "screenshotsDir": str(Path(screenshots).resolve()), "stepCount": step_count,
        "timingsMs": {
            "log": (logged - start) * 1000, "screenshots": (extracted - logged) * 1000,
            "total": (time.perf_counter() - start) * 1000,
        },
    }
