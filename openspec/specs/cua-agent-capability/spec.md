# cua-agent-capability Specification

## Purpose

定义 Python Computer-Use Subagent 的高层调用边界、任务级路由、私有 Tool 能力，以及人工调试入口与 Host Adapter 的统一 invocation contract。

## Requirements

### Requirement: GDEClaw 只调用高层 CUA Subagent 入口
系统 SHALL 向 GDEClaw 暴露一个接收完整任务的 Python CUA Subagent invocation，并 SHALL 将 catalog、execute、workbench、策略选择和模型 Tool Calling 保持为 CUA 内部能力。

#### Scenario: Main Agent 委派 Computer-Use 任务
- **WHEN** GDEClaw Main Agent 提交一个完整自然语言任务
- **THEN** CUA Subagent SHALL 返回统一的结构化最终结果并可输出进度事件
- **AND** GDEClaw SHALL NOT 需要注册 `cua_catalog`、`cua_execute` 或 `cua_workbench`

### Requirement: 人工调试与 GDEClaw 复用 Python invocation
仅由 `review --dev` 启用的人工调试入口 SHALL 与 GDEClaw Host Adapter 调用同一个 Python invocation contract；普通 `review` SHALL NOT 展示 Agent 调试入口或注册 invocation API。

#### Scenario: 开发者提交自然语言任务
- **WHEN** 开发者在 `review --dev` 的 Agent 页签提交非空任务
- **THEN** Review Server SHALL 把 `{task}` 交给 Python CUA Agent
- **AND** 页面 SHALL 展示最终回复、状态和允许公开的进度/Tool 事件
- **AND** 页面 SHALL NOT 自己选择执行策略或直接调用 Runtime Tool

#### Scenario: 普通用户启动 Workbench
- **WHEN** 用户执行 `review` 且未提供 `--dev`
- **THEN** Workbench SHALL NOT 展示 Agent 调试页签
- **AND** Review Server SHALL NOT 注册 Agent invocation endpoint

### Requirement: Python Agent definition 成为唯一 canonical 定义
系统 SHALL 从 Python Agent 包加载稳定名称、宿主路由描述、领域 instructions 和 invocation mode；TypeScript execution 包 SHALL NOT 提供 canonical Agent definition 或 Host 注入入口。

#### Scenario: 检查公开 Agent surface
- **WHEN** 开发者审计 Python 和 npm 发布面
- **THEN** canonical description 与 instructions SHALL 只由 Python Agent 包发布
- **AND** `cua-midscene/agent` 与 `invokeCuaSubagent(request, host)` SHALL NOT 作为公开入口存在
