from __future__ import annotations

import re
from datetime import UTC, datetime
from pathlib import Path

from cua.domain.types import CalibrationOptions, ResolveProjectOptions, ValidatedCalibration
from cua.models.flow import InputRoute
from cua.models.task import (
    CalibrationHistoryRecord,
    CalibrationProposal,
    FlowOverrides,
    FlowStepPatch,
    TaskProjectConfig,
)
from cua.task.io import atomic_write_model, read_model
from cua.task.resolver import (
    apply_step_patch,
    read_flow_with_fingerprint,
    resolve_project_flow,
    task_project_paths,
    validate_overrides,
    validate_project_config,
)

PROPOSAL_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._-]*$")
FINGERPRINT_PATTERN = re.compile(r"^[a-f0-9]{64}$")


def proposal_file_name(proposal: str) -> str:
    proposal_id = proposal[:-5] if proposal.endswith(".json") else proposal
    if not PROPOSAL_ID_PATTERN.fullmatch(proposal_id):
        raise ValueError(f"proposal id 只能包含小写字母、数字、点、下划线和连字符：{proposal}")
    return f"{proposal_id}.json"


def validate_proposal_shape(proposal: CalibrationProposal, expected_project: str) -> None:
    if proposal.project != expected_project:
        raise ValueError(f"proposal 项目 {proposal.project} 与请求项目 {expected_project} 不一致")
    if not PROPOSAL_ID_PATTERN.fullmatch(proposal.id):
        raise ValueError(f"无效 proposal id：{proposal.id}")
    if not proposal.summary.strip():
        raise ValueError("proposal.summary 不能为空")
    if not proposal.reason.strip():
        raise ValueError("proposal.reason 不能为空")
    if not FINGERPRINT_PATTERN.fullmatch(proposal.base_flow_fingerprint):
        raise ValueError("proposal.baseFlowFingerprint 必须是 SHA-256")
    if not proposal.changes:
        raise ValueError("proposal.changes 不能为空")


def validate_calibration_proposal(options: CalibrationOptions) -> ValidatedCalibration:
    paths = task_project_paths(options.project, options.project_root)
    proposal_path = paths.proposals_dir / proposal_file_name(options.proposal)
    proposal = read_model(proposal_path, CalibrationProposal, "校准建议")
    resolved = resolve_project_flow(
        ResolveProjectOptions(project=options.project, project_root=paths.project_root, executable=False)
    )
    config = read_model(paths.project_config_path, TaskProjectConfig, "项目配置")
    overrides = read_model(paths.overrides_path, FlowOverrides, "校准配置")
    base_flow, fingerprint = read_flow_with_fingerprint(paths.flow_path)

    validate_proposal_shape(proposal, options.project)
    if f"{proposal.id}.json" != proposal_path.name:
        raise ValueError(f"proposal 文件名必须与 id 一致：{proposal.id}.json")
    if proposal.base_flow_fingerprint != fingerprint:
        raise ValueError("proposal 已过期：基础 IR 指纹已变化，请基于当前 flow 重新生成建议")
    validate_project_config(config, base_flow)
    validate_overrides(overrides, base_flow)

    current_steps = {step.id: step for step in resolved.flow.steps}
    patched_steps = {}
    changed_ids: set[str] = set()
    for change in proposal.changes:
        if change.step_id in changed_ids:
            raise ValueError(f"proposal 重复修改 step：{change.step_id}")
        changed_ids.add(change.step_id)
        current = current_steps.get(change.step_id)
        if current is None:
            raise ValueError(f"proposal 引用了不存在的 step：{change.step_id}")
        if change.before.route.to_json_dict() != current.route.to_json_dict():
            raise ValueError(f"{change.step_id} 当前 route 与 proposal.before 不一致，请重新生成建议")
        if change.before.timing is not None:
            current_timing = current.timing.to_json_dict() if current.timing else None
            if change.before.timing.to_json_dict() != current_timing:
                raise ValueError(f"{change.step_id} 当前 timing 与 proposal.before 不一致，请重新生成建议")
        patched_steps[change.step_id] = apply_step_patch(current, change.after)

    return ValidatedCalibration(
        proposal=proposal,
        proposal_path=proposal_path,
        current_steps=current_steps,
        patched_steps=patched_steps,
        config=config,
        overrides=overrides,
    )


def merge_applied_patch(
    existing: FlowStepPatch | None,
    patched_route: object,
    patched_wait_before_ms: int | None,
    include_timing: bool,
) -> FlowStepPatch:
    data = existing.to_json_dict() if existing else {}
    data["route"] = patched_route
    if include_timing:
        data["timing"] = {"waitBeforeMs": patched_wait_before_ms or 0}
    return FlowStepPatch.model_validate(data)


def apply_calibration_proposal(options: CalibrationOptions) -> CalibrationHistoryRecord:
    validated = validate_calibration_proposal(options)
    paths = task_project_paths(options.project, options.project_root)
    history_path = paths.history_dir / f"{validated.proposal.id}.json"
    if history_path.exists():
        raise ValueError(f"校准历史已存在：{validated.proposal.id}")

    next_overrides = validated.overrides.model_copy(deep=True)
    next_config = validated.config.model_copy(deep=True)
    for change in validated.proposal.changes:
        patched = validated.patched_steps[change.step_id]
        next_overrides.steps[change.step_id] = merge_applied_patch(
            next_overrides.steps.get(change.step_id),
            patched.route.to_json_dict(),
            patched.timing.wait_before_ms if patched.timing else None,
            change.after.timing is not None,
        )
        if isinstance(patched.route, InputRoute):
            for definition in next_config.inputs.values():
                if definition.binding.step_id == change.step_id:
                    definition.default = patched.route.value

    history = CalibrationHistoryRecord.model_validate(
        {
            **validated.proposal.to_json_dict(),
            "status": "applied",
            "appliedAt": datetime.now(UTC),
        }
    )
    atomic_write_model(paths.overrides_path, next_overrides)
    atomic_write_model(paths.project_config_path, next_config)
    atomic_write_model(history_path, history)
    validated.proposal_path.unlink()
    return history
