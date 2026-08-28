## Why

当前 `execution` 已提供任务发现、录制任务执行、自然语言 aiAct 和本地 Workbench，但缺少一个宿主无关的 Agent Capability 来定义何时使用这些能力以及向 Agent Host 暴露哪些稳定工具。需要新增薄 Agent 层，使同一套 Computer Use 领域能力既可由独立 Host 承载，也可在未来由 GDEClaw 作为内置 Subagent 承载，而不在 CUA 内复制 Agent Runtime。

## What Changes

- 在 `execution/agent/` 新增 canonical Computer-Use Agent definition，分别保存宿主路由描述、领域 instructions 和机器可读定义。
- 新增宿主无关的 `cua_catalog`、`cua_execute`、`cua_workbench` Tool contracts 与 TypeScript 适配实现。
- 让执行 Tool 显式选择 `replay`、`guided` 或 `freeform`，并分别复用现有任务执行、录制引导 aiAct 和自然语言 aiAct API，不提供失败后的隐式切换。
- 让 Workbench Tool 复用现有本地 Review Server，返回可由 Standalone 或未来 GDEClaw Host 打开的录制、复核或运行页面 URL。
- 增加公共导出、确定性测试和中文文档，固定 Agent、Workbench、CUA Core 与 Host 的职责边界。
- 在现有 Workbench 增加仅由 `review --dev` 启用的薄 Agent 调试页签，通过与未来 GDEClaw 相同的 Subagent invocation contract 提交单次无状态任务和展示回复/Tool 轨迹；普通用户默认不看到该入口。
- 删除已被 Agent Capability 取代的 `agent-runtime/` 精简发布物、打包脚本和专项测试；保持完整 CLI 行为不变。
- 保持现有开发依赖；不实现 GDEClaw Adapter、LLM loop、session、memory、依赖 provisioning 或 self-contained runtime。

## Capabilities

### New Capabilities

- `cua-agent-capability`: 定义可移植 Computer-Use Agent 的 canonical definition、Tool contracts、领域路由规则和对现有 CUA/Workbench 能力的薄适配行为。

### Modified Capabilities

- `agent-runtime-package`: 移除旧的独立精简包、专用 CLI/API、发布白名单和增量扩展契约，由完整包的 `cua-midscene/agent` 入口取代。

## Impact

- 新增 `execution/agent/` 源码、定义文档与测试。
- `review --dev` 增加可注入 Agent Host 的统一 invocation API 和薄调试前端；普通 `review` 不展示或注册该开发入口，开发模式未配置 Host 时明确报告不可用。
- `execution/tsconfig*.json` 和 `execution/package.json` 发布面需要包含新的 Agent Capability。
- 删除 `execution/agent-runtime/`、精简打包脚本、相关测试和文档入口，不再生成 `cua-agent-runtime` tgz。
- 可能为 `review/server` 补充一个不打开系统浏览器、可带目标页面参数的公共启动适配，但不改变现有 Review API 行为。
- 不增加生产依赖，不改变 Node/Python 依赖安装方式，也不引入任何 GDEClaw 专用代码。
