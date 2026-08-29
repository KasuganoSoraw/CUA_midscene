## ADDED Requirements

### Requirement: GDEClaw 只调用高层 CUA Subagent 入口
系统 SHALL 向 GDEClaw 暴露一个接收完整任务的 Python CUA Subagent invocation，并 SHALL 将 catalog、execute、workbench、策略选择和模型 Tool Calling 保持为 CUA 内部能力。

#### Scenario: Main Agent 委派 Computer-Use 任务
- **WHEN** GDEClaw Main Agent 提交一个完整自然语言任务
- **THEN** CUA Subagent SHALL 返回统一的结构化最终结果并可输出进度事件
- **AND** GDEClaw SHALL NOT 需要注册 `cua_catalog`、`cua_execute` 或 `cua_workbench`

### Requirement: 人工调试与 GDEClaw 复用 Python invocation
仅由 `review --dev` 启用的人工调试入口 SHALL 与未来 GDEClaw Adapter 调用同一个 Python invocation contract；普通 `review` SHALL NOT 展示 Agent 调试入口或注册 invocation API。

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
系统 SHALL 从 Python Agent 包加载稳定名称、宿主路由描述、领域 instructions 和 invocation mode，并 SHALL 在迁移完成后删除 TypeScript canonical Agent definition 与 Host 注入入口。

#### Scenario: 检查公开 Agent surface
- **WHEN** 开发者审计 Python 和 npm 发布面
- **THEN** canonical description 与 instructions SHALL 只由 Python Agent 包发布
- **AND** `cua-midscene/agent` 与 `invokeCuaSubagent(request, host)` SHALL 不再作为公开入口存在

## REMOVED Requirements

### Requirement: 系统提供宿主无关的 canonical CUA Agent definition
**Reason**: canonical definition 将由自托管的 Python CUA Agent 包提供，不再由 TypeScript Host-facing 子路径导出。
**Migration**: GDEClaw 与 Review 开发入口改为调用 Python Agent invocation，并从 Python 包读取 definition。

### Requirement: Agent instructions 定义任务级 Computer Use 路由
**Reason**: instructions 与任务路由迁入 Python Agent，TypeScript Runtime 不再承担 Agent-facing 定义。
**Migration**: 使用 `python-cua-agent` 中的 canonical instructions；底层执行语义继续由 Runtime bridge 保持。

### Requirement: Catalog Tool 暴露可诊断任务发现能力
**Reason**: Catalog Tool 从 Host 公共 Tool 变为 Python Agent 私有 Tool。
**Migration**: Python Agent 通过 `cua-runtime-bridge` 调用 catalog，GDEClaw 不再直接注册该 Tool。

### Requirement: Execute Tool 显式映射三种执行策略
**Reason**: Execute Tool 从 Host 公共 Tool 变为 Python Agent 私有 Tool。
**Migration**: Python Agent 继续使用 replay、guided、freeform 语义并通过 Runtime bridge 调用现有执行器。

### Requirement: Workbench Tool 提供 Host 可展示的深链接
**Reason**: Workbench Tool 从 Host 公共 Tool 变为 Python Agent 私有 Tool。
**Migration**: Python Agent 可通过 Runtime bridge 请求 workbench URL，并在最终结果或允许的事件中交给 Host。

### Requirement: Agent Capability 不承担 Host Runtime 与依赖生命周期
**Reason**: 新 Python Agent 需要承担自己的模型 loop 和调用级 Runtime 生命周期，但仍不承担持久 Host Session 或安装阶段依赖管理。
**Migration**: 模型 loop 与私有 Tool registry 迁入 Python Agent；GDEClaw 继续管理产品生命周期和依赖准备。

### Requirement: 完整 execution 包公开 Agent Capability
**Reason**: `execution` 不再是 Agent-facing 发布入口，只公开 Python Agent 所需的 Runtime bridge。
**Migration**: 安装 Python `cua-agent` 包并为其配置已构建的 TypeScript Runtime bridge。

### Requirement: 人工调试与 GDEClaw 复用统一 Subagent invocation
**Reason**: 原统一 invocation 依赖外部 Host 注入模型循环，无法让 CUA 自己完成领域 Tool Calling。
**Migration**: Review Server 与 GDEClaw Adapter 改为复用 Python Agent 的高层 invocation contract。
