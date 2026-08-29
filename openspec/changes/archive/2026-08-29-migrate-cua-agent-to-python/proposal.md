## Why

当前 `execution/agent` 只提供由外部 Host 注入的 TypeScript definition、Tool 与 invocation seam，无法作为 GDEClaw 可直接委派任务的专门 Subagent。为便于未来由 GDEClaw 统一安装、启动和管理，同时让 CUA 自己负责领域判断与私有 Tool Calling，需要把 Agent 层迁移为独立的 Python 包，并保持现有 TypeScript Computer-Use Runtime 专注于实际执行。

## What Changes

- 新增顶层 `agent/` Python 包，内置 canonical description/instructions、一次调用内的薄模型 Tool Calling loop、私有 Tool registry、结构化事件与取消边界。
- Agent 每次只接收一个完整任务，不保存跨调用 Session、长期记忆、调度状态或多 Agent 状态；单次调用内允许维护模型 messages 与 Tool 结果。
- 新增稳定、JSON 友好的 TypeScript Runtime bridge，向 Python Agent 提供 catalog、execute 和 workbench 能力，而不把 Agent 逻辑放入 `execution`。
- `review --dev` 改为调用同一个 Python Agent 入口；普通 `review` 继续隐藏 Agent 调试能力。
- 明确 GDEClaw 只集成一个高层 CUA Subagent 入口，内部 Tool、策略选择及 Midscene 调用保持封装。
- **BREAKING**：完成等价能力和调试链验证后，删除 `cua-midscene/agent` TypeScript 子路径、外部 Host 注入式 `invokeCuaSubagent` 和对应 TS Agent definition，避免两套 canonical Agent 并存。
- 运行阶段禁止隐式安装、lock 或 sync；Python 与 Node 依赖由 GDEClaw 的安装/部署阶段统一准备。

## Capabilities

### New Capabilities

- `python-cua-agent`: 独立 Python CUA Subagent 的包边界、无状态调用、模型 Tool Calling、私有 Tool、事件、取消与依赖声明。
- `cua-runtime-bridge`: Python Agent 调用 TypeScript Computer-Use Runtime 的 JSON/JSONL 契约、生命周期、错误与事件传播。

### Modified Capabilities

- `cua-agent-capability`: 将 Host 管理的 TypeScript Agent Capability 改为 Python 自托管专门 Subagent，并调整统一 invocation、公开入口和开发调试要求。

## Impact

- 新增顶层 `agent/` Python 工程、`pyproject.toml`、锁文件、源码和测试。
- `execution/` 新增 Runtime bridge/worker 入口及契约测试，但继续拥有 catalog、replay、guided、freeform、workbench 和 Midscene 实现。
- `execution/review` 的开发模式 Agent API 和页面状态改为连接 Python Agent，不再等待外部 Agent Host。
- `execution/package.json`、TypeScript exports、构建输入、README 和集成文档需要更新。
- GDEClaw 后续需要安装 Python Agent 并准备隔离的 Node Runtime；运行期只启动和调用已经准备好的组件。
