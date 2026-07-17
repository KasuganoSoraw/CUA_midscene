from __future__ import annotations

import os
from pathlib import Path

from dotenv import dotenv_values

from cua.domain.types import DataPaths, RuntimeLayout, TaskCatalogRoots

EXECUTION_ROOT = Path(__file__).resolve().parents[2]
BUILTIN_PROJECTS_ROOT = EXECUTION_ROOT / "projects"
DATA_ROOT_ENV = "CUA_DATA_ROOT"


def configured_data_root(explicit: Path | None = None) -> tuple[Path | None, str | None]:
    if explicit is not None:
        return explicit, "--data-root"

    process_value = os.environ.get(DATA_ROOT_ENV, "").strip()
    if process_value:
        return Path(process_value), DATA_ROOT_ENV

    for filename in (".env.local", ".env"):
        path = EXECUTION_ROOT / filename
        if not path.is_file():
            continue
        value = str(dotenv_values(path).get(DATA_ROOT_ENV) or "").strip()
        if value:
            return Path(value), str(path)
    return None, None


def normalize_data_root(path: Path, source: str) -> Path:
    expanded = path.expanduser()
    if not expanded.is_absolute():
        raise ValueError(f"{source} 必须配置绝对路径：{path}")
    root = expanded.resolve()
    if root == EXECUTION_ROOT or root.is_relative_to(EXECUTION_ROOT):
        raise ValueError(f"{source} 不得位于 Skill 根目录内：{root}")
    return root


def data_paths(root: Path) -> DataPaths:
    return DataPaths(
        root=root,
        projects_root=root / "projects",
        runs_root=root / "runs",
        cache_root=root / "cache",
    )


def resolve_runtime_layout(explicit: Path | None = None) -> RuntimeLayout:
    configured, source = configured_data_root(explicit)
    data = data_paths(normalize_data_root(configured, source or DATA_ROOT_ENV)) if configured else None
    return RuntimeLayout(
        catalog=TaskCatalogRoots(
            builtin_projects_root=BUILTIN_PROJECTS_ROOT.resolve(),
            user_projects_root=data.projects_root if data else None,
        ),
        data=data,
    )


def require_data_paths(layout: RuntimeLayout) -> DataPaths:
    if layout.data is None:
        raise ValueError("该命令需要可写数据目录，请提供 --data-root 或配置 CUA_DATA_ROOT")
    paths = layout.data
    try:
        for path in (paths.root, paths.projects_root, paths.runs_root, paths.cache_root):
            path.mkdir(parents=True, exist_ok=True)
    except OSError as error:
        raise ValueError(f"无法创建 CUA 数据目录：{paths.root}\n{error}") from error
    for path in (paths.root, paths.projects_root, paths.runs_root, paths.cache_root):
        if not os.access(path, os.W_OK):
            raise ValueError(f"CUA 数据目录不可写：{path}")
    return paths
