# local-task-skills Specification

## Purpose
TBD - created by archiving change simplify-local-task-skills. Update Purpose after archive.
## Requirements
### Requirement: 本地任务按场景和任务组织
系统 SHALL 将可调用任务组织为 `execution/projects/<scene>/<task>/`，并在场景和任务层分别提供机器可读清单与 Agent Skill。

#### Scenario: Agent 发现一个场景中的任务
- **WHEN** Agent 查询指定场景的任务列表
- **THEN** 系统 SHALL 返回该场景下每个有效任务的标识、说明和输入定义
- **AND** 场景 Skill SHALL 只负责场景说明和任务路由，不内嵌所有任务执行步骤

#### Scenario: 任务保留自身录制证据
- **WHEN** 一个任务由录制产物初始化
- **THEN** 该任务的 trace、处理日志和截图 SHALL 保存在自身 `source/` 目录
- **AND** 其他任务 SHALL NOT 共用该目录中的可变证据文件

### Requirement: 任务 flow 是唯一长期执行事实源
每个任务 SHALL 使用任务根目录的 `midscene-flow.json` 表达可长期修改的完整执行流程，人、Agent 和前端 SHALL 共同消费该契约。

#### Scenario: 人工直接修正步骤
- **WHEN** 用户确认需要长期修正已有 step
- **THEN** 人工或 Agent SHALL 直接修改该任务的 `midscene-flow.json`
- **AND** 修改后 SHALL 通过 flow 验证
- **AND** 系统 SHALL NOT 要求同时维护 overrides、proposal 或 history 文件

#### Scenario: Agent 修改前等待确认
- **WHEN** Agent 根据用户描述形成长期修改建议
- **THEN** Agent SHALL 先展示 step、原值、新值和中文原因
- **AND** Agent SHALL 在用户明确确认后才编辑 flow
- **AND** Agent SHALL NOT 在执行失败后自动修改 flow 并重试

### Requirement: 任务参数定义不复制默认值
任务清单 SHALL 只保存输入 ID、中文说明和目标字段绑定，录制默认值 SHALL 只存在于 `midscene-flow.json` 对应字段。

#### Scenario: 调用时省略一个输入
- **WHEN** 调用方只提供任务声明输入中的一部分
- **THEN** 系统 SHALL 只覆盖明确提供的绑定字段
- **AND** 未提供输入对应字段 SHALL 保持 canonical flow 中的当前值

#### Scenario: flow 中默认值被人工修改
- **WHEN** 人工修改 input step 的 `route.value` 后未提供本次输入
- **THEN** inspect 和 run SHALL 使用修改后的 flow 值
- **AND** 任务清单 SHALL NOT 用另一份默认值覆盖它

### Requirement: 本地任务资产不依赖应用级历史
系统 SHALL 允许任务资产只保存在本地文件系统，且 SHALL NOT 要求数据库、校准历史或持久化修改建议才能运行。

#### Scenario: 本地任务离线调用
- **WHEN** 有效场景和任务文件已存在于本地
- **THEN** 任务发现、验证和参数解析 SHALL 可在不连接数据库和模型的情况下完成

### Requirement: Agent 显式选择电脑操作执行模式
执行器 Skill SHALL 向上层 Agent 说明确定性 flow、录制任务 aiAct 和无录制自然语言 aiAct 三种调用方式，并禁止隐式切换。

#### Scenario: 页面稳定的已录制任务
- **WHEN** 用户调用已有录制任务且页面状态与流程稳定
- **THEN** Skill SHALL 推荐使用 `cua flow run` 逐步执行以降低规划成本

#### Scenario: 需要统一规划的已录制任务
- **WHEN** 用户调用已有录制任务并明确希望由 aiAct 统一规划完整步骤
- **THEN** Skill SHALL 使用 `cua act run --scene <scene> --task <task>`

#### Scenario: 无录制自然语言任务
- **WHEN** 用户要求操作电脑但没有可用任务资产
- **THEN** Skill SHALL 使用 `cua act run --prompt <要求>`

#### Scenario: 执行失败
- **WHEN** 任一执行模式失败
- **THEN** Skill SHALL 报告原始错误并等待用户决定
- **AND** Skill SHALL NOT 自动切换模式、自动修改 flow 或自动重试

### Requirement: execution 是完整执行器 Skill 发布单元
系统 SHALL 将执行器 Skill 入口、Agent 元数据、参考契约、运行代码和本地任务资产组织在 `execution/` 目录内，使其可作为单一 Skill 包发布。

#### Scenario: 构建本机 Skill 副本
- **WHEN** 开发者运行 Skill 安装脚本
- **THEN** 安装包 SHALL 包含受版本管理的 `execution/SKILL.md`、运行代码、Schema、项目资产、Agent 元数据和参考契约
- **AND** 安装包 SHALL NOT 包含环境密钥、本地依赖、缓存或运行报告

#### Scenario: Agent 从安装包调用执行器
- **WHEN** Agent 加载已安装的 `cua-midscene` Skill
- **THEN** Agent SHALL 将包含 `SKILL.md`、`pyproject.toml` 和 `package.json` 的目录作为执行根目录
- **AND** Agent SHALL NOT 依赖外层 CUA 仓库才能发现 CLI 或执行器

