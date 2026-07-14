---
name: air-tickets-demo
description: 使用 Midscene 在 Qatar Airways 页面设置出发地、目的地和单程航班搜索。
---

# Qatar Airways 航班搜索任务

本任务的长期执行流程是同目录下的 `midscene-flow.json`，输入定义以 `task.json` 为准。

## 调用

1. 先运行 `uv run cua task describe --scene browser-demo --task air-tickets-demo --json` 读取输入定义。
2. 用户仅修改本次搜索条件时，通过 `--input key=value` 传入明确变化的值；未传入项保持 flow 当前值。
3. 执行前可用 `uv run cua flow inspect --scene browser-demo --task air-tickets-demo` 检查 resolved flow。
4. 页面稳定时使用 `uv run cua flow run --scene browser-demo --task air-tickets-demo` 逐步执行；用户明确要求统一规划完整步骤时，使用 `uv run cua act run --scene browser-demo --task air-tickets-demo`。
5. 任一模式失败后报告原始错误，不自动切换另一模式。

## 长期修改

当用户指出某个步骤以后都应修改时，先展示 step ID、原值、新值和中文原因，等待明确确认。确认后直接编辑 `midscene-flow.json`，再运行 `uv run cua flow validate --scene browser-demo --task air-tickets-demo`。

不得创建 overrides 或 calibration 文件，不得在失败后自动改写流程并重试。
