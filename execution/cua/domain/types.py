from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from cua.models.flow import MidsceneFlow, MidsceneFlowStep
    from cua.models.task import CalibrationProposal, FlowOverrides, ResolvedFlowSources, TaskProjectConfig


@dataclass(frozen=True)
class TaskProjectPaths:
    project_root: Path
    flow_path: Path
    project_config_path: Path
    overrides_path: Path
    proposals_dir: Path
    history_dir: Path
    reports_dir: Path


@dataclass(frozen=True)
class ResolveProjectOptions:
    project: str
    project_root: Path | None = None
    flow_path: Path | None = None
    inputs: dict[str, str] | None = None
    executable: bool = True


@dataclass(frozen=True)
class ResolvedFlowResult:
    flow: MidsceneFlow
    sources: ResolvedFlowSources
    inputs: dict[str, str]


@dataclass(frozen=True)
class CalibrationOptions:
    project: str
    proposal: str
    project_root: Path | None = None


@dataclass(frozen=True)
class ValidatedCalibration:
    proposal: CalibrationProposal
    proposal_path: Path
    current_steps: dict[str, MidsceneFlowStep]
    patched_steps: dict[str, MidsceneFlowStep]
    config: TaskProjectConfig
    overrides: FlowOverrides
