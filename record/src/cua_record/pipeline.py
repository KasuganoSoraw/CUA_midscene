"""共享轻量资产处理的完整 Trace 生成流水线。"""

import os
from pathlib import Path

from .prepare import prepare_recording
from .resources import default_prompt_path
from .trace_generator import TraceGenerator


def run_pipeline(project_name: str) -> Path:
    prepared = prepare_recording(project_name)
    root = Path(str(prepared["recordingRoot"]))
    out_trace = root / f"{root.name}_trace.json"
    generator = TraceGenerator(
        default_prompt_path=str(default_prompt_path()),
        api_provider="openai",
        openai_model=os.environ.get("OPENAI_MODEL", "gpt-4o"),
        claude_model="claude-sonnet-4-20250514",
    )
    generator.generate_trace(
        recording_json_path=str(prepared["processedLogPath"]),
        screenshots_dir=str(prepared["screenshotsDir"]),
        output_trace_path=str(out_trace),
        overall_task="",
    )
    print("=== Pipeline Complete ===")
    print(f"Project: {root.name}")
    print(f"Processed log: {root.name}_processed_log.json")
    print(f"Screenshots dir: {Path(str(prepared['screenshotsDir'])).name}")
    print(f"Processed log (+screens): {Path(str(prepared['processedLogPath'])).name}")
    print(f"Trace: {out_trace.name}")
    return out_trace
