---
name: air-tickets-demo
description: 使用 Midscene YAML 在 Qatar Airways 页面设置出发地、目的地和单程航班搜索。
---

# Qatar Airways 航班搜索任务

本任务的长期执行流程是同目录下的 `task.yaml`，输入 ID 和录制默认值以 `task.json` 为准，`source/` 只作为录制证据读取。调用、校准和执行模式遵循执行器根 `SKILL.md`。

本文件供 CLI 使用者和任务维护者阅读；Python CUA Agent 不把它加入模型上下文，而是通过 `cua_catalog` 的 `describe-task` 获取 `task.json` 元数据、origin、writable、步骤数与动作数。

这是随 Skill 发布的只读 builtin 示例，CLI 将返回 `origin=builtin`、`writable=false`。需要长期修改时，应在外部 user catalog 中创建不同 task 标识的数据包，不得编辑本目录。

## 调用

1. 运行 `node dist/cli/main.js task describe --scene browser-demo --task air-tickets-demo --json` 读取输入定义。
2. 用户只修改本次搜索条件时，通过可重复的 `--input "<input-id>=<value>"` 传入明确变化的值；未传入项保持录制默认值。
3. 使用 `node dist/cli/main.js task inspect --scene browser-demo --task air-tickets-demo [--input "<input-id>=<value>"] --json` 检查 resolved YAML。
4. 使用同一组 `--input` 运行 `task validate`，确认后再将同一组输入传给 `task run`；用户明确要求整体规划时才改用 `act run --scene browser-demo --task air-tickets-demo`。

## 长期修改限制

本内置任务不可校准。可先参考其契约创建新的 user task，再按执行器根 Skill 展示差异并等待确认；确认后只编辑 user task 的 `task.yaml`，不得修改 `source/`。

同一输入需要影响后续候选项或按钮 prompt 时，在用户确认后显式复用相同 `{{input-id}}`。不得根据当前录制值做机械全文替换。
