## Why

CUA Agent 的模型调用只在完整响应后返回，开发 Workbench 也只在 invocation 结束后展示累计事件。调用期间缺少可见文本增量和完整的 Tool 生命周期语义，Host 无法可靠映射到实时的助手消息与工具结果。

## What Changes

- 为 Python CUA Agent 增加与供应商无关的模型流和调用级 assistant 事件。
- 为 Tool 生命周期事件提供关联轮次、完整参数以及受控结果或错误。
- 解析 OpenAI-compatible 流式响应并在 Agent 内组装完整 Tool call；最终 JSON 回复保持结构化解析，不泄漏协议碎片。
- 让 `review --dev` 在 invocation 运行时消费并展示事件，同时保持最终结果契约。
- 保持 GDEClaw 专有消息格式、Session、持久化和前端协议在 Host Adapter 边界之外。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `python-cua-agent`：模型增量、assistant 与 Tool 事件的实时语义。
- `cua-agent-capability`：开发 Workbench 实时展示同一 invocation 的通用事件。

## Impact

影响 `agent/src/cua_agent/{model,openai_compatible,runner,events,cli}.py`、Agent 测试、`execution/review` 的 Python 子进程适配、开发 HTTP 入口与 Vue Agent 调试页。现有 Runtime bridge 和 GDEClaw 内部仓不在变更范围内。
