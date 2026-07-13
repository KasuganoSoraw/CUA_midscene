from __future__ import annotations

import json
import math
import re
from pathlib import Path, PurePosixPath
from pydantic import BaseModel, ConfigDict, Field

from cua.conversion.input_locate import derive_input_locate_prompt
from cua.domain.types import ConvertOptions
from cua.models.flow import (
    ActRoute,
    InputRoute,
    KeyboardRoute,
    ManualReviewRoute,
    MIDSCENE_FLOW_SCHEMA_VERSION,
    MidsceneFlow,
    MidsceneFlowCommands,
    MidsceneFlowEvidence,
    MidsceneFlowFallback,
    MidsceneFlowRoute,
    MidsceneFlowSource,
    MidsceneFlowSourceTrace,
    MidsceneFlowStep,
    MidsceneFlowTiming,
    MidsceneTraceOperation,
    TapRoute,
    TraceClickOperation,
    TraceInputOperation,
    TraceKeyboardOperation,
    TraceUnknownOperation,
    TraceWaitOperation,
    WaitRoute,
)
from cua.task.resolver import create_empty_overrides, create_initial_project_config

MIN_RECORDED_WAIT_MS = 200
MAX_RECORDED_WAIT_MS = 30_000


class InputModel(BaseModel):
    model_config = ConfigDict(extra="ignore", strict=True)


class ShowuiTraceOperation(InputModel):
    type: str | None = None
    prompt: str | None = None
    locatePrompt: str | None = None
    value: str | None = None
    key: str | None = None
    condition: str | None = None


class ShowuiCaption(InputModel):
    observation: str | None = None
    think: str | None = None
    action: str | None = None
    expectation: str | None = None
    operation: ShowuiTraceOperation | None = None


class ShowuiTraceStep(InputModel):
    step_idx: int
    caption: ShowuiCaption


class ShowuiTrace(InputModel):
    trajectory: list[ShowuiTraceStep]


class ProcessedLogStep(InputModel):
    timestamp: float | None = None
    action: str | None = None
    screenshot_full: str | None = None
    screenshot_crop: str | None = None


def read_model(path: Path, model: type[BaseModel]) -> BaseModel:
    try:
        return model.model_validate_json(path.read_text(encoding="utf-8"))
    except Exception as error:
        raise ValueError(f"读取并验证 JSON 失败：{path}\n{error}") from error


def read_processed_log(path: Path) -> list[ProcessedLogStep]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(value, list):
            raise ValueError("根节点不是数组")
        return [ProcessedLogStep.model_validate(item) for item in value]
    except Exception as error:
        raise ValueError(f"读取并验证 processed log 失败：{path}\n{error}") from error


def write_json(path: Path, value: BaseModel) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    content = json.dumps(value.to_json_dict(), ensure_ascii=False, indent=2) + "\n"  # type: ignore[attr-defined]
    path.write_text(content, encoding="utf-8")


def write_json_if_missing(path: Path, value: BaseModel) -> bool:
    path.parent.mkdir(parents=True, exist_ok=True)
    content = json.dumps(value.to_json_dict(), ensure_ascii=False, indent=2) + "\n"  # type: ignore[attr-defined]
    try:
        with path.open("x", encoding="utf-8") as file:
            file.write(content)
        return True
    except FileExistsError:
        return False


def normalize_source_screenshot_path(source_path: str | None) -> str | None:
    if not source_path:
        return None
    return str(PurePosixPath("source") / PurePosixPath(source_path.replace("\\", "/")))


def extract_quoted_value(action: str) -> str | None:
    match = re.search(r"['\"]([^'\"]+)['\"]", action)
    return match.group(1) if match else None


def extract_chinese_input_value(action: str) -> str | None:
    match = re.search(r"(?:输入|键入|录入)(?:文本|文字|内容)?\s*([^。；，,.;]+)", action)
    return match.group(1).strip() if match else None


def target_from_action(action: str) -> str:
    result = re.sub(r"^Click\s+", "", action, flags=re.IGNORECASE)
    result = re.sub(r"^点击\s*", "", result)
    result = re.sub(r"^the\s+", "", result, flags=re.IGNORECASE)
    return result.removesuffix(".").removesuffix("。").strip()


