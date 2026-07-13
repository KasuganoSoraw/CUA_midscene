from __future__ import annotations

from typing import Annotated, Literal

from pydantic import Field

from .base import ContractModel

MIDSCENE_FLOW_SCHEMA_VERSION = "0.1"


class MidsceneFlowSource(ContractModel):
    trace_path: str
    processed_log_path: str | None = None
    processed_log_with_screenshots_path: str | None = None
    screenshots_dir: str | None = None


class MidsceneFlowCommands(ContractModel):
    recording_preparation: str | None = None
    trace_generation: str | None = None
    trace_to_flow_conversion: str
    flow_execution: str | None = None


class MidsceneFlowSourceTrace(ContractModel):
    step_index: int
    raw_action: str | None = None
    timestamp_sec: float | None = None


class MidsceneFlowTiming(ContractModel):
    recorded_gap_ms: int | None = Field(default=None, ge=0)
    wait_before_ms: int | None = Field(default=None, ge=0)
    wait_reason: Literal["recorded-step-gap", "manual-calibration"] | None = None


class TraceClickOperation(ContractModel):
    type: Literal["click"]
    prompt: str


class TraceInputOperation(ContractModel):
    type: Literal["input"]
    prompt: str
    locate_prompt: str | None = None
    value: str


class TraceKeyboardOperation(ContractModel):
    type: Literal["keyboard"]
    prompt: str | None = None
    key: str


class TraceWaitOperation(ContractModel):
    type: Literal["wait"]
    prompt: str | None = None
    condition: str


class TraceUnknownOperation(ContractModel):
    type: Literal["unknown"]
    prompt: str | None = None


MidsceneTraceOperation = Annotated[
    TraceClickOperation
    | TraceInputOperation
    | TraceKeyboardOperation
    | TraceWaitOperation
    | TraceUnknownOperation,
    Field(discriminator="type"),
]


class MidsceneFlowEvidence(ContractModel):
    observation: str
    thought: str | None = None
    action: str
    expectation: str | None = None
    operation: MidsceneTraceOperation | None = None
    screenshot: str | None = None
    crop: str | None = None


class KeyboardRoute(ContractModel):
    strategy: Literal["keyboard"]
    key_name: str


class InputRoute(ContractModel):
    strategy: Literal["input"]
    prompt: str
    locate_prompt: str
    value: str
    mode: Literal["replace", "append", "typeOnly"] | None = None
    input_method: Literal["keyboard-action"] | None = None


class TapRoute(ContractModel):
    strategy: Literal["tap"]
    prompt: str


class ActRoute(ContractModel):
    strategy: Literal["act"]
    prompt: str


class WaitRoute(ContractModel):
    strategy: Literal["wait"]
    prompt: str | None = None
    condition: str
    timeout_ms: int | None = Field(default=None, ge=0)


class ManualReviewRoute(ContractModel):
    strategy: Literal["manual-review"]
    reason: str


MidsceneFlowRoute = Annotated[
    KeyboardRoute | InputRoute | TapRoute | ActRoute | WaitRoute | ManualReviewRoute,
    Field(discriminator="strategy"),
]


class MidsceneFlowFallback(ContractModel):
    strategy: Literal["vision", "fail"]
    instruction: str | None = None
    reason: str | None = None


class MidsceneFlowStep(ContractModel):
    id: str
    source_trace: MidsceneFlowSourceTrace
    intent: str
    timing: MidsceneFlowTiming | None = None
    evidence: MidsceneFlowEvidence
    route: MidsceneFlowRoute
    fallback: MidsceneFlowFallback


class MidsceneFlow(ContractModel):
    schema_version: Literal["0.1"]
    project: str
    goal: str
    source: MidsceneFlowSource
    commands: MidsceneFlowCommands | None = None
    steps: list[MidsceneFlowStep]
