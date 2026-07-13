from __future__ import annotations

import re


INPUT_LOCATE_PATTERN = re.compile(r"^在\s*(.+?)\s*中(?:继续)?(?:输入|键入|录入)\s*\{\{value\}\}")


def derive_input_locate_prompt(input_prompt: str) -> str:
    normalized_prompt = input_prompt.strip()
    match = INPUT_LOCATE_PATTERN.match(normalized_prompt)
    if match is None or not match.group(1).strip():
        raise ValueError(f"无法从 input prompt 推导 locatePrompt：{input_prompt}")
    return match.group(1).strip()
