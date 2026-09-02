"""构建可由宿主装配的 Computer-Use Component。"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from collections.abc import Sequence
from pathlib import Path
from typing import Any

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.component_manifest import (
    ComponentValidationError,
    build_manifest,
    load_component_metadata,
    verify_component,
)


def _run(command: Sequence[str], *, cwd: Path) -> None:
    rendered = subprocess.list2cmdline(list(command))
    print(f"[{cwd}] {rendered}", flush=True)
    subprocess.run(list(command), cwd=cwd, check=True)


def _tool(explicit: str | None, *names: str) -> str:
    if explicit:
        return explicit
    for name in names:
        resolved = shutil.which(name)
        if resolved:
            return resolved
    raise RuntimeError(f"找不到构建工具：{' / '.join(names)}")


def _safe_output(output: Path, repository_root: Path) -> Path:
    resolved = output.resolve()
    if resolved == repository_root.resolve() or resolved == Path(resolved.anchor):
        raise RuntimeError(f"组件输出目录过于宽泛：{resolved}")
    if len(resolved.parts) < 3:
        raise RuntimeError(f"组件输出目录不安全：{resolved}")
    return resolved


def _sanitized_runtime_package(source: dict[str, Any]) -> dict[str, Any]:
    document = {
        "name": f"{source['name']}-runtime",
        "version": source["version"],
        "description": "Computer-Use Component JavaScript Runtime",
        "private": True,
        "type": "module",
        "engines": source["engines"],
        "dependencies": source["dependencies"],
    }
    return document


def _copy_runtime_assets(execution_root: Path, runtime_root: Path) -> None:
    for name in ("dist", "schemas", "projects"):
        source = execution_root / name
        target = runtime_root / name
        if not source.is_dir():
            raise RuntimeError(f"JavaScript Runtime 构建后缺少目录：{source}")
        shutil.copytree(
            source,
            target,
            ignore=shutil.ignore_patterns("reports", "midscene_run", "__pycache__"),
        )


def _build_javascript_runtime(
    repository_root: Path,
    staging_root: Path,
    npm_executable: str,
) -> None:
    source = repository_root / "execution"
    build_root = staging_root / ".execution-build"
    shutil.copytree(
        source,
        build_root,
        ignore=shutil.ignore_patterns(
            "node_modules",
            "dist",
            "tests",
            "reports",
            "midscene_run",
            ".env",
            ".env.local",
        ),
    )
    _run([npm_executable, "ci", "--ignore-scripts"], cwd=build_root)
    _run([npm_executable, "run", "build"], cwd=build_root)
    _run([npm_executable, "prune", "--omit=dev", "--ignore-scripts"], cwd=build_root)

    runtime_root = staging_root / "runtime"
    runtime_root.mkdir()
    _copy_runtime_assets(build_root, runtime_root)
    shutil.copytree(build_root / "node_modules", runtime_root / "node_modules")
    source_package = json.loads((build_root / "package.json").read_text(encoding="utf-8"))
    runtime_package = _sanitized_runtime_package(source_package)
    (runtime_root / "package.json").write_text(
        json.dumps(runtime_package, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    shutil.rmtree(build_root)


def _build_python_wheels(
    repository_root: Path,
    staging_root: Path,
    uv_executable: str,
    metadata: dict[str, Any],
) -> dict[str, Path]:
    output = staging_root / "python"
    output.mkdir()
    wheels: dict[str, Path] = {}
    for package in metadata["python-packages"]:
        project_root = repository_root / str(package["project"])
        _run(
            [uv_executable, "build", "--wheel", "--out-dir", str(output)],
            cwd=project_root,
        )
        prefix = str(package["wheel-prefix"])
        matches = sorted(output.glob(f"{prefix}-*.whl"))
        if len(matches) != 1:
            raise RuntimeError(
                f"{package['distribution']} wheel 数量应为 1，实际为 {len(matches)}"
            )
        wheels[str(package["module"])] = matches[0]
    return wheels


def build_component(
    repository_root: Path,
    output: Path,
    *,
    uv_executable: str | None = None,
    npm_executable: str | None = None,
    force: bool = False,
) -> Path:
    repository = repository_root.resolve()
    destination = _safe_output(output, repository)
    if destination.exists() and not force:
        raise RuntimeError(f"组件输出目录已存在；使用 --force 重建：{destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(
        tempfile.mkdtemp(prefix=".computer-use-component-", dir=destination.parent)
    ).resolve()
    try:
        metadata = load_component_metadata(repository)
        wheels = _build_python_wheels(
            repository,
            staging,
            _tool(uv_executable, "uv"),
            metadata,
        )
        _build_javascript_runtime(
            repository,
            staging,
            _tool(npm_executable, "npm.cmd", "npm"),
        )
        manifest = build_manifest(metadata, wheels)
        (staging / "manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        verify_component(staging)
        if destination.exists():
            shutil.rmtree(destination)
        shutil.move(str(staging), str(destination))
        return destination
    finally:
        if staging.exists():
            shutil.rmtree(staging)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    repository = Path(__file__).resolve().parents[1]
    parser.add_argument("--repository", type=Path, default=repository)
    parser.add_argument(
        "--output",
        type=Path,
        default=repository / "dist" / "computer-use-component",
    )
    parser.add_argument("--uv", help="uv executable")
    parser.add_argument("--npm", help="npm executable")
    parser.add_argument("--force", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        output = build_component(
            args.repository,
            args.output,
            uv_executable=args.uv,
            npm_executable=args.npm,
            force=args.force,
        )
    except (ComponentValidationError, OSError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f"组件构建失败：{error}", file=sys.stderr)
        return 1
    print(f"Computer-Use Component: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
