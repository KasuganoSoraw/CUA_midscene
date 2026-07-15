from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import pytest
from pydantic import ValidationError

from cua.cli.main import build_parser
from cua.domain.types import ResolveTaskOptions, ResolvedTaskResult, TaskPaths
from cua.models.schema import GENERATED_COMMENT, SCHEMA_MODELS, check_schemas, schema_documents
from cua.models.task import ExecutorResult, SceneManifest, TaskManifest
from cua.task.yaml_task import read_yaml_document

EXECUTION_ROOT = Path(__file__).resolve().parents[2]
SCENE_ROOT = EXECUTION_ROOT / "projects" / "browser-demo"
TASK_ROOT = SCENE_ROOT / "air-tickets-demo"


def read_json(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


def test_existing_task_assets_pass_models_and_yaml_parser() -> None:
    scene = SceneManifest.model_validate(read_json(SCENE_ROOT / "scene.json"))
    task = TaskManifest.model_validate(read_json(TASK_ROOT / "task.json"))
    document = read_yaml_document(TASK_ROOT / "task.yaml")
    result = ExecutorResult(
        schema_version="0.2",
        status="succeeded",
        source_yaml_path=str(TASK_ROOT / "task.yaml"),
        dry_run=True,
        task_count=len(document["tasks"]),
        finished_at=datetime.now(UTC),
    )
    assert scene.scene == task.scene == "browser-demo"
    assert result.task_count == 1
    for schema in schema_documents().values():
        assert schema["$comment"] == GENERATED_COMMENT


def test_contract_models_reject_unknown_fields() -> None:
    task_data = read_json(TASK_ROOT / "task.json")
    task_data["unexpected"] = True  # type: ignore[index]
    with pytest.raises(ValidationError, match="unexpected"):
        TaskManifest.model_validate(task_data)


def test_schema_files_are_current_and_exclude_internal_value_objects() -> None:
    check_schemas(EXECUTION_ROOT / "schemas")
    published_models = set(SCHEMA_MODELS.values())
    assert TaskPaths not in published_models
    assert ResolveTaskOptions not in published_models
    assert ResolvedTaskResult not in published_models
    assert set(SCHEMA_MODELS) == {
        "scene.schema.json",
        "task.schema.json",
        "execution-result.schema.json",
    }


def test_python_package_does_not_reference_midscene_sdk() -> None:
    python_sources = "\n".join(path.read_text(encoding="utf-8") for path in (EXECUTION_ROOT / "cua").rglob("*.py"))
    assert "@midscene" not in python_sources
    assert "agentForComputer" not in python_sources


def test_cli_has_chinese_help() -> None:
    assert "CUA 场景、任务与 Midscene YAML 执行工具" in build_parser().format_help()