def normalize_trace_operation(operation: ShowuiTraceOperation | None) -> MidsceneTraceOperation | None:
    if operation is None or not operation.type:
        return None
    operation_type = operation.type.strip().lower()
    prompt = operation.prompt.strip() if operation.prompt else None
    locate_prompt = operation.locatePrompt.strip() if operation.locatePrompt else None
    value = operation.value.strip() if operation.value else None
    key = operation.key.strip() if operation.key else None
    condition = operation.condition.strip() if operation.condition else None

    if operation_type == "click" and prompt:
        return TraceClickOperation(type="click", prompt=prompt)
    if operation_type == "input" and prompt and value:
        return TraceInputOperation(
            type="input",
            prompt=prompt,
            locate_prompt=locate_prompt or derive_input_locate_prompt(prompt),
            value=value,
        )
    if operation_type == "keyboard" and key:
        return TraceKeyboardOperation(type="keyboard", prompt=prompt, key=key)
    if operation_type == "wait" and condition:
        return TraceWaitOperation(type="wait", prompt=prompt, condition=condition)
    return TraceUnknownOperation(type="unknown", prompt=prompt)


def route_from_operation(operation: MidsceneTraceOperation | None) -> MidsceneFlowRoute | None:
    if operation is None or operation.type == "unknown":
        return None
    if operation.type == "click":
        return TapRoute(strategy="tap", prompt=operation.prompt)
    if operation.type == "input":
        return InputRoute(
            strategy="input",
            prompt=operation.prompt,
            locate_prompt=operation.locate_prompt or derive_input_locate_prompt(operation.prompt),
            value=operation.value,
            mode="replace",
            input_method="keyboard-action",
        )
    if operation.type == "keyboard":
        return KeyboardRoute(strategy="keyboard", key_name=operation.key)
    return WaitRoute(
        strategy="wait",
        prompt=operation.prompt,
        condition=operation.condition,
        timeout_ms=15_000,
    )


def route_step(action: str, expectation: str, raw_action: str | None) -> MidsceneFlowRoute:
    action_source = raw_action or action
    if re.search(r"press\s+enter", action_source, re.IGNORECASE) or re.search(
        r"(?:按|按下).*(?:enter|回车)", action, re.IGNORECASE
    ):
        return KeyboardRoute(strategy="keyboard", key_name="Enter")
    if re.match(r"^type\s*:", raw_action or "", re.IGNORECASE):
        value = re.sub(r"^Type\s*:\s*", "", raw_action or "", flags=re.IGNORECASE).strip()
        return InputRoute(
            strategy="input",
            prompt=action,
            locate_prompt=derive_input_locate_prompt(action),
            value=value,
            mode="replace",
            input_method="keyboard-action",
        )
    if re.match(r"^click\s+", action, re.IGNORECASE) or action.startswith("点击"):
        target = target_from_action(action)
        if re.search(
            r"date-picker|calendar|dropdown|button|field|option|radio|search result|link",
            action,
            re.IGNORECASE,
        ) or re.search(r"日期|日历|下拉|按钮|输入框|字段|选项|建议项|单选|搜索结果|链接", action):
            return TapRoute(strategy="tap", prompt=target)
        return ActRoute(strategy="act", prompt=action)
    if re.match(r"^type\s+", action, re.IGNORECASE) or re.search(r"输入|键入|录入", action):
        value = extract_quoted_value(action) or extract_chinese_input_value(action)
        if value is None:
            value = re.sub(r"^Type\s+", "", action, flags=re.IGNORECASE).strip()
        return InputRoute(
            strategy="input",
            prompt=action,
            locate_prompt=derive_input_locate_prompt(action),
            value=value,
            mode="replace",
            input_method="keyboard-action",
        )
    if re.search(r"visible|loaded|navigate|will navigate", expectation, re.IGNORECASE):
        return WaitRoute(strategy="wait", prompt=expectation, condition=expectation, timeout_ms=15_000)
    return ManualReviewRoute(
        strategy="manual-review",
        reason="无法根据 ShowUI-Aloha action 稳定推断 Midscene 执行策略。",
    )


def build_fallback(route: MidsceneFlowRoute, action: str) -> MidsceneFlowFallback:
    if route.strategy == "manual-review":
        return MidsceneFlowFallback(strategy="fail", reason=route.reason)
    instruction = getattr(route, "prompt", None) or action
    return MidsceneFlowFallback(strategy="vision", instruction=instruction)


def clamp_recorded_wait_ms(recorded_gap_ms: int) -> int:
    if recorded_gap_ms < MIN_RECORDED_WAIT_MS:
        return 0
    return min(recorded_gap_ms, MAX_RECORDED_WAIT_MS)


