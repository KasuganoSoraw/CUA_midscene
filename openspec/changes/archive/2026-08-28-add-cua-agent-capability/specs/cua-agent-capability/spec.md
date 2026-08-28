## ADDED Requirements

### Requirement: 系统提供宿主无关的 canonical CUA Agent definition
系统 SHALL 提供 Computer-Use Agent 的稳定名称、宿主路由描述、领域 instructions 和 Tool 名称集合，并 SHALL 允许不同 Agent Host 读取同一份 definition，而无需复制提示词。

#### Scenario: Host 加载 Agent definition
- **WHEN** Standalone Host 或集成 Adapter 导入 CUA Agent Capability
- **THEN** 系统 SHALL 返回 `stateless-task` invocation mode、非空 description、非空 instructions 和 `cua_catalog`、`cua_execute`、`cua_workbench` Tool 名称
- **AND** 导入过程 SHALL NOT 启动 LLM loop、创建 session 或操作电脑

### Requirement: Agent instructions 定义任务级 Computer Use 路由
canonical instructions SHALL 要求 Agent 先判断用户意图，并在 Recorded Skill 发现、Replay、Guided、Freeform 与 Workbench 之间进行任务级选择，同时 SHALL 将截图级 GUI 规划交给 Midscene。

#### Scenario: 没有匹配的 Recorded Skill
- **WHEN** 用户明确要求操作电脑且 catalog 没有合适任务
- **THEN** instructions SHALL 允许 Agent 显式选择 Freeform 执行
- **AND** instructions SHALL NOT 要求 Agent 自己生成逐点击坐标或重复 Midscene 的视觉规划

#### Scenario: 执行失败
- **WHEN** 任一执行策略返回失败或抛出错误
- **THEN** instructions SHALL 要求 Agent报告原始失败并等待用户决定
- **AND** Agent SHALL NOT 自动重试、切换策略或修改 canonical 任务

### Requirement: Catalog Tool 暴露可诊断任务发现能力
`cua_catalog` SHALL 支持列出场景、列出指定场景任务和描述指定任务，并 SHALL 原样保留 catalog 中的 ready/error item 与诊断信息。

#### Scenario: 场景包含健康与错误任务
- **WHEN** Agent 使用 `cua_catalog` 列出该场景的任务
- **THEN** Tool SHALL 返回全部 catalog item，包括健康任务和单任务 error item
- **AND** Tool SHALL NOT 因一个错误任务隐藏其他健康任务

#### Scenario: 描述明确任务
- **WHEN** Agent 提供 scene/task 调用 describe action
- **THEN** Tool SHALL 返回任务目标、输入定义、来源、可写性和执行统计

### Requirement: Execute Tool 显式映射三种执行策略
`cua_execute` SHALL 接受显式 `replay`、`guided` 或 `freeform` strategy，并 SHALL 分别调用现有逐任务执行、录制任务整体 aiAct 或自然语言 aiAct API。

#### Scenario: Replay 已录制任务
- **WHEN** Agent 提供 `replay`、scene/task 和可选本次 inputs
- **THEN** Tool SHALL 解析统一运行布局并调用 `runTask`
- **AND** 本次 inputs SHALL NOT 写回 canonical 任务

#### Scenario: Guided 已录制任务
- **WHEN** Agent 提供 `guided`、scene/task 和可选本次 inputs
- **THEN** Tool SHALL 调用 `runRecordedTaskAiAct`

#### Scenario: Freeform 自然语言任务
- **WHEN** Agent 提供 `freeform` 和非空 goal
- **THEN** Tool SHALL 调用 `runNaturalLanguageAiAct`
- **AND** Tool SHALL NOT 搜索任务或先生成逐点击计划

#### Scenario: 执行器失败
- **WHEN** 底层 CUA API 返回失败或抛出错误
- **THEN** Tool SHALL 原样返回结构化失败结果或保留根因抛出
- **AND** Tool SHALL NOT 自动改用其他 strategy、修改任务或重试

### Requirement: Workbench Tool 提供 Host 可展示的深链接
`cua_workbench` SHALL 启动或复用现有本地 Review Server，并返回包含目标 mode 和可选 scene/task 的 URL，而 SHALL NOT 在 Tool 内复制录制、复核或执行业务逻辑。

