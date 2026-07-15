---
name: air-tickets-demo
description: 使用 Midscene YAML 在 Qatar Airways 页面设置出发地、目的地和单程航班搜索。
---

# Qatar Airways 航班搜索任务

本任务的长期执行流程是同目录下的 `task.yaml`，输入 ID 和录制默认值以 `task.json` 为准。YAML 中每个 `step-NNN | <operation-type>` task 对应原 trace 的同编号步骤。

## 调用

1. 运行 `uv run cua task describe --scene browser-demo --task air-tickets-demo --json` 读取输入定义。
2. 用户只修改本次搜索条件时，通过 `--input key=value` 传入明确变化的值；未传入项保持录制默认值。
3. 执行前使用 `uv run cua task inspect --scene browser-demo --task air-tickets-demo` 检查 resolved YAML。
4. 用户明确要求实际操作电脑时，运行 `uv run cua task run --scene browser-demo --task air-tickets-demo`。
5. 执行失败后报告原始错误，不修改任务、不切换到自然语言模式，也不自动重试。

## 长期修改

用户指出某个动作以后都应修改时，使用稳定的 `step-NNN | <operation-type>` 名称定位该步，先展示 `task.yaml` 原值、新值和中文原因，等待明确确认。确认后编辑 `task.yaml`，再运行 `uv run cua task validate --scene browser-demo --task air-tickets-demo`。不得重编号、复用或打乱步骤，也不得启用 `continueOnError`。

同一输入需要影响后续候选项或按钮 prompt 时，在用户确认后显式复用相同 `{{input-id}}`。不得根据当前录制值做机械全文替换。
