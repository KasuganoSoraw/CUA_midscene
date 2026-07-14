---
name: browser-demo
description: 发现和调用浏览器操作示例场景中的本地 CUA 任务。
---

# 浏览器操作示例场景

本场景用于验证浏览器中的 Midscene computer use 流程。

先运行 `uv run cua task list --scene browser-demo --json` 发现任务。只有在用户选择或意图明确匹配某个任务后，才读取对应任务目录中的 `SKILL.md` 和 `task.json`。

当前任务：

- `air-tickets-demo`：在 Qatar Airways 页面设置单程航班搜索条件。
