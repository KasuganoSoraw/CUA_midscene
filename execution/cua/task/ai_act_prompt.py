from __future__ import annotations

import json
from typing import Any

from cua.task.yaml_task import validate_yaml_document

PROMPT_HEADER = "请严格按以下步骤顺序完成电脑操作："
SUPPORTED_ACTIONS = {
    "ai",
    "aiTap",
    "aiWaitFor",
    "KeyboardPress",
    "KeyboardTypeText",
}


def quoted(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def required_string(value: object, field: str, context: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{context} 的 {field} 必须是非空字符串")
    return value.strip()


def render_keyboard_type_text(value: object, context: str) -> str:
    if not isinstance(value, dict):
        raise ValueError(f"{context} 的 KeyboardTypeText 必须是对象")
    locate = required_string(value.get("locate"), "locate", context)
    text = value.get("value")
    if not isinstance(text, str):
        raise ValueError(f"{context} 的 KeyboardTypeText.value 必须是字符串")
    mode = value.get("mode", "replace")
    if mode not in {"replace", "append", "typeOnly", "clear"}:
        raise ValueError(f"{context} 的 KeyboardTypeText.mode 不受支持：{mode}")
    if mode == "clear":
        return f"使用 KeyboardTypeText 清空 {quoted(locate)}"
    mode_text = {
        "replace": "替换输入",
        "append": "追加输入",
        "typeOnly": "直接输入",
    }[mode]
    return f"使用 KeyboardTypeText 在 {quoted(locate)} 中{mode_text} {quoted(text)}"


def render_action(action: dict[str, Any], context: str) -> str | None:
    if "sleep" in action:
        if len(action) != 1:
            raise ValueError(f"{context} 的 sleep 不能与其他字段组合")
        if not isinstance(action["sleep"], int) or isinstance(action["sleep"], bool):
            raise ValueError(f"{context} 的 sleep 必须是整数")
        return None

    action_names = SUPPORTED_ACTIONS.intersection(action)
    if len(action_names) != 1:
        found = ", ".join(sorted(action)) or "空动作"
        raise ValueError(f"{context} 必须且只能包含一个受支持动作，当前字段：{found}")
    action_name = next(iter(action_names))
    allowed_fields = {action_name, "timeout"} if action_name == "aiWaitFor" else {action_name}
    unexpected_fields = sorted(set(action) - allowed_fields)
    if unexpected_fields:
        raise ValueError(f"{context} 包含无法解释的字段：{', '.join(unexpected_fields)}")

    value = action[action_name]
    if action_name in {"ai", "aiTap", "aiWaitFor"}:
        return required_string(value, action_name, context)
    if action_name == "KeyboardTypeText":
        return render_keyboard_type_text(value, context)
    if not isinstance(value, dict):
        raise ValueError(f"{context} 的 KeyboardPress 必须是对象")
    key_name = required_string(value.get("keyName"), "KeyboardPress.keyName", context)
    return f"按下 {quoted(key_name)} 键"


def build_recorded_task_ai_act_prompt(document: dict[str, Any]) -> str:
    validate_yaml_document(document, "recorded task aiAct prompt")
    lines = [PROMPT_HEADER]
    for task_index, task in enumerate(document["tasks"], start=1):
        task_name = task["name"].strip()
        instructions: list[str] = []
        for action_index, action in enumerate(task["flow"], start=1):
            instruction = render_action(action, f'{task_name} 的 flow[{action_index}]')
            if instruction is not None:
                instructions.append(instruction)
        if not instructions:
            raise ValueError(f"{task_name} 没有可用于整体 aiAct 的执行动作")
        lines.append(f"{task_name}:")
        lines.extend(f"  {index}. {instruction}" for index, instruction in enumerate(instructions, start=1))
    return "\n".join(lines) + "\n"
