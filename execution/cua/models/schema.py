from __future__ import annotations

import argparse
import json
from pathlib import Path
from pydantic import BaseModel

from .task import ExecutorResult, SceneManifest, TaskManifest

SCHEMA_MODELS: dict[str, type[BaseModel]] = {
    "scene.schema.json": SceneManifest,
    "task.schema.json": TaskManifest,
    "execution-result.schema.json": ExecutorResult,
}

GENERATED_COMMENT = "由 cua.models.schema 从 Pydantic 模型生成，请勿手工编辑。"


def make_schema_portable(value: object) -> object:
    if isinstance(value, dict):
        return {
            key: make_schema_portable(item)
            for key, item in value.items()
            if key != "discriminator"
        }
    if isinstance(value, list):
        return [make_schema_portable(item) for item in value]
    return value


def schema_documents() -> dict[str, dict[str, object]]:
    documents: dict[str, dict[str, object]] = {}
    for filename, model in SCHEMA_MODELS.items():
        schema = make_schema_portable(model.model_json_schema(by_alias=True, mode="validation"))
        assert isinstance(schema, dict)
        schema["$comment"] = GENERATED_COMMENT
        documents[filename] = schema
    return documents


def render_schema(schema: dict[str, object]) -> str:
    return json.dumps(schema, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def write_schemas(output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    expected = set(SCHEMA_MODELS)
    for path in output_dir.glob("*.schema.json"):
        if path.name not in expected:
            path.unlink()
    for filename, schema in schema_documents().items():
        (output_dir / filename).write_text(render_schema(schema), encoding="utf-8")


def check_schemas(output_dir: Path) -> None:
    stale = []
    for filename, schema in schema_documents().items():
        path = output_dir / filename
        if not path.is_file() or path.read_text(encoding="utf-8") != render_schema(schema):
            stale.append(filename)
    if stale:
        raise RuntimeError(f"JSON Schema 需要重新生成：{', '.join(stale)}")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="生成或检查 CUA JSON Schema")
    parser.add_argument("--output", type=Path, default=Path("schemas"))
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args(argv)
    if args.check:
        check_schemas(args.output)
    else:
        write_schemas(args.output)


if __name__ == "__main__":
    main()
