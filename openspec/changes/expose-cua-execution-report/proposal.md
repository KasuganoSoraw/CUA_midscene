## Why

`cua_execute` 当前没有向调用方暴露 Midscene 生成的 HTML 报告，模型也缺少对工具调用过程和可用产物的明确回复约束。调用方因此难以获得可直接检查的执行证据，并且工具执行过程容易退化为缺少上下文的状态文本。

## What Changes

- 为 replay、guided 和 freeform 执行配置稳定的 Midscene 报告文件名，并在 Agent 销毁完成后校验实际 HTML 文件。
- 在执行结果与 `cua_execute` 返回值中提供可选 `reportPath`；dry-run 或报告未生成时不返回该字段，也不改变原执行状态。
- 扩充 canonical instructions，要求模型在有帮助时简短说明即将执行的动作、已确认的结果与下一步，但不输出隐藏推理或机械复述每次工具调用。
- 要求模型在最终回复中提供 Workbench URL，以及成功执行后可用的 Midscene HTML 报告路径。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `python-cua-agent`: 约束调用内可见说明以及 Workbench URL、执行报告路径的最终回复行为。
- `cua-runtime-bridge`: 让 `cua_execute` 保留并返回经文件存在性校验的 Midscene HTML 报告路径。

## Impact

- Python Agent canonical instructions 及其定义测试。
- TypeScript Midscene YAML/aiAct 执行器、持久化结果契约和 JSON Schema。
- Runtime bridge 的 `cua_execute` 返回契约及三种策略测试。
- 不引入新依赖，不增加公共 Tool，也不要求 GDEClaw 前端或内部事件协议变更。
