from __future__ import annotations

from pathlib import Path

import pytest

from cua.task import data_paths as module


def test_data_root_precedence_and_derived_directories(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    execution_root = tmp_path / "skill"
    execution_root.mkdir()
    from_env_file = tmp_path / "from-env-file"
    from_local = tmp_path / "from-local"
    from_process = tmp_path / "from-process"
    explicit = tmp_path / "explicit"
    (execution_root / ".env").write_text(f"CUA_DATA_ROOT={from_env_file}\n", encoding="utf-8")
    (execution_root / ".env.local").write_text(f"CUA_DATA_ROOT={from_local}\n", encoding="utf-8")
    monkeypatch.setattr(module, "EXECUTION_ROOT", execution_root)
    monkeypatch.setattr(module, "BUILTIN_PROJECTS_ROOT", execution_root / "projects")
    monkeypatch.delenv("CUA_DATA_ROOT", raising=False)

    assert module.resolve_runtime_layout().data.root == from_local.resolve()  # type: ignore[union-attr]
    monkeypatch.setenv("CUA_DATA_ROOT", str(from_process))
    assert module.resolve_runtime_layout().data.root == from_process.resolve()  # type: ignore[union-attr]
    layout = module.resolve_runtime_layout(explicit)
    assert layout.data is not None
    assert layout.data.root == explicit.resolve()
    assert layout.data.projects_root == explicit.resolve() / "projects"
    assert layout.data.runs_root == explicit.resolve() / "runs"
    assert layout.data.cache_root == explicit.resolve() / "cache"


def test_data_root_rejects_missing_relative_and_skill_internal_paths(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    execution_root = tmp_path / "skill"
    execution_root.mkdir()
    monkeypatch.setattr(module, "EXECUTION_ROOT", execution_root)
    monkeypatch.setattr(module, "BUILTIN_PROJECTS_ROOT", execution_root / "projects")
    monkeypatch.delenv("CUA_DATA_ROOT", raising=False)

    with pytest.raises(ValueError, match="CUA_DATA_ROOT|--data-root"):
        module.require_data_paths(module.resolve_runtime_layout())
    with pytest.raises(ValueError, match="绝对路径"):
        module.resolve_runtime_layout(Path("relative"))
    with pytest.raises(ValueError, match="Skill"):
        module.resolve_runtime_layout(execution_root / "data")


def test_data_root_fails_when_not_writable(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    root = tmp_path / "external"
    layout = module.resolve_runtime_layout(root)
    monkeypatch.setattr(module.os, "access", lambda path, mode: False)
    with pytest.raises(ValueError, match="不可写"):
        module.require_data_paths(layout)