#### Scenario: 打开任务复核
- **WHEN** Agent 请求 `review` mode 并提供 scene/task
- **THEN** Tool SHALL 返回指向现有 Workbench 的 URL，查询参数 SHALL 包含 mode、scene 和 task
- **AND** Workbench SHALL 初始化为对应复核目标

#### Scenario: 打开录制工作区
- **WHEN** Agent 请求 `recording` mode
- **THEN** Workbench SHALL 初始化为录制页签

#### Scenario: Host 决定展示方式
- **WHEN** Tool 成功启动或复用 Workbench
- **THEN** Tool SHALL 返回 URL 和 reused 状态
- **AND** Tool SHALL NOT 强制打开系统浏览器

### Requirement: Agent Capability 不承担 Host Runtime 与依赖生命周期
Agent Capability SHALL NOT 实现 LLM loop、session、memory、scheduler、GDEClaw 专用注册或运行时依赖安装，并 SHALL 假设调用前运行环境已经准备完成。

#### Scenario: 导入或调用 Agent Tool
- **WHEN** Host 导入 definition 或调用任一 Tool
- **THEN** 系统 SHALL NOT 执行 `npm install`、`npm ci`、`uv sync`、`uv lock` 或 `pip install`
- **AND** 缺少运行依赖时 SHALL 保留可诊断失败，而不是现场准备环境

### Requirement: 完整 execution 包公开 Agent Capability
完整 `cua-midscene` 包 SHALL 通过稳定子路径导出 Agent definition、contracts 和 Tool functions，并 SHALL 成为仓库内唯一 Agent-facing 发布入口。

#### Scenario: Node Host 导入 Agent Capability
- **WHEN** Node Host 从 `cua-midscene/agent` 导入
- **THEN** Host SHALL 获得 canonical definition 和三个 Tool 函数
- **AND** 导入 SHALL NOT要求 GDEClaw、Python recorder 或浏览器页面正在运行

#### Scenario: 发布面不再生成旧精简包
- **WHEN** 开发者检查 npm scripts、构建输入和发布文档
- **THEN** 系统 SHALL NOT 提供 `cua-agent-runtime` 专用源码、打包命令或发布测试
- **AND** Freeform 执行能力 SHALL 继续由完整 CUA Core 和 `cua_execute` 提供

### Requirement: 人工调试与 GDEClaw 复用统一 Subagent invocation
系统 SHALL 提供宿主无关、无跨调用上下文的单任务 invocation request/result 和调用函数，并 SHALL 让仅由 `review --dev` 启用的人工调试入口与未来 GDEClaw Adapter 使用同一 canonical definition 和 Tool 集合。普通 `review` SHALL NOT 展示 Agent 调试入口或注册其 invocation API。

#### Scenario: 普通用户启动 Workbench
- **WHEN** 用户执行 `review` 且未提供 `--dev`
- **THEN** Workbench SHALL NOT 展示 Agent 调试页签
- **AND** Review Server SHALL NOT 注册 Agent status 或 invocation endpoint

#### Scenario: 开发者启用 Agent 调试入口
- **WHEN** 开发者执行 `review --dev`
- **THEN** 启动结果 SHALL 打开带开发模式标记的 Workbench URL
- **AND** Workbench SHALL 展示 Agent 调试页签
- **AND** 每次提交 SHALL 是不继承此前调用上下文的独立任务

#### Scenario: 人工提交一次 Agent 任务
- **WHEN** 用户在 Workbench Agent 页签提交非空自然语言任务
- **THEN** 页面 SHALL 通过统一 invocation endpoint 发送 `{ task }`
- **AND** 页面 SHALL 展示 Agent 最终回复及 Tool 名称、输入、结果或错误
- **AND** 页面 SHALL NOT 自己选择执行策略或直接调用 CUA Tool

#### Scenario: Host 调用统一 invocation
- **WHEN** Review Server 或未来 GDEClaw Adapter 调用 `invokeCuaSubagent`
- **THEN** 被注入的 Host SHALL 获得同一 canonical definition 和 `cua_catalog`、`cua_execute`、`cua_workbench` 实现
- **AND** request SHALL NOT 因调用来源不同而改变语义

#### Scenario: 开发模式未连接 Agent Host
- **WHEN** Workbench 以 `--dev` 启动但没有配置 Agent Host
- **THEN** 页面 SHALL 明确显示当前不可调用
- **AND** 服务端 SHALL 返回可诊断的不可用状态而不是降级为 Freeform 执行
