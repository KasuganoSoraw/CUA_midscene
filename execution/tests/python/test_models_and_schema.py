from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator
from pydantic import ValidationError

from cua.cli.main import build_parser
from cua.domain.types import ResolveTaskOptions, ResolvedFlowResult, TaskPaths
from cua.models.flow import MidsceneFlow
from cua.models.schema import GENERATED_COMMENT, SCHEMA_MODELS, check_schemas, schema_documents
from cua.models.task import ResolvedFlowSnapshot, ResolvedFlowSources, SceneManifest, TaskManifest

EXECUTION_ROOT = Path(__file__).resolve().parents[2]
SCENE_ROOT = EXECUTION_ROOT / "projects" / "browser-demo"
TASK_ROOT = SCENE_ROOT / "air-tickets-demo"


def read_json(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


def test_existing_task_assets_pass_models_and_json_schema() -> None:
    flow = MidsceneFlow.model_validate(read_json(TASK_ROOT / "midscene-flow.json"))
    scene = SceneManifest.model_validate(read_json(SCENE_ROOT / "scene.json"))
    task = TaskManifest.model_validate(read_json(TASK_ROOT / "task.json"))
    snapshot = ResolvedFlowSnapshot(
        schema_version="0.1",
        resolved_at=datetime.now(UTC),
        flow=flow,
        sources=ResolvedFlowSources(
            flow_path=str(TASK_ROOT / "midscene-flow.json"),
            task_path=str(TASK_ROOT / "task.json"),
        ),
        inputs={
            input_id: flow.steps[int(definition.binding.step_id.removeprefix("step-")) - 1].route.value  # type: ignore[union-attr]
            for input_id, definition in task.inputs.items()
        },
    )
    values = {
        "midscene-flow.schema.json": flow.to_json_dict(),
        "scene.schema.json": scene.to_json_dict(),
        "task.schema.json": task.to_json_dict(),
        "resolved-flow.schema.json": snapshot.to_json_dict(),
    }
    for filename, schema in schema_documents().items():
        Draft202012Validator.check_schema(schema)
        Draft202012Validator(schema).validate(values[filename])
        assert schema["$comment"] == GENERATED_COMMENT


def test_contract_models_reject_unknown_fields_and_invalid_routes() -> None:
    flow_data = read_json(TASK_ROOT / "midscene-flow.json")
    flow_data["unexpected"] = True  # type: ignore[index]
    with pytest.raises(ValidationError, match="unexpected"):
        MidsceneFlow.model_validate(flow_data)
    valid_flow = read_json(TASK_ROOT / "midscene-flow.json")
    valid_flow["steps"][0]["route"] = {"strategy": "tap"}  # type: ignore[index]
    with pytest.raises(ValidationError, match="prompt"):
        MidsceneFlow.model_validate(valid_flow)


def test_schema_files_are_current_and_exclude_internal_value_objects() -> None:
    check_schemas(EXECUTION_ROOT / "schemas")
    published_models = set(SCHEMA_MODELS.values())
    assert TaskPaths not in published_models
    assert ResolveTaskOptions not in published_models
    assert ResolvedFlowResult not in published_models


def test_python_package_does_not_reference_midscene_sdk() -> None:
    python_sources = "\n".join(path.read_text(encoding="utf-8") for path in (EXECUTION_ROOT / "cua").rglob("*.py"))
    assert "@midscene" not in python_sources
    assert "agentForComputer" not in python_sources


def test_cli_has_chinese_help() -> None:
    assert "CUA 场景、任务与执行工具" in build_parser().format_help()
