"""在源码仓外验证 Computer-Use Component 的 Python 与 Runtime bridge 入口。"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from collections.abc import Sequence
from pathlib import Path, PurePosixPath

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.component_manifest import (
    ComponentValidationError,
    verify_component,
)


def _component_path(root: Path, relative: str) -> Path:
    return root.joinpath(*PurePosixPath(relative).parts)


def _parse_environment(values: Sequence[str]) -> dict[str, str]:
    result: dict[str, str] = {}
    for value in values:
        name, separator, content = value.partition("=")
        if not separator or not name.strip():
            raise ValueError(f"环境参数必须使用 NAME=VALUE：{value}")
        result[name.strip()] = content
    return result


def _extract_wheels(wheels: Sequence[Path], destination: Path) -> None:
    destination.mkdir()
    root = destination.resolve()
    for wheel in wheels:
        with zipfile.ZipFile(wheel) as archive:
            for member in archive.infolist():
                target = (destination / member.filename).resolve()
                try:
                    target.relative_to(root)
                except ValueError as error:
                    raise RuntimeError(
                        f"wheel 成员路径越界：{wheel.name}：{member.filename}"
                    ) from error
            archive.extractall(destination)


def _run(command: Sequence[str], *, cwd: Path, env: dict[str, str]) -> subprocess.CompletedProcess[str]:
    process = subprocess.run(
        list(command),
        cwd=cwd,
        env=env,
        check=False,
        text=True,
        encoding="utf-8",
        capture_output=True,
    )
    if process.returncode != 0:
        detail = process.stderr.strip() or process.stdout.strip()
        raise RuntimeError(
            f"命令失败：{subprocess.list2cmdline(list(command))}；"
            f"exit={process.returncode}{f'；{detail}' if detail else ''}"
        )
    return process


def smoke_component(
    component_root: Path,
    *,
    python_executable: Path,
    javascript_executable: Path,
    javascript_environment: dict[str, str] | None = None,
    timeout_seconds: float = 30.0,
) -> None:
    manifest = verify_component(component_root)
    python_runtime = python_executable.resolve()
    javascript_runtime = javascript_executable.resolve()
    if not python_runtime.is_file():
        raise RuntimeError(f"Python executable 不存在：{python_runtime}")
    if not javascript_runtime.is_file():
        raise RuntimeError(f"JavaScript Runtime executable 不存在：{javascript_runtime}")
    with tempfile.TemporaryDirectory(prefix="cua-component-smoke-") as temporary:
        isolated = Path(temporary)
        component = isolated / "computer-use"
        shutil.copytree(component_root, component)
        manifest = verify_component(component)

        site_packages = isolated / "site-packages"
        wheels = [
            _component_path(component, str(package["wheel"]))
            for package in manifest["python"]["packages"]
        ]
        _extract_wheels(wheels, site_packages)
        python_environment = {
            **os.environ,
            "PYTHONUTF8": "1",
            "PYTHONIOENCODING": "utf-8",
            "PYTHONPATH": os.pathsep.join(
                value
                for value in (str(site_packages), os.environ.get("PYTHONPATH", ""))
                if value
            ),
        }
        _run(
            [
                str(python_runtime),
                "-c",
                "import cua_agent, cua_recorder, cua_record; print('python modules ready')",
            ],
            cwd=isolated,
            env=python_environment,
        )
        _run(
            [str(python_runtime), "-m", "cua_record", "doctor"],
            cwd=isolated,
            env=python_environment,
        )

        runtime = _component_path(component, str(manifest["javascript"]["root"]))
        bridge = _component_path(runtime, str(manifest["javascript"]["entry"]))
        runtime_environment = {
            **os.environ,
            **(javascript_environment or {}),
        }
        request = {
            "schemaVersion": manifest["protocol"]["runtimeBridge"],
            "requestId": "component-smoke",
            "method": "catalog",
            "payload": {"action": "list-scenes"},
        }
        process = subprocess.run(
            [str(javascript_runtime), str(bridge)],
            cwd=runtime,
            env=runtime_environment,
            input=json.dumps(request, ensure_ascii=False) + "\n",
            text=True,
            encoding="utf-8",
            capture_output=True,
            timeout=timeout_seconds,
            check=False,
        )
        if process.returncode != 0:
            raise RuntimeError(
                f"Runtime bridge smoke 失败：exit={process.returncode}\n{process.stderr.strip()}"
            )
        lines = [line for line in process.stdout.splitlines() if line.strip()]
        if len(lines) != 1:
            raise RuntimeError(f"Runtime bridge stdout 应包含一个 JSON frame：{process.stdout}")
        response = json.loads(lines[0])
        if response.get("requestId") != "component-smoke" or response.get("ok") is not True:
            raise RuntimeError(f"Runtime bridge 返回失败：{response}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("component", type=Path)
    parser.add_argument("--python", type=Path, default=Path(sys.executable))
    parser.add_argument("--javascript", type=Path, required=True)
    parser.add_argument("--javascript-env", action="append", default=[])
    parser.add_argument("--timeout-seconds", type=float, default=30.0)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        smoke_component(
            args.component,
            python_executable=args.python,
            javascript_executable=args.javascript,
            javascript_environment=_parse_environment(args.javascript_env),
            timeout_seconds=args.timeout_seconds,
        )
    except (
        ComponentValidationError,
        OSError,
        RuntimeError,
        ValueError,
        json.JSONDecodeError,
        subprocess.CalledProcessError,
        subprocess.TimeoutExpired,
    ) as error:
        print(f"组件 smoke test 失败：{error}", file=sys.stderr)
        return 1
    print("Computer-Use Component smoke test passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