def build_timing(
    processed_step: ProcessedLogStep | None,
    previous_processed_step: ProcessedLogStep | None,
) -> MidsceneFlowTiming | None:
    if processed_step is None or previous_processed_step is None:
        return None
    if processed_step.timestamp is None or previous_processed_step.timestamp is None:
        return None
    gap_ms = (processed_step.timestamp - previous_processed_step.timestamp) * 1000
    recorded_gap_ms = max(0, math.floor(gap_ms + 0.5))
    wait_before_ms = clamp_recorded_wait_ms(recorded_gap_ms)
    if wait_before_ms <= 0:
        return MidsceneFlowTiming(recorded_gap_ms=recorded_gap_ms)
    return MidsceneFlowTiming(
        recorded_gap_ms=recorded_gap_ms,
        wait_before_ms=wait_before_ms,
        wait_reason="recorded-step-gap",
    )


def build_step(
    trace_step: ShowuiTraceStep,
    processed_step: ProcessedLogStep | None,
    previous_processed_step: ProcessedLogStep | None,
) -> MidsceneFlowStep:
    caption = trace_step.caption
    observation = caption.observation or ""
    action = caption.action or ""
    expectation = caption.expectation or ""
    operation = normalize_trace_operation(caption.operation)
    route = route_from_operation(operation) or route_step(
        action,
        expectation,
        processed_step.action if processed_step else None,
    )
    evidence = MidsceneFlowEvidence(
        observation=observation,
        thought=caption.think,
        action=action,
        expectation=expectation,
        operation=operation,
        screenshot=normalize_source_screenshot_path(processed_step.screenshot_full if processed_step else None),
        crop=normalize_source_screenshot_path(processed_step.screenshot_crop if processed_step else None),
    )
    return MidsceneFlowStep(
        id=f"step-{trace_step.step_idx:03d}",
        source_trace=MidsceneFlowSourceTrace(
            step_index=trace_step.step_idx,
            raw_action=processed_step.action if processed_step else None,
            timestamp_sec=processed_step.timestamp if processed_step else None,
        ),
        intent=caption.think or action,
        timing=build_timing(processed_step, previous_processed_step),
        evidence=evidence,
        route=route,
        fallback=build_fallback(route, action),
    )


def default_recording_preparation_command(project: str) -> str:
    return (
        "将 record 生成的 trace、processed log 和截图复制到 "
        f"execution\\projects\\{project}\\source"
    )


def default_trace_generation_command(project: str) -> str:
    return f"未记录；请通过 --trace-generation-command 提供 {project} 的 trace 生成命令"


def convert_trace(options: ConvertOptions) -> Path:
    project_root = options.project_root.resolve()
    source_root = project_root / "source"
    trace_path = source_root / "showui-trace.json"
    processed_log_path = source_root / "processed-log.json"
    processed_log_with_screenshots_path = source_root / "processed-log-sc.json"
    screenshots_dir = source_root / "screenshots"
    output_path = project_root / "ir" / "midscene-flow.json"

    trace = read_model(trace_path, ShowuiTrace)
    assert isinstance(trace, ShowuiTrace)
    processed_steps = read_processed_log(processed_log_with_screenshots_path)
    flow = MidsceneFlow(
        schema_version=MIDSCENE_FLOW_SCHEMA_VERSION,
        project=options.project,
        goal=options.goal,
        source=MidsceneFlowSource(
            trace_path="source/showui-trace.json",
            processed_log_path="source/processed-log.json",
            processed_log_with_screenshots_path="source/processed-log-sc.json",
            screenshots_dir="source/screenshots",
        ),
        commands=MidsceneFlowCommands(
            recording_preparation=options.recording_preparation_command
            or default_recording_preparation_command(options.project),
            trace_generation=options.trace_generation_command or default_trace_generation_command(options.project),
            trace_to_flow_conversion=options.conversion_command,
            flow_execution=options.flow_execution_command or f"uv run cua flow run --project {options.project}",
        ),
        steps=[
            build_step(
                step,
                processed_steps[index] if index < len(processed_steps) else None,
                processed_steps[index - 1] if 0 < index < len(processed_steps) else None,
            )
            for index, step in enumerate(trace.trajectory)
        ],
    )
    write_json(output_path, flow)

    project_config_path = project_root / "config" / "project.json"
    overrides_path = project_root / "config" / "flow-overrides.json"
    write_json_if_missing(project_config_path, create_initial_project_config(flow))
    write_json_if_missing(overrides_path, create_empty_overrides(flow.project))
    for directory in (
        project_root / "calibration" / "proposals",
        project_root / "calibration" / "history",
        project_root / "generated",
        project_root / "reports",
    ):
        directory.mkdir(parents=True, exist_ok=True)
    return output_path
