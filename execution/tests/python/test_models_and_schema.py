from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator
from pydantic import ValidationError

from cua.cli.main import build_parser
from cua.domain.types import ResolveProjectOptions, ResolvedFlowResult, TaskProjectPaths
from cua.models.flow import MidsceneFlow
from cua.models.schema import GENERATED_COMMENT, SCHEMA_MODELS, check_schemas, schema_documents
from cua.models.task import (
    CalibrationProposal,
    FlowOverrides,
    ResolvedFlowSnapshot,
    ResolvedFlowSources,
    TaskProjectConfig,
)

EXECUTION_ROOT = Path(__file__).resolve().parents[2]
PROJECT_ROOT = EXECUTION_ROOT / "projects" / "air-tickets-demo"


def read_json(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


def test_existing_project_assets_pass_models_and_json_schema() -> None:
    flow_data = read_json(PROJECT_ROOT / "ir" / "midscene-flow.json")
    project_data = read_json(PROJECT_ROOT / "config" / "project.json")
    overrides_data = read_json(PROJECT_ROOT / "config" / "flow-overrides.json")

    flow = MidsceneFlow.model_validate(flow_data)
    config = TaskProjectConfig.model_validate(project_data)
    overrides = FlowOverrides.model_validate(overrides_data)
    proposal = CalibrationProposal.model_validate(
        {
            "schemaVersion": "0.1",
            "id": "example-proposal",
            "project": flow.project,
            "baseFlowFingerprint": "0" * 64,
            "summary": "测试建议",
            "reason": "验证契约",
            "changes": [
                {
                    "stepId": flow.steps[0].id,
                    "before": {"route": flow.steps[0].route.to_json_dict()},
                    "after": {"route": {"prompt": "修正后的目标"}},
                }
            ],
        }
    )
    snapshot = ResolvedFlowSnapshot(
        resolved_at=datetime.now(UTC),
        flow=flow,
        sources=ResolvedFlowSources(
            base_flow_path=str(PROJECT_ROOT / "ir" / "midscene-flow.json"),
            project_config_path=str(PROJECT_ROOT / "config" / "project.json"),
            overrides_path=str(PROJECT_ROOT / "config" / "flow-overrides.json"),
            base_flow_fingerprint="0" * 64,
            applied_override_steps=[],
        ),
        inputs={input_id: definition.default for input_id, definition in config.inputs.items()},
    )

    documents = schema_documents()
    values = {
        "midscene-flow.schema.json": flow.to_json_dict(),
        "project.schema.json": config.to_json_dict(),
        "flow-overrides.schema.json": overrides.to_json_dict(),
        "calibration-proposal.schema.json": proposal.to_json_dict(),
        "resolved-flow.schema.json": snapshot.to_json_dict(),
    }
    for filename, schema in documents.items():
        Draft202012Validator.check_schema(schema)
        Draft202012Validator(schema).validate(values[filename])
        assert schema["$comment"] == GENERATED_COMMENT


def test_contract_models_reject_unknown_fields_and_invalid_routes() -> None:
    flow_data = read_json(PROJECT_ROOT / "ir" / "midscene-flow.json")
    flow_data["unexpected"] = True  # type: ignore[index]
    with pytest.raises(ValidationError, match="unexpected"):
        MidsceneFlow.model_validate(flow_data)

    valid_flow = read_json(PROJECT_ROOT / "ir" / "midscene-flow.json")
    valid_flow["steps"][0]["route"] = {"strategy": "tap"}  # type: ignore[index]
    with pytest.raises(ValidationError, match="prompt"):
        MidsceneFlow.model_validate(valid_flow)


def test_schema_files_are_current_and_exclude_internal_value_objects() -> None:
    check_schemas(EXECUTION_ROOT / "schemas")
    published_models = set(SCHEMA_MODELS.values())
    assert TaskProjectPaths not in published_models
    assert ResolveProjectOptions not in published_models
    assert ResolvedFlowResult not in published_models


def test_python_package_does_not_reference_midscene_sdk() -> None:
    python_sources = "\n".join(path.read_text(encoding="utf-8") for path in (EXECUTION_ROOT / "cua").rglob("*.py"))
    assert "@midscene" not in python_sources
    assert "agentForComputer" not in python_sources


def test_cli_has_chinese_help() -> None:
    help_text = build_parser().format_help()
    assert "CUA 任务转换、校准与执行工具" in help_text
