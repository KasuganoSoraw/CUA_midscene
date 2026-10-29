"""`cua_record` 的只读包内资源。"""

from __future__ import annotations

__all__ = ["default_prompt_path"]

from pathlib import Path


def default_prompt_path(language: str = "zh-CN") -> Path:
    names = {"zh-CN": "default_prompt.json", "en-US": "default_prompt.en.json"}
    if language not in names:
        raise ValueError(f"不支持的生成语言：{language}")
    return Path(__file__).with_name(names[language])
