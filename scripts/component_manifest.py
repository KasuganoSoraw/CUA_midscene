"""Computer-Use Component manifest 与静态验证。"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Any

import tomllib


class ComponentValidationError(ValueError):
    """组件结构或 manifest 不满足发行契约。"""


def load_component_metadata(repository_root: Path) -> dict[str, Any]:
    metadata_path = repository_root / "component.toml"
    with metadata_path.open("rb") as stream:
        metadata = tomllib.load(stream)
    required = (
        "schema-version",
        "name",
        "version",
        "requires-python",
        "requires-node",
        "runtime-bridge-protocol",
        "python-packages",
    )
    missing = [key for key in required if key not in metadata]
    if missing:
        raise ComponentValidationError(f"component.toml 缺少字段：{', '.join(missing)}")
    packages = metadata["python-packages"]
    if not isinstance(packages, list) or not packages:
        raise ComponentValidationError("component.toml 的 python-packages 必须是非空数组")
    return metadata


def build_manifest(metadata: dict[str, Any], wheel_files: dict[str, Path]) -> dict[str, Any]:
    packages: list[dict[str, str]] = []
    for package in metadata["python-packages"]:
        module = str(package["module"])
        wheel = wheel_files.get(module)
        if wheel is None:
            raise ComponentValidationError(f"缺少 {module} wheel")
        packages.append(
            {
                "distribution": str(package["distribution"]),
                "module": module,
                "wheel": f"python/{wheel.name}",
            }
        )
    return {
        "schemaVersion": str(metadata["schema-version"]),
        "name": str(metadata["name"]),
        "version": str(metadata["version"]),
        "python": {
            "requiresPython": str(metadata["requires-python"]),
            "packages": packages,
        },
        "javascript": {
            "requiresNode": str(metadata["requires-node"]),
            "root": "runtime",
            "entry": "dist/runtime-bridge/worker.js",
            "assets": ["schemas", "projects"],
        },
        "protocol": {
            "runtimeBridge": str(metadata["runtime-bridge-protocol"]),
        },
    }


def _require_string(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ComponentValidationError(f"{field} 必须是非空字符串")
    return value.strip()


def _require_object(value: Any, field: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ComponentValidationError(f"{field} 必须是 object")
    return value


def _relative_path(value: Any, field: str) -> str:
    raw = _require_string(value, field)
    if "\\" in raw:
        raise ComponentValidationError(f"{field} 必须使用正斜杠相对路径：{raw}")
    posix = PurePosixPath(raw)
    windows = PureWindowsPath(raw)
    if posix.is_absolute() or windows.is_absolute() or windows.drive or ".." in posix.parts:
        raise ComponentValidationError(f"{field} 必须位于组件根内：{raw}")
    normalized = posix.as_posix()
    if normalized in {"", "."}:
        raise ComponentValidationError(f"{field} 不能指向组件根")
    return normalized


def validate_manifest_document(document: Any) -> dict[str, Any]:
    root = _require_object(document, "manifest")
    if _require_string(root.get("schemaVersion"), "schemaVersion") != "1.0":
        raise ComponentValidationError("仅支持 manifest schemaVersion 1.0")
    _require_string(root.get("name"), "name")
    _require_string(root.get("version"), "version")

    python = _require_object(root.get("python"), "python")
    _require_string(python.get("requiresPython"), "python.requiresPython")
    packages = python.get("packages")
    if not isinstance(packages, list) or not packages:
        raise ComponentValidationError("python.packages 必须是非空数组")
    modules: set[str] = set()
    for index, package_value in enumerate(packages):
        package = _require_object(package_value, f"python.packages[{index}]")
        _require_string(package.get("distribution"), f"python.packages[{index}].distribution")
        module = _require_string(package.get("module"), f"python.packages[{index}].module")
        if not re.fullmatch(r"[A-Za-z_]\w*", module):
            raise ComponentValidationError(f"Python module 名称无效：{module}")
        if module in modules:
            raise ComponentValidationError(f"Python module 重复声明：{module}")
        modules.add(module)
        wheel = _relative_path(package.get("wheel"), f"python.packages[{index}].wheel")
        if not wheel.endswith(".whl"):
            raise ComponentValidationError(f"wheel 路径必须以 .whl 结尾：{wheel}")
    expected_modules = {"cua_agent", "cua_recorder", "cua_record"}
    if modules != expected_modules:
        raise ComponentValidationError(
            f"Python modules 必须为 {sorted(expected_modules)}，实际为 {sorted(modules)}"
        )

    javascript = _require_object(root.get("javascript"), "javascript")
    _require_string(javascript.get("requiresNode"), "javascript.requiresNode")
    _relative_path(javascript.get("root"), "javascript.root")
    _relative_path(javascript.get("entry"), "javascript.entry")
    assets = javascript.get("assets")
    if not isinstance(assets, list) or not assets:
        raise ComponentValidationError("javascript.assets 必须是非空数组")
    for index, asset in enumerate(assets):
        _relative_path(asset, f"javascript.assets[{index}]")

    protocol = _require_object(root.get("protocol"), "protocol")
    _require_string(protocol.get("runtimeBridge"), "protocol.runtimeBridge")
    return root


def _component_path(component_root: Path, relative: str) -> Path:
    target = (component_root / Path(*PurePosixPath(relative).parts)).resolve()
    try:
        target.relative_to(component_root.resolve())
    except ValueError as error:
        raise ComponentValidationError(f"组件路径越界：{relative}") from error
    return target


def _validate_distribution_surface(component_root: Path) -> None:
    allowed_root_entries = {"manifest.json", "python", "runtime"}
    unexpected = sorted(item.name for item in component_root.iterdir() if item.name not in allowed_root_entries)
    if unexpected:
        raise ComponentValidationError(f"组件根包含未声明内容：{', '.join(unexpected)}")

    runtime = component_root / "runtime"
    prohibited_directories = {"src", "tests", ".venv", "__pycache__"}
    prohibited_files = {
        "pyproject.toml",
        "uv.lock",
        "tsconfig.json",
        "tsconfig.build.json",
        ".env",
        ".env.local",
    }
    for current, directories, files in os.walk(runtime):
        relative = Path(current).relative_to(runtime)
        if relative.parts and relative.parts[0] == "node_modules":
            directories[:] = []
            continue
        invalid_directories = sorted(set(directories) & prohibited_directories)
        invalid_files = sorted(set(files) & prohibited_files)
        if invalid_directories or invalid_files:
            values = [*invalid_directories, *invalid_files]
            raise ComponentValidationError(
                f"Runtime 包含开发或源码内容：{relative.as_posix()}：{', '.join(values)}"
            )


def verify_component(component_root: Path) -> dict[str, Any]:
    root = component_root.resolve()
    if not root.is_dir():
        raise ComponentValidationError(f"组件目录不存在：{root}")
    manifest_path = root / "manifest.json"
    try:
        document = json.loads(manifest_path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise ComponentValidationError(f"组件缺少 manifest.json：{root}") from error
    except json.JSONDecodeError as error:
        raise ComponentValidationError(f"manifest.json 不是合法 JSON：{error}") from error
    manifest = validate_manifest_document(document)

    python = _require_object(manifest["python"], "python")
    for package in python["packages"]:
        wheel = _component_path(root, str(package["wheel"]))
        if not wheel.is_file():
            raise ComponentValidationError(f"组件 wheel 不存在：{wheel}")

    javascript = _require_object(manifest["javascript"], "javascript")
    runtime_root = _component_path(root, str(javascript["root"]))
    entry = _component_path(runtime_root, str(javascript["entry"]))
    if not entry.is_file():
        raise ComponentValidationError(f"Runtime bridge 不存在：{entry}")
    for required in ("package.json", "node_modules"):
        target = runtime_root / required
        if not target.exists():
            raise ComponentValidationError(f"JavaScript Runtime 缺少：{target}")
    for asset in javascript["assets"]:
        target = _component_path(runtime_root, str(asset))
        if not target.is_dir():
            raise ComponentValidationError(f"JavaScript Runtime asset 不存在：{target}")

    package_document = json.loads((runtime_root / "package.json").read_text(encoding="utf-8"))
    if package_document.get("type") != "module":
        raise ComponentValidationError("runtime/package.json 必须声明 type=module")
    if "devDependencies" in package_document or "scripts" in package_document:
        raise ComponentValidationError("runtime/package.json 不得包含开发依赖或构建脚本")
    _validate_distribution_surface(root)
    return manifest
