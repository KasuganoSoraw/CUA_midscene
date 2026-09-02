"""`cua_record` 的只读包内资源。"""

from __future__ import annotations

from pathlib import Path


def default_prompt_path() -> Path:
    return Path(__file__).with_name("default_prompt.json")


__all__ = ["default_prompt_path"]
