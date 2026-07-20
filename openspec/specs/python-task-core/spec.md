# python-task-core Specification

## Purpose
TBD - created by archiving change refactor-python-core-and-midscene-executor. Update Purpose after archive.
## Requirements
### Requirement: Python 核心解析和编排 YAML 任务
Python 核心 SHALL 承载双 catalog 任务发现、trace 转换、输入解析、resolved task YAML 生成、外部 run directory 创建、子进程调用和结果校验。

#### Scenario: 执行本地任务
- **WHEN** 用户通过 CLI 运行内置或用户录制任务
- **THEN** Python SHALL 读取所选任务清单和 canonical YAML、解析输入并在统一外部 run directory 写入本次运行快照
- **AND** Python SHALL 调用单一 TypeScript YAML runner
- **AND** Python SHALL NOT 向任务目录或 Skill 根目录写入运行产物

### Requirement: Python 不重建 Midscene 动作类型系统
Python SHALL 使用结构化 YAML API 读写任务，但不得为所有 Midscene action 建立平行 Pydantic flow 模型。

#### Scenario: 任务包含 Midscene 原生 action
- **WHEN** `task.yaml` 包含本项目未专门建模但 Midscene 支持的 action
- **THEN** Python SHALL 保留其 YAML 结构
- **AND** 最终动作语法 SHALL 由 Midscene parser 验证

### Requirement: Python CLI 合并内置与用户任务目录
Python CLI SHALL 从固定 Skill 内置 catalog 和数据根 user catalog 发现任务，并对查询结果暴露来源、可写性和实际资产路径。

#### Scenario: 列出混合任务 catalog
- **WHEN** 内置和用户目录包含不同标识的有效任务
- **THEN** `scene list` 与 `task list` SHALL 返回两类任务的合并结果
- **AND** 排序 SHALL 确定且不依赖文件系统遍历顺序

#### Scenario: 创建用户任务
- **WHEN** 调用 `task init-from-trace`
- **THEN** Python SHALL 只以 user projects root 解析目标和 source
- **AND** 内置任务目录 SHALL 不可作为创建目标

### Requirement: CLI 以 task 命令管理录制任务
Python CLI SHALL 提供 `task init-from-trace`、`task validate`、`task inspect` 和 `task run`，并通过 `act run` 支持无录制 prompt 与录制任务整体 aiAct。

#### Scenario: 检查任务而不操作电脑
- **WHEN** 用户调用 `task inspect` 或 `task run --dry-run`
- **THEN** 系统 SHALL 输出或保存参数已解析的 YAML
- **AND** 系统 SHALL NOT 初始化设备或调用模型

### Requirement: Python CLI 提供 aiAct 统一入口
Python 核心 SHALL 通过 `cua act run` 暴露自然语言和录制 YAML 任务两种显式 aiAct 调用方式，并复用现有任务 resolver、统一外部 run root 与 YAML runner。

#### Scenario: 直接自然语言调用
- **WHEN** 用户只提供非空 `--prompt`
- **THEN** Python SHALL 在 `<data-root>/runs/<run-id>/` 保存临时 aiAct YAML 和执行结果
- **AND** Python SHALL 调用统一 Midscene YAML runner

#### Scenario: 录制任务调用
- **WHEN** 用户提供完整的 scene/task 和可选稀疏输入
- **THEN** Python SHALL 使用与 `task inspect` 相同的 resolver 生成 resolved task YAML
- **AND** Python SHALL 在 `<data-root>/runs/<run-id>/` 保存 resolved YAML、最终 prompt、临时 aiAct YAML 和执行结果

#### Scenario: 非法调用来源
- **WHEN** 用户混用 `--prompt` 与任务参数、遗漏 scene/task 任一项、提供空 prompt 或未知输入
- **THEN** Python SHALL 在创建 run directory 或启动 Midscene runner 前失败并给出明确错误

### Requirement: aiAct 执行结果使用持久化契约
系统 SHALL 复用现有 `ExecutorResult` 作为 Python 与统一 TypeScript YAML runner 间的执行结果契约。

#### Scenario: 校验成功结果
- **WHEN** YAML runner 以零退出码返回整体 aiAct 结果
- **THEN** Python SHALL 验证源 YAML 路径、dry-run、状态和完成时间
- **AND** Python SHALL 暴露可选的 Midscene 返回值

#### Scenario: 子进程或契约失败
- **WHEN** TypeScript 返回非零退出码、非法结果或失败状态
- **THEN** Python SHALL 保留原始错误并以失败状态结束
- **AND** Python SHALL NOT 调用逐 task 模式或修改任务资产

