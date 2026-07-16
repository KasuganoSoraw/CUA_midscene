from __future__ import annotations

import pytest

from cua.task.ai_act_prompt import PROMPT_HEADER, build_recorded_task_ai_act_prompt


def recorded_document() -> dict[str, object]:
    return {
        "computer": {},
        "tasks": [
            {
                "name": "step-001 | click",
                "flow": [
                    {"sleep": 500},
                    {"aiTap": "点击 Chrome 顶部地址栏"},
                ],
            },
            {
                "name": "step-002 | input",
                "flow": [
                    {
                        "KeyboardTypeText": {
                            "locate": "Chrome 顶部地址栏",
                            "value": "GUI agent",
                            "mode": "replace",
                        }
                    }
                ],
            },
            {
                "name": "step-003 | keyboard",
                "flow": [{"KeyboardPress": {"keyName": "Enter"}}],
            },
            {
                "name": "step-004 | wait",
                "flow": [{"aiWaitFor": "等待搜索结果页出现", "timeout": 15_000}],
            },
            {
                "name": "step-005 | click",
                "flow": [
                    {"ai": "确认页面已加载并点击第一条结果"},
                    {"aiTap": "点击结果页顶部的确认按钮"},
                ],
            },
            {
                "name": "step-006 | doubleClick",
                "flow": [
                    {"aiDoubleClick": "页面中部文件列表里的 report.xlsx 文件行"}
                ],
            },
        ],
    }


def test_build_prompt_preserves_steps_and_renders_supported_actions() -> None:
    prompt = build_recorded_task_ai_act_prompt(recorded_document())

    assert prompt.startswith(PROMPT_HEADER)
    assert prompt.index("step-001 | click") < prompt.index("step-002 | input")
    assert "点击 Chrome 顶部地址栏" in prompt
    assert (
        '使用 KeyboardTypeText 在 "Chrome 顶部地址栏" 中替换输入 "GUI agent"'
        in prompt
    )
    assert '按下 "Enter" 键' in prompt
    assert "等待搜索结果页出现" in prompt
    assert "确认页面已加载并点击第一条结果" in prompt
    assert "点击结果页顶部的确认按钮" in prompt
    assert (
        '双击以下描述对应的目标："页面中部文件列表里的 report.xlsx 文件行"'
        in prompt
    )
    assert "500" not in prompt
    assert "timeout" not in prompt


@pytest.mark.parametrize(
    ("action", "message"),
    [
        ({"aiHover": "悬停目标"}, "必须且只能包含一个受支持动作"),
        ({"aiTap": "点击目标", "KeyboardPress": {"keyName": "Enter"}}, "必须且只能包含一个"),
        ({"KeyboardTypeText": {"value": "text"}}, "locate 必须是非空字符串"),
        ({"KeyboardPress": {}}, "KeyboardPress.keyName 必须是非空字符串"),
        ({"sleep": 100, "aiTap": "点击目标"}, "sleep 不能与其他字段组合"),
    ],
)
def test_build_prompt_rejects_unknown_or_ambiguous_actions(
    action: dict[str, object], message: str
) -> None:
    document = {
        "tasks": [
            {
                "name": "step-001 | click",
                "flow": [action],
            }
        ]
    }
    with pytest.raises(ValueError, match=message):
        build_recorded_task_ai_act_prompt(document)


def test_build_prompt_rejects_sleep_only_step() -> None:
    document = {
        "tasks": [
            {
                "name": "step-001 | wait",
                "flow": [{"sleep": 500}],
            }
        ]
    }
    with pytest.raises(ValueError, match="没有可用于整体 aiAct 的执行动作"):
        build_recorded_task_ai_act_prompt(document)
