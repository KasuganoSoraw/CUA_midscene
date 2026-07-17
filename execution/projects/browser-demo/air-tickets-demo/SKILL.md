---
name: air-tickets-demo
description: 使用 Midscene YAML 在 Qatar Airways 页面设置出发地、目的地和单程航班搜索。
---

# Qatar Airways 航班搜索任务

本任务的长期执行流程是同目录下的 `task.yaml`，输入 ID 和录制默认值以 `task.json` 为准，`source/` 只作为录制证据读取。调用、校准和执行模式遵循执行器根 `SKILL.md`。

## 调用

1. 运行 `uv run cua task describe --scene browser-demo --task air-tickets-demo --json` 读取输入定义。
2. 用户只修改本次搜索条件时，通过 `--input key=value` 传入明确变化的值；未传入项保持录制默认值。
3. 使用 `uv run cua task inspect --scene browser-demo --task air-tickets-demo` 检查 resolved YAML，再按执行器根 Skill 选择执行模式。

## 长期修改

本任务没有额外校准规则。校准时按执行器根 Skill 展示差异并等待确认，确认后只编辑 `task.yaml`，不得修改 `source/`。

同一输入需要影响后续候选项或按钮 prompt 时，在用户确认后显式复用相同 `{{input-id}}`。不得根据当前录制值做机械全文替换。
