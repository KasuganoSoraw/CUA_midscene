from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import Field

from .base import ContractModel
from .flow import MidsceneFlow, MidsceneFlowRoute, MidsceneFlowTiming

TASK_PROJECT_SCHEMA_VERSION = "0.1"
FLOW_OVERRIDES_SCHEMA_VERSION = "0.1"
CALIBRATION_PROPOSAL_SCHEMA_VERSION = "0.1"
RESOLVED_FLOW_SCHEMA_VERSION = "0.1"


class TaskInputBinding(ContractModel):
    step_id: str
    field: Literal["route.value"]


class TaskInputDefinition(ContractModel):
    type: Literal["string"]
    label: str
    description: str | None = None
    default: str
    binding: TaskInputBinding


class TaskProjectConfig(ContractModel):
    schema_version: Literal["0.1"] = TASK_PROJECT_SCHEMA_VERSION
    project: str
    title: str
    description: str
    goal: str
    inputs: dict[str, TaskInputDefinition]


class RoutePatch(ContractModel):
    strategy: Literal["keyboard", "input", "tap", "act", "wait", "manual-review"] | None = None
    key_name: str | None = None
    prompt: str | None = None
    locate_prompt: str | None = None
    value: str | None = None
    mode: Literal["replace", "append", "typeOnly"] | None = None
    input_method: Literal["keyboard-action"] | None = None
    condition: str | None = None
    timeout_ms: int | None = Field(default=None, ge=0)
    reason: str | None = None


class TimingPatch(ContractModel):
    wait_before_ms: int | None = Field(default=None, ge=0)


class FlowStepPatch(ContractModel):
    route: RoutePatch | None = None
    timing: TimingPatch | None = None


class FlowOverrides(ContractModel):
    schema_version: Literal["0.1"] = FLOW_OVERRIDES_SCHEMA_VERSION
    project: str
    steps: dict[str, FlowStepPatch]


class CalibrationBefore(ContractModel):
    route: MidsceneFlowRoute
    timing: MidsceneFlowTiming | None = None


class CalibrationChange(ContractModel):
    step_id: str
    before: CalibrationBefore
    after: FlowStepPatch


class CalibrationProposal(ContractModel):
    schema_version: Literal["0.1"] = CALIBRATION_PROPOSAL_SCHEMA_VERSION
    id: str
    project: str
    base_flow_fingerprint: str
    summary: str
    reason: str
    changes: list[CalibrationChange]


class CalibrationHistoryRecord(CalibrationProposal):
    status: Literal["applied"]
    applied_at: datetime


class ResolvedFlowSources(ContractModel):
    base_flow_path: str
    project_config_path: str
    overrides_path: str
    base_flow_fingerprint: str
    applied_override_steps: list[str]


class ResolvedFlowSnapshot(ContractModel):
    schema_version: Literal["0.1"] = RESOLVED_FLOW_SCHEMA_VERSION
    resolved_at: datetime
    flow: MidsceneFlow
    sources: ResolvedFlowSources
    inputs: dict[str, str]
