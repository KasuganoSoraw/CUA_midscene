# local-task-skills Specification

## Purpose
TBD - created by archiving change simplify-local-task-skills. Update Purpose after archive.
## Requirements
### Requirement: 任务目录使用精简 YAML 资产
每个任务 SHALL 包含 `task.yaml`、`task.json`、`SKILL.md` 和 `source/`，运行时可创建不纳入版本管理的 `reports/`。

#### Scenario: Agent 发现任务
- **WHEN** Agent 读取场景或任务 Skill
- **THEN** Skill SHALL 指向任务清单、canonical YAML 和 task CLI
- **AND** Skill SHALL NOT 要求维护 route、override、proposal 或 history 文件

### Requirement: 任务输入声明录制默认值
`task.json` SHALL 为每个 trace input 保存输入 ID、中文标签、可选说明和录制默认值，不保存 JSON 字段绑定。

#### Scenario: 未提供本次输入
- **WHEN** 调用者未覆盖某项输入
- **THEN** resolver SHALL 使用 `task.json` 中的录制默认值

### Requirement: execution 发布单元只包含当前实现
execution Skill 安装包 SHALL 包含 Python 核心、YAML runner、项目任务、引用文档和必要契约，不得包含已删除架构的代码或说明。

#### Scenario: 安装 Skill
- **WHEN** 执行可重复安装命令
- **THEN** 本机 Skill 副本 SHALL 与仓库当前文件一致
- **AND** 安装包 SHALL NOT 包含 node_modules、reports 或旧 flow 文件

### Requirement: Agent 显式选择电脑操作执行模式
执行器 Skill SHALL 向上层 Agent 说明录制 YAML 逐 task 执行、录制任务整体 aiAct 和无录制自然语言 aiAct 三种调用方式，并禁止隐式切换。

#### Scenario: 页面稳定的已录制任务
- **WHEN** 用户调用已有录制任务且页面状态与流程稳定
- **THEN** Skill SHALL 推荐使用 `cua task run --scene <scene> --task <task>` 以降低规划成本

#### Scenario: 需要统一规划的已录制任务
- **WHEN** 用户调用已有录制任务并明确希望由 aiAct 统一规划完整步骤
- **THEN** Skill SHALL 使用 `cua act run --scene <scene> --task <task>` 并传入用户明确提供的本次输入

#### Scenario: 无录制自然语言任务
- **WHEN** 用户要求操作电脑但没有可用任务资产
- **THEN** Skill SHALL 使用 `cua act run --prompt <要求>`

#### Scenario: 执行失败
- **WHEN** 任一执行模式失败
- **THEN** Skill SHALL 报告原始错误并等待用户决定
- **AND** Skill SHALL NOT 自动切换模式、自动修改 YAML 或自动重试

