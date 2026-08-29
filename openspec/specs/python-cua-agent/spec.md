# python-cua-agent Specification

## Purpose
定义无跨调用上下文的 Python CUA Subagent、调用内 Tool Calling、事件输出和 Host 集成边界。

## Requirements

### Requirement: 系统提供独立 Python CUA Subagent 包
系统 SHALL 在顶层 `agent/` 提供可独立安装和测试的 Python 包，并 SHALL 将 canonical definition、runner、contracts、events、私有 Tools 与 Runtime client 一同发布。

#### Scenario: 安装并导入 Python Agent
- **WHEN** 安装阶段根据 `agent/pyproject.toml` 和锁文件准备运行环境
- **THEN** Host SHALL 能导入稳定的 CUA invocation 入口和公开 contracts
- **AND** 导入过程 SHALL NOT 启动模型、Node Runtime 或电脑操作

### Requirement: Agent 接受无跨调用上下文的完整任务
Python Agent SHALL 每次接收一个非空完整任务，并 SHALL NOT 从此前 invocation 继承 messages、Tool 结果、策略或用户会话。

#### Scenario: 连续调用两个任务
- **WHEN** Host 依次提交两个 invocation
- **THEN** 第二次调用的初始模型上下文 SHALL 只包含 canonical instructions 与第二个任务
- **AND** 第一次调用产生的消息和 Tool 结果 SHALL NOT 出现在第二次调用中

### Requirement: Agent 自主管理调用内 Tool Calling
Python Agent SHALL 在一次 invocation 内调用模型、解析 Tool call、调用私有 CUA Tool、追加 Tool result，并持续到模型给出最终答复或达到明确终止条件。

#### Scenario: 模型先查询 Catalog 再执行
- **WHEN** 模型依次请求 `cua_catalog` 和 `cua_execute`
- **THEN** Agent SHALL 按顺序调用对应私有 Tool 并把关联结果返回模型
- **AND** Host SHALL 只需要等待同一次高层 invocation 的最终结果

#### Scenario: 达到最大轮次
- **WHEN** 模型在配置的最大轮次内始终没有生成最终答复
- **THEN** Agent SHALL 以结构化失败结束 invocation
- **AND** Agent SHALL NOT 无限继续调用模型或 Tool

### Requirement: Agent 封装任务级 Computer-Use 决策
canonical instructions SHALL 要求 Agent 在 Recorded Skill 发现、Replay、Guided、Freeform 和 Workbench 之间进行任务级选择，并 SHALL 将截图级 GUI 规划交给 Midscene。

#### Scenario: 主 Agent 委派自然语言电脑任务
- **WHEN** GDEClaw 只提交完整自然语言任务而未指定内部策略
- **THEN** Python Agent SHALL 自己决定是否查询 Recorded Skill 及调用何种内部执行 Tool
- **AND** GDEClaw SHALL NOT 需要知道内部 Tool schema

### Requirement: Agent 提供取消与结构化事件
Python Agent SHALL 在模型调用和 Tool 调用边界检查取消信号，并 SHALL 输出可关联 invocation 的结构化生命周期事件。

#### Scenario: Tool 调用前收到取消
- **WHEN** invocation 在下一次 Tool 调用前被取消
- **THEN** Agent SHALL NOT 启动该 Tool
- **AND** Agent SHALL 输出取消或失败终止事件及对应最终结果

#### Scenario: 正常完成一次任务
- **WHEN** 模型返回最终答复
- **THEN** Agent SHALL 输出 `agent.completed` 事件
- **AND** 最终结果 SHALL 包含状态和面向 Host 的回复

### Requirement: Agent 不承担持久会话与产品编排
Python Agent SHALL NOT 实现长期记忆、持久 Session、用户聊天历史、scheduler、多 Agent routing 或 GDEClaw 专用任务数据库。

#### Scenario: invocation 结束
- **WHEN** Agent 返回最终结果或失败
- **THEN** Agent SHALL 释放本次模型 messages 与 Runtime 资源
- **AND** 后续生命周期、后台状态和用户会话 SHALL 由 Host 管理

### Requirement: Agent 运行阶段不准备依赖
Python Agent SHALL 假设 Python 与 TypeScript Runtime 已在安装或部署阶段准备完成，并 SHALL NOT 在 invocation 内执行安装、解析或 lock 命令。

#### Scenario: Runtime executable 缺失
- **WHEN** 配置的 Node Runtime executable 或 bridge 入口不存在
- **THEN** Agent SHALL 返回可诊断配置错误
- **AND** Agent SHALL NOT 运行 `uv sync`、`uv lock`、`pip install`、`npm install` 或 `npm ci`
