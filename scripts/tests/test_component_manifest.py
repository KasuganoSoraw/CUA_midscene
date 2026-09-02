from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from scripts.build_component import _sanitized_runtime_package
from scripts.component_manifest import (
    ComponentValidationError,
    build_manifest,
    load_component_metadata,
    verify_component,
)

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


class ComponentManifestTest(unittest.TestCase):
    def component_fixture(self, root: Path) -> Path:
        component = root / "component"
        python = component / "python"
        runtime = component / "runtime"
        for directory in (
            python,
            runtime / "dist" / "runtime-bridge",
            runtime / "node_modules",
            runtime / "schemas",
            runtime / "projects",
        ):
            directory.mkdir(parents=True, exist_ok=True)
        wheel_files = {
            "cua_agent": python / "cua_agent-0.1.0-py3-none-any.whl",
            "cua_recorder": python / "cua_windows_recorder-0.1.0-py3-none-any.whl",
            "cua_record": python / "cua_record-0.1.0-py3-none-any.whl",
        }
        for wheel in wheel_files.values():
            wheel.write_bytes(b"wheel")
        (runtime / "dist" / "runtime-bridge" / "worker.js").write_text("", encoding="utf-8")
        (runtime / "package.json").write_text(
            json.dumps(
                {
                    "name": "cua-midscene-runtime",
                    "version": "1.0.0",
                    "private": True,
                    "type": "module",
                    "engines": {"node": ">=22.18.0"},
                    "dependencies": {},
                }
            ),
            encoding="utf-8",
        )
        manifest = build_manifest(load_component_metadata(REPOSITORY_ROOT), wheel_files)
        (component / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        return component

    def test_valid_component_is_self_describing(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            component = self.component_fixture(Path(temporary))

            manifest = verify_component(component)

            self.assertEqual("computer-use", manifest["name"])
            self.assertEqual(
                {"cua_agent", "cua_recorder", "cua_record"},
                {package["module"] for package in manifest["python"]["packages"]},
            )

    def test_manifest_rejects_absolute_and_missing_paths(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            component = self.component_fixture(Path(temporary))
            manifest_path = component / "manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["python"]["packages"][0]["wheel"] = "C:/build/cua_agent.whl"
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

            with self.assertRaisesRegex(ComponentValidationError, "组件根内"):
                verify_component(component)

            manifest["python"]["packages"][0]["wheel"] = "python/missing.whl"
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            with self.assertRaisesRegex(ComponentValidationError, "wheel 不存在"):
                verify_component(component)

    def test_component_rejects_source_and_development_surface(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            component = self.component_fixture(Path(temporary))
            (component / "runtime" / "src").mkdir()

            with self.assertRaisesRegex(ComponentValidationError, "开发或源码内容"):
                verify_component(component)

    def test_runtime_package_contains_only_runtime_fields(self) -> None:
        source = {
            "name": "cua-midscene",
            "version": "1.0.0",
            "engines": {"node": ">=22.18.0"},
            "dependencies": {"fastify": "^5.0.0"},
            "devDependencies": {"typescript": "^5.0.0"},
            "scripts": {"build": "tsc"},
        }

        package = _sanitized_runtime_package(source)

        self.assertNotIn("devDependencies", package)
        self.assertNotIn("scripts", package)
        self.assertEqual({"fastify": "^5.0.0"}, package["dependencies"])


if __name__ == "__main__":
    unittest.main()
