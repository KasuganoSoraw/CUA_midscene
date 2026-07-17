from __future__ import annotations

from pathlib import Path

from cua.conversion.showui_trace import task_skill_content


EXECUTION_ROOT = Path(__file__).resolve().parents[2]
REPOSITORY_ROOT = EXECUTION_ROOT.parent


def test_execution_is_self_contained_skill_root() -> None:
    skill = (EXECUTION_ROOT / "SKILL.md").read_text(encoding="utf-8")
    assert (EXECUTION_ROOT / "agents" / "openai.yaml").is_file()
    assert (EXECUTION_ROOT / "references" / "task-contract.md").is_file()
    assert "该目录是完整交付单元，不依赖外层 CUA 仓库" in skill
    assert "uv run cua act run" in skill
    assert "uv run cua task run" in skill
    assert "task.yaml" in skill
    assert "flow run" not in skill
    assert "act run --scene" in skill
    assert "不得自动切换" in skill
    assert "校准时的只读录制证据" in skill
    assert "确认后只修改 `task.yaml`" in skill
    assert "校准不得修改 `source/`、`task.json` 或报告" in skill
    assert "不要把它描述为模拟执行" in skill


def test_generated_task_skill_delegates_generic_rules_to_root_skill() -> None:
    skill = task_skill_content("network-management", "alarm-query")

    assert "执行流程是 `task.yaml`" in skill
    assert "`source/` 是只读录制证据" in skill
    assert "遵循执行器根 `SKILL.md`" in skill
    assert "页面稳定时使用" not in skill


def test_installer_packages_execution_tracked_files() -> None:
    installer = (REPOSITORY_ROOT / "scripts" / "install-cua-midscene-skill.ps1").read_text(encoding="utf-8")
    assert "Join-Path $repositoryRoot 'execution'" in installer
    assert "git -C $repositoryRoot ls-files -- execution" in installer
    assert "skills\\cua-midscene" not in installer
