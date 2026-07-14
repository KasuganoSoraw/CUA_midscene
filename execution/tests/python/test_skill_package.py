from __future__ import annotations

from pathlib import Path


EXECUTION_ROOT = Path(__file__).resolve().parents[2]
REPOSITORY_ROOT = EXECUTION_ROOT.parent


def test_execution_is_self_contained_skill_root() -> None:
    skill = (EXECUTION_ROOT / "SKILL.md").read_text(encoding="utf-8")
    assert (EXECUTION_ROOT / "agents" / "openai.yaml").is_file()
    assert (EXECUTION_ROOT / "references" / "task-contract.md").is_file()
    assert "该目录是完整交付单元，不依赖外层 CUA 仓库" in skill
    assert "uv run cua act run" in skill


def test_installer_packages_execution_tracked_files() -> None:
    installer = (REPOSITORY_ROOT / "scripts" / "install-cua-midscene-skill.ps1").read_text(encoding="utf-8")
    assert "Join-Path $repositoryRoot 'execution'" in installer
    assert "git -C $repositoryRoot ls-files -- execution" in installer
    assert "skills\\cua-midscene" not in installer
