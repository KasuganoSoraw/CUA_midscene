## Why

`cua_execute` 的过程事件需要携带具体动作目标和执行状态，使 Host 与 Review 能清晰展示桌面任务进度。Runtime Bridge 将 Midscene 的累计执行状态转换为稳定的调用级事件。

## What Changes

- 从 Midscene 的 Dump 更新提取动作名称、可读描述、稳定任务身份及状态，去重后生成 `execution.progress`。
- Runtime Bridge 支持同一请求的过程事件帧和一个终态响应帧；Python Runtime client 关联请求并逐帧转发。
- Python Agent 将过程事件关联到当前 Tool call，复用现有 invocation JSONL 与 Review 开发流。
- replay、guided、freeform 三种执行策略使用相同的过程事件契约；Review 开发页按任务身份更新状态。不透传截图、原始 Dump 或完整模型消息。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `cua-runtime-bridge`：执行请求在终态响应前可发出关联、受控的过程事件。
- `python-cua-agent`：Agent 在 Tool 执行期间将 Midscene 过程映射为 Host-neutral 事件。

## Impact

影响 `execution/executors/`、任务执行编排、`runtime-bridge/`、`agent/src/cua_agent/runtime_client.py`、私有 Tool 与 runner、Review 开发页、对应测试和集成文档。不改变 Midscene 重试策略、Host 专有消息格式或跨调用 Session。
